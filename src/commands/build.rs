use async_trait::async_trait;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::cache::{CacheEntry, CacheManifest};
use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};
use crate::exports::collect_exports;
use crate::grammar::{parser::GrammarParser, GrammarIr};
use crate::grammar::merge::merge_grammars;
use crate::grammar::serializer::GrammarSerializer;
use crate::printing_press::inklang::grammar::merge_grammars as pp_merge_grammars;
use crate::util::target_version::resolve_target_version;

/// Compile an entry point .ink file with import resolution.
fn compile_ink_entry(
    entry: &Path,
    output: &Path,
    grammar: &crate::printing_press::inklang::grammar::MergedGrammar,
) -> Result<()> {
    let script = crate::printing_press::inklang::compile_entry(entry, Some(grammar))
        .map_err(|e| QuillError::CompilerFailed {
            script: entry.to_string_lossy().into(),
            stderr: e.display(),
        })?;

    let json = serde_json::to_string(&script)
        .map_err(|e| QuillError::RegistryAuth {
            message: format!("failed to serialize compiled output: {}", e),
        })?;

    std::fs::write(output, json)
        .map_err(|e| QuillError::io_error(format!("failed to write output '{}'", output.display()), e))?;

    Ok(())
}

pub struct Build {
    pub output: Option<PathBuf>,
    pub target: Option<String>,
}

#[async_trait]
impl Command for Build {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let manifest = ctx.manifest.as_ref().ok_or_else(|| {
            QuillError::ManifestNotFound {
                path: ctx.project_dir.join("ink-manifest.toml"),
            }
        })?;

        // 1. Resolve target version
        let target_name = self.target.as_deref().unwrap_or("paper");
        let target_version = resolve_target_version(
            self.target.as_deref(),
            manifest.build.as_ref(),
            manifest.server.as_ref(),
            target_name,
        );

        // 2. Parse local grammar .ink-grammar if exists
        let local_grammar_path = ctx.project_dir.join("src").join("grammar.ink-grammar");
        let local_grammar = if local_grammar_path.exists() {
            let source = fs::read_to_string(&local_grammar_path)
                .map_err(|e| QuillError::io_error("failed to read grammar file", e))?;
            let mut parser = GrammarParser::new(&source);
            Some(parser.parse()?)
        } else {
            None
        };

        // 3. Merge grammars from dependencies
        let node_modules = ctx.project_dir.join("node_modules");
        let mut dependency_grammars: Vec<(Option<String>, GrammarIr)> = Vec::new();

        if node_modules.exists() {
            for (name, _range) in &manifest.dependencies {
                let dep_path = node_modules.join(name);
                let dep_grammar_path = dep_path.join("grammar.ink-grammar");

                if dep_grammar_path.exists() {
                    let source = fs::read_to_string(&dep_grammar_path)
                        .map_err(|e| QuillError::io_error("failed to read dependency grammar", e))?;
                    let mut parser = GrammarParser::new(&source);
                    if let Ok(grammar) = parser.parse() {
                        dependency_grammars.push((Some(name.clone()), grammar));
                    }
                }
            }
        }

        // Create base grammar
        let base_grammar = local_grammar.unwrap_or_else(|| GrammarIr {
            package: manifest.package.name.clone(),
            rules: BTreeMap::new(),
            keywords: BTreeMap::new(),
            imports: Vec::new(),
        });

        // Merge grammars
        let merged_grammar = if dependency_grammars.is_empty() {
            base_grammar
        } else {
            merge_grammars(&base_grammar, &dependency_grammars)?
        };

        // Serialize GrammarIr to GrammarPackage, then build MergedGrammar in-memory
        let grammar_pkg = GrammarSerializer::serialize_grammar_package(&merged_grammar);
        let grammar_for_compiler = pp_merge_grammars(vec![grammar_pkg]);

        // Collect grammar package names for exports
        let grammar_packages: Vec<String> = if dependency_grammars.is_empty() {
            vec![]
        } else {
            dependency_grammars.iter()
                .filter_map(|(name, _)| name.clone())
                .collect()
        };

        // 4. Determine entry point
        let entry_relative = manifest.package.main.clone()
            .or_else(|| manifest.build.as_ref().and_then(|b| b.entry.clone()))
            .unwrap_or_else(|| "src/main.ink".to_string());
        let entry_path = ctx.project_dir.join(&entry_relative);

        if !entry_path.exists() {
            return Err(QuillError::ManifestNotFound {
                path: entry_path,
            });
        }

        // 5. Compile entry point with import resolution
        let output_dir = self.output.clone()
            .unwrap_or_else(|| ctx.project_dir.join("target").join("ink"));

        fs::create_dir_all(&output_dir)
            .map_err(|e| QuillError::io_error("failed to create output directory", e))?;

        let entry_stem = entry_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("main");
        let output_file = output_dir.join(format!("{}.inkc", entry_stem));

        compile_ink_entry(&entry_path, &output_file, &grammar_for_compiler)?;
        println!("Compiled: {} → {}", entry_relative, output_file.display());

        // 6. Generate exports.json (also validates package imports against exports.json)
        let author = manifest.package.author.clone();
        let cache_dir = get_cache_dir()?;
        let packages_dir = cache_dir.join("packages");
        match crate::printing_press::resolve_ast_with_validation(
            &entry_path,
            Some(&grammar_for_compiler),
            packages_dir,
            author.clone(),
        ) {
            Ok(resolved_ast) => {
                let exports = collect_exports(&resolved_ast, &grammar_packages, author);
                let exports_json = serde_json::to_string_pretty(&exports)
                    .map_err(|e| QuillError::RegistryAuth {
                        message: format!("failed to serialize exports: {}", e),
                    })?;
                let exports_path = ctx.project_dir.join("exports.json");
                fs::write(&exports_path, exports_json)
                    .map_err(|e| QuillError::io_error("failed to write exports.json", e))?;
                println!("Exports: {}", exports_path.display());
            }
            Err(e) => {
                // Non-fatal: compilation already succeeded, exports collection is best-effort
                eprintln!("warning: exports collection failed: {}", e.display());
            }
        }

        // 7. Update cache
        let cache_manifest_path = cache_dir.join("manifest.json");

        let cache_manifest = if cache_manifest_path.exists() {
            let content = fs::read_to_string(&cache_manifest_path)
                .map_err(|e| QuillError::io_error("failed to read cache manifest", e))?;
            serde_json::from_str(&content)
                .map_err(|e| QuillError::RegistryAuth {
                    message: format!("failed to parse cache manifest: {}", e),
                })?
        } else {
            CacheManifest::default()
        };

        let mut new_cache_entries: BTreeMap<String, CacheEntry> = cache_manifest.entries.clone();
        let hash = crate::cache::dirty::hash_file(&entry_path)?;
        new_cache_entries.insert(entry_relative.clone(), CacheEntry {
            hash,
            output: output_file.to_string_lossy().to_string(),
            compiled_at: chrono_now(),
        });

        // 8. Write ink-manifest.json
        let ink_manifest = serde_json::json!({
            "name": manifest.package.name,
            "version": manifest.package.version,
            "entry": entry_relative,
            "target": target_name,
            "targetVersion": target_version.map(|v| format!("{:?}", v)),
            "grammar": merged_grammar,
        });

        let ink_manifest_path = output_dir.join("ink-manifest.json");
        let manifest_json = serde_json::to_string_pretty(&ink_manifest)
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to serialize ink manifest: {}", e),
            })?;
        fs::write(&ink_manifest_path, manifest_json)
            .map_err(|e| QuillError::io_error("failed to write ink-manifest.json", e))?;

        // 9. Update cache
        let mut updated_cache = cache_manifest;
        updated_cache.entries = new_cache_entries;
        updated_cache.last_full_build = chrono_now();
        updated_cache.grammar_ir_hash = Some(hash_grammar_ir(&merged_grammar)?);

        let cache_json = serde_json::to_string_pretty(&updated_cache)
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to serialize cache manifest: {}", e),
            })?;
        fs::create_dir_all(&cache_dir)
            .map_err(|e| QuillError::io_error("failed to create cache directory", e))?;
        fs::write(&cache_manifest_path, cache_json)
            .map_err(|e| QuillError::io_error("failed to write cache manifest", e))?;

        println!("Build complete: {}", ink_manifest_path.display());
        Ok(())
    }
}

fn get_cache_dir() -> Result<PathBuf> {
    let home = std::env::var("HOME")
        .map_err(|_| QuillError::RegistryAuth {
            message: "HOME environment variable not set".to_string(),
        })?;
    Ok(PathBuf::from(home).join(".quill").join("cache"))
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", duration.as_secs())
}

fn hash_grammar_ir(grammar: &GrammarIr) -> Result<String> {
    use sha2::{Digest, Sha256};
    let json = serde_json::to_string(grammar)
        .map_err(|e| QuillError::RegistryAuth {
            message: format!("failed to serialize grammar for hashing: {}", e),
        })?;
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    Ok(hex::encode(hasher.finalize()))
}

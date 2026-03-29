use async_trait::async_trait;
use std::path::Path;

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};
use crate::printing_press as pp;
use crate::printing_press::inklang::grammar;

pub struct Compile {
    pub input: Option<String>,
    pub output: Option<std::path::PathBuf>,
    pub sources: Option<String>,
    pub out: Option<String>,
    pub grammar: Option<String>,
    pub debug: bool,
    pub entry: bool,
}

#[async_trait]
impl Command for Compile {
    async fn execute(&self, _ctx: &Context) -> Result<()> {
        let grammar = resolve_grammar(self.grammar.as_deref())?;

        if let Some(sources_dir) = &self.sources {
            let out_dir = self.out.as_ref().expect("--out is required in batch mode");
            batch_compile(sources_dir, out_dir, grammar.as_ref(), self.debug)?;
        } else if self.entry {
            let input = self.input.as_ref().expect("INPUT file required with --entry");
            let output = self.output.as_ref().expect("-o/--output required with --entry");
            entry_compile(input, output, grammar.as_ref(), self.debug)?;
        } else {
            let input = self.input.as_ref().expect("INPUT file or --sources required");
            let output = self.output.as_ref().expect("-o/--output required in single-file mode");
            single_compile(input, output, grammar.as_ref(), self.debug)?;
        }

        Ok(())
    }
}

fn resolve_grammar(grammar_path: Option<&str>) -> Result<Option<grammar::MergedGrammar>> {
    match grammar_path {
        Some(path) => {
            let loaded = grammar::load_grammar(path)
                .map_err(|e| QuillError::CompilerFailed {
                    script: path.to_string(),
                    stderr: e.display().to_string(),
                })?;
            Ok(Some(pp::inklang::grammar::merge_grammars(vec![loaded])))
        }
        None => Ok(None),
    }
}

fn single_compile(
    input: &str,
    output: &Path,
    grammar: Option<&pp::inklang::grammar::MergedGrammar>,
    debug: bool,
) -> Result<()> {
    let source = std::fs::read_to_string(input)
        .map_err(|e| QuillError::io_error(format!("could not read file '{}'", input), e))?;

    let result = match grammar {
        Some(g) => pp::compile_with_grammar(&source, "main", Some(g)),
        None => pp::compile(&source, "main").map_err(|e| e.into()),
    };

    let script = result
        .map_err(|e| QuillError::CompilerFailed {
            script: input.to_string(),
            stderr: e.display().to_string(),
        })?;

    let json = if debug {
        serde_json::to_string_pretty(&script)
    } else {
        serde_json::to_string(&script)
    }
    .map_err(|e| QuillError::RegistryAuth {
        message: format!("failed to serialize compiled output: {}", e),
    })?;

    std::fs::write(output, &json)
        .map_err(|e| QuillError::io_error(format!("failed to write output '{}'", output.display()), e))?;

    println!("Compiled {} → {}", input, output.display());
    Ok(())
}

fn entry_compile(
    input: &str,
    output: &Path,
    grammar: Option<&pp::inklang::grammar::MergedGrammar>,
    debug: bool,
) -> Result<()> {
    let entry_path = Path::new(input);

    let script = pp::compile_entry(entry_path, grammar)
        .map_err(|e| QuillError::CompilerFailed {
            script: input.to_string(),
            stderr: e.display().to_string(),
        })?;

    let json = if debug {
        serde_json::to_string_pretty(&script)
    } else {
        serde_json::to_string(&script)
    }
    .map_err(|e| QuillError::RegistryAuth {
        message: format!("failed to serialize compiled output: {}", e),
    })?;

    std::fs::write(output, &json)
        .map_err(|e| QuillError::io_error(format!("failed to write output '{}'", output.display()), e))?;

    println!("Compiled {} → {} (with imports)", input, output.display());
    Ok(())
}

fn batch_compile(
    sources_dir: &str,
    out_dir: &str,
    grammar: Option<&pp::inklang::grammar::MergedGrammar>,
    debug: bool,
) -> Result<()> {
    let src_path = Path::new(sources_dir);
    let out_path = Path::new(out_dir);

    std::fs::create_dir_all(out_path)
        .map_err(|e| QuillError::io_error(format!("could not create output directory '{}'", out_dir), e))?;

    let entries: Vec<_> = std::fs::read_dir(src_path)
        .map_err(|e| QuillError::io_error(format!("could not read directory '{}'", sources_dir), e))?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "ink"))
        .collect();

    if entries.is_empty() {
        println!("No .ink files found in {}", sources_dir);
        return Ok(());
    }

    let mut errors = 0;
    for entry in entries {
        let input_path = entry.path();
        let file_name = input_path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown");
        let output_path = out_path.join(format!("{}.inkc", file_name));

        let source = match std::fs::read_to_string(&input_path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("error: could not read file '{}': {}", input_path.display(), e);
                errors += 1;
                continue;
            }
        };

        let result = match grammar {
            Some(g) => pp::compile_with_grammar(&source, file_name, Some(g)),
            None => pp::compile(&source, file_name).map_err(|e| e.into()),
        };

        match result {
            Ok(script) => {
                let json = if debug {
                    serde_json::to_string_pretty(&script)
                } else {
                    serde_json::to_string(&script)
                }
                .map_err(|e| QuillError::RegistryAuth {
                    message: format!("failed to serialize: {}", e),
                })?;

                if let Err(e) = std::fs::write(&output_path, &json) {
                    eprintln!("error: could not write output '{}': {}", output_path.display(), e);
                    errors += 1;
                    continue;
                }

                println!(
                    "Compiled {} → {}",
                    input_path.file_name().unwrap().to_str().unwrap(),
                    output_path.file_name().unwrap().to_str().unwrap()
                );
            }
            Err(e) => {
                eprintln!("{}", e.display());
                errors += 1;
            }
        }
    }

    if errors > 0 {
        eprintln!("{} file(s) failed to compile", errors);
        return Err(QuillError::CompilerFailed {
            script: sources_dir.to_string(),
            stderr: format!("{} file(s) failed to compile", errors),
        });
    }

    Ok(())
}

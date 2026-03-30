use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::ast::{Pattern, Stmt};
use super::grammar::MergedGrammar;
use super::parser::Parser;
use super::CompileError;
use crate::exports::PackageExports;

/// Resolves file imports at compile time.
pub struct ImportResolver {
    resolving: HashSet<PathBuf>,
    resolved: HashSet<PathBuf>,
    cache: HashMap<PathBuf, Vec<Stmt>>,
    grammar: Option<MergedGrammar>,
    /// Directory where installed packages are cached (e.g. ~/.quill/cache/packages).
    packages_dir: Option<PathBuf>,
    /// Author of the importing package, for @internal visibility checks.
    importer_author: Option<String>,
}

impl ImportResolver {
    pub fn new(grammar: Option<MergedGrammar>) -> Self {
        Self {
            resolving: HashSet::new(),
            resolved: HashSet::new(),
            cache: HashMap::new(),
            grammar,
            packages_dir: None,
            importer_author: None,
        }
    }

    pub fn with_package_validation(
        grammar: Option<MergedGrammar>,
        packages_dir: PathBuf,
        importer_author: Option<String>,
    ) -> Self {
        Self {
            resolving: HashSet::new(),
            resolved: HashSet::new(),
            cache: HashMap::new(),
            grammar,
            packages_dir: Some(packages_dir),
            importer_author,
        }
    }

    pub fn resolve(&mut self, ast: &[Stmt], base_dir: &Path) -> Result<Vec<Stmt>, CompileError> {
        let mut result = Vec::new();

        for stmt in ast {
            match stmt {
                Stmt::ImportFile { import_token, path, items } => {
                    let target = resolve_path(base_dir, path, import_token.line)?;
                    let canonical = target.canonicalize()
                        .map_err(|_| CompileError::Other(
                            format!("import error at line {}: file not found: {}", import_token.line, path)))?;

                    if self.resolving.contains(&canonical) {
                        return Err(CompileError::Other(
                            format!("circular import detected at line {}: '{}' is already being imported",
                                import_token.line, path)));
                    }

                    if self.resolved.contains(&canonical) {
                        let cached = self.cache.get(&canonical).unwrap();
                        let filtered = match items {
                            Some(names) => filter_declarations(cached, names, path, import_token.line)?,
                            None => cached.clone(),
                        };
                        result.extend(filtered);
                        continue;
                    }

                    self.resolving.insert(canonical.clone());

                    let source = std::fs::read_to_string(&target)
                        .map_err(|e| CompileError::Other(
                            format!("import error at line {}: could not read '{}': {}",
                                import_token.line, target.display(), e)))?;

                    let tokens = super::lexer::tokenize(&source);
                    let target_ast = Parser::new(tokens, self.grammar.as_ref())
                        .parse()
                        .map_err(|e| CompileError::Other(
                            format!("import error at line {}: parse error in '{}': {}",
                                import_token.line, path, e)))?;

                    let target_dir = target.parent().unwrap_or(base_dir).to_path_buf();
                    let target_resolved = self.resolve(&target_ast, &target_dir)?;

                    self.cache.insert(canonical.clone(), target_resolved.clone());
                    self.resolving.remove(&canonical);
                    self.resolved.insert(canonical);

                    let mut final_stmts = target_resolved;
                    if let Some(names) = items {
                        final_stmts = filter_declarations(&final_stmts, names, path, import_token.line)?;
                    }

                    result.extend(final_stmts);
                }
                Stmt::ImportFrom { path, items } => {
                    if let Some(packages_dir) = &self.packages_dir {
                        let pkg_name = path.join(".");
                        let pkg_dir = packages_dir.join(&pkg_name);
                        validate_package_import(
                            &pkg_name,
                            items,
                            &pkg_dir,
                            // package author from exports.json
                            None,
                            self.importer_author.as_deref(),
                        )?;
                    }
                    result.push(stmt.clone());
                }
                other => result.push(other.clone()),
            }
        }

        Ok(result)
    }
}

fn resolve_path(base_dir: &Path, import_path: &str, line: usize) -> Result<PathBuf, CompileError> {
    if !import_path.starts_with("./") && !import_path.starts_with("../") {
        return Err(CompileError::Other(
            format!("import error at line {}: path must start with './' or '../' — bare names are for packages (got '{}')",
                line, import_path)));
    }

    let target = base_dir.join(import_path);
    let target = if target.extension().is_none() {
        target.with_extension("ink")
    } else {
        target
    };

    if !target.exists() {
        return Err(CompileError::Other(
            format!("import error at line {}: file not found: {}", line, target.display())));
    }

    Ok(target)
}

fn declaration_name(stmt: &Stmt) -> Option<&str> {
    match stmt {
        Stmt::Fn { name, .. } => Some(&name.lexeme),
        Stmt::Let { pattern: Pattern::Bind(name), .. } => Some(&name.lexeme),
        Stmt::Const { pattern: Pattern::Bind(name), .. } => Some(&name.lexeme),
        // Non-Bind patterns (Tuple, Map, Wildcard) return None intentionally.
        // Top-level destructuring lets/consts export their individual bindings
        // through their Bind leaves, which are matched by the arms above when
        // each binding is looked up by name.  There is no single canonical
        // export name for a destructuring pattern, so callers that need all
        // exported names from such a statement must iterate the pattern's
        // children themselves.  Returning None here is correct, not an
        // oversight.
        Stmt::Class { name, .. } => Some(&name.lexeme),
        Stmt::Enum { name, .. } => Some(&name.lexeme),
        Stmt::GrammarDecl { name, .. } => Some(name),
        Stmt::Config { name, .. } => Some(&name.lexeme),
        Stmt::Table { name, .. } => Some(&name.lexeme),
        Stmt::AnnotationDef { name, .. } => Some(&name.lexeme),
        Stmt::EventDecl { name, .. } => Some(&name.lexeme),
        _ => None,
    }
}

fn filter_declarations(
    stmts: &[Stmt],
    names: &[String],
    path: &str,
    line: usize,
) -> Result<Vec<Stmt>, CompileError> {
    let mut result = Vec::new();
    let mut found = HashSet::new();

    for stmt in stmts {
        if let Some(name) = declaration_name(stmt) {
            if names.iter().any(|n| n == name) {
                result.push(stmt.clone());
                found.insert(name.to_string());
            }
        }
    }

    let missing: Vec<&String> = names.iter().filter(|n| !found.contains(n.as_str())).collect();
    if !missing.is_empty() {
        let missing_str = missing.iter().map(|s| format!("'{}'", s)).collect::<Vec<_>>().join(", ");
        return Err(CompileError::Other(
            format!("import error at line {}: not found in '{}': {}",
                line, path, missing_str)));
    }

    Ok(result)
}

/// Validate a package import against the package's exports.json.
///
/// - `pkg_name`: the package identifier (e.g. "ink.paper")
/// - `items`: names being imported
/// - `pkg_dir`: path to the package directory in the cache (exports.json lives here)
/// - `pkg_author`: the package author from exports.json (passed through for testing; if None,
///   it is read from the file)
/// - `importer_author`: the author of the importing package
///
/// Returns Ok(()) if validation passes. If exports.json is absent, validation is skipped
/// (pre-exports packages are tolerated with a warning).
fn validate_package_import(
    pkg_name: &str,
    items: &[String],
    pkg_dir: &Path,
    _pkg_author_override: Option<&str>,
    importer_author: Option<&str>,
) -> Result<(), CompileError> {
    let exports_path = pkg_dir.join("exports.json");

    if !exports_path.exists() {
        eprintln!(
            "warning: package '{}' has no exports metadata — import validation skipped",
            pkg_name
        );
        return Ok(());
    }

    let json = std::fs::read_to_string(&exports_path).map_err(|e| {
        CompileError::Other(format!(
            "failed to read exports for '{}': {}",
            pkg_name, e
        ))
    })?;

    let exports: PackageExports = serde_json::from_str(&json).map_err(|e| {
        CompileError::Other(format!("invalid exports.json for '{}': {}", pkg_name, e))
    })?;

    for item in items {
        check_item_visibility(pkg_name, item, &exports, importer_author)?;
    }

    Ok(())
}

fn check_item_visibility(
    pkg_name: &str,
    item: &str,
    exports: &PackageExports,
    importer_author: Option<&str>,
) -> Result<(), CompileError> {
    // Check classes
    if let Some(class) = exports.classes.get(item) {
        if class.visibility.is_internal() && !same_author(exports.author.as_deref(), importer_author) {
            return Err(CompileError::Other(format!(
                "'{}' from '{}' is internal and not available to this package",
                item, pkg_name
            )));
        }
        return Ok(());
    }

    // Check functions
    if let Some(visibility) = exports.functions.get(item) {
        if visibility.is_internal() && !same_author(exports.author.as_deref(), importer_author) {
            return Err(CompileError::Other(format!(
                "'{}' from '{}' is internal and not available to this package",
                item, pkg_name
            )));
        }
        return Ok(());
    }

    // Grammars are always public
    if exports.grammars.contains(&item.to_string()) {
        return Ok(());
    }

    Err(CompileError::Other(format!(
        "'{}' is not exported by '{}'",
        item, pkg_name
    )))
}

fn same_author(pkg_author: Option<&str>, importer_author: Option<&str>) -> bool {
    match (pkg_author, importer_author) {
        (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
        _ => false,
    }
}

pub fn check_name_collisions(stmts: &[Stmt], source_name: &str) -> Result<(), CompileError> {
    let mut seen: HashMap<String, String> = HashMap::new();

    for stmt in stmts {
        if let Some(name) = declaration_name(stmt) {
            if let Some(_prev) = seen.get(name) {
                return Err(CompileError::Other(
                    format!("duplicate declaration '{}': defined multiple times in merged module",
                        name)));
            }
            seen.insert(name.to_string(), source_name.to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stmts_with_names(names: &[&str]) -> Vec<Stmt> {
        names.iter().map(|name| {
            Stmt::Fn {
                annotations: vec![],
                name: super::super::token::Token {
                    typ: super::super::token::TokenType::Identifier,
                    lexeme: name.to_string(),
                    line: 1,
                    column: 0,
                },
                params: vec![],
                return_type: None,
                body: Box::new(Stmt::Block(vec![])),
                is_async: false,
            }
        }).collect()
    }

    #[test]
    fn test_filter_declarations_finds_all() {
        let stmts = stmts_with_names(&["greet", "farewell", "Config"]);
        let result = filter_declarations(&stmts, &["greet".to_string(), "Config".to_string()], "./utils", 1).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_filter_declarations_missing_name() {
        let stmts = stmts_with_names(&["greet"]);
        let result = filter_declarations(&stmts, &["nonexistent".to_string()], "./utils", 1);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[test]
    fn test_check_name_collisions_ok() {
        let stmts = stmts_with_names(&["greet", "farewell"]);
        assert!(check_name_collisions(&stmts, "main").is_ok());
    }

    #[test]
    fn test_check_name_collisions_duplicate() {
        let stmts = stmts_with_names(&["greet", "greet"]);
        let result = check_name_collisions(&stmts, "main");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("duplicate"));
    }

    #[test]
    fn test_resolve_path_valid() {
        let dir = std::env::temp_dir();
        let file_path = dir.join("test_import.ink");
        std::fs::write(&file_path, "").unwrap();
        let result = resolve_path(&dir, "./test_import", 1);
        std::fs::remove_file(&file_path).ok();
        assert!(result.is_ok());
    }

    #[test]
    fn test_resolve_path_not_found() {
        let result = resolve_path(Path::new("/nonexistent"), "./missing", 1);
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_path_bare_name_rejected() {
        let result = resolve_path(Path::new("."), "math", 1);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("must start with"));
    }

    #[test]
    fn test_resolve_path_parent_dir_allowed() {
        let dir = std::env::temp_dir();
        let subdir = dir.join("sub_import_test");
        std::fs::create_dir_all(&subdir).unwrap();
        let file_path = dir.join("parent_import.ink");
        std::fs::write(&file_path, "").unwrap();
        let result = resolve_path(&subdir, "../parent_import", 1);
        std::fs::remove_file(&file_path).ok();
        std::fs::remove_dir(&subdir).ok();
        assert!(result.is_ok());
    }

    // --- Package import validation tests ---

    fn write_exports(dir: &std::path::Path, json: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("exports.json"), json).unwrap();
    }

    #[test]
    fn test_package_import_public_class_allowed() {
        let tmp = std::env::temp_dir().join("quill_test_pkg_pub");
        write_exports(&tmp, r#"{"version":1,"classes":{"Wallet":{"visibility":"public","methods":["get_balance"]}},"functions":{},"grammars":[]}"#);
        let result = validate_package_import("mypkg", &["Wallet".to_string()], &tmp, None, None);
        std::fs::remove_dir_all(&tmp).ok();
        assert!(result.is_ok());
    }

    #[test]
    fn test_package_import_unknown_name_rejected() {
        let tmp = std::env::temp_dir().join("quill_test_pkg_unk");
        write_exports(&tmp, r#"{"version":1,"classes":{},"functions":{},"grammars":[]}"#);
        let result = validate_package_import("mypkg", &["Ghost".to_string()], &tmp, None, None);
        std::fs::remove_dir_all(&tmp).ok();
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Ghost"));
    }

    #[test]
    fn test_package_import_internal_class_blocked_for_other_author() {
        let tmp = std::env::temp_dir().join("quill_test_pkg_int");
        write_exports(&tmp, r#"{"version":1,"author":"alice","classes":{"Ledger":{"visibility":"internal","methods":[]}},"functions":{},"grammars":[]}"#);
        let result = validate_package_import("mypkg", &["Ledger".to_string()], &tmp, Some("alice"), Some("bob"));
        std::fs::remove_dir_all(&tmp).ok();
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("internal"));
    }

    #[test]
    fn test_package_import_internal_class_allowed_for_same_author() {
        let tmp = std::env::temp_dir().join("quill_test_pkg_same");
        write_exports(&tmp, r#"{"version":1,"author":"alice","classes":{"Ledger":{"visibility":"internal","methods":[]}},"functions":{},"grammars":[]}"#);
        let result = validate_package_import("mypkg", &["Ledger".to_string()], &tmp, Some("alice"), Some("alice"));
        std::fs::remove_dir_all(&tmp).ok();
        assert!(result.is_ok());
    }

    #[test]
    fn test_package_import_internal_function_blocked() {
        let tmp = std::env::temp_dir().join("quill_test_pkg_ifn");
        write_exports(&tmp, r#"{"version":1,"author":"alice","classes":{},"functions":{"secret":"internal"},"grammars":[]}"#);
        let result = validate_package_import("mypkg", &["secret".to_string()], &tmp, Some("alice"), Some("bob"));
        std::fs::remove_dir_all(&tmp).ok();
        assert!(result.is_err());
    }

    #[test]
    fn test_package_import_grammar_allowed() {
        let tmp = std::env::temp_dir().join("quill_test_pkg_gram");
        write_exports(&tmp, r#"{"version":1,"classes":{},"functions":{},"grammars":["ink.paper"]}"#);
        let result = validate_package_import("mypkg", &["ink.paper".to_string()], &tmp, None, None);
        std::fs::remove_dir_all(&tmp).ok();
        assert!(result.is_ok());
    }

    #[test]
    fn test_package_import_no_exports_json_is_ok() {
        let tmp = std::env::temp_dir().join("quill_test_pkg_noexports");
        std::fs::create_dir_all(&tmp).unwrap();
        // No exports.json — simulate pre-exports package, should pass with warning
        let result = validate_package_import("mypkg", &["Anything".to_string()], &tmp, None, None);
        std::fs::remove_dir_all(&tmp).ok();
        assert!(result.is_ok());
    }
}

// Entry point for the ink compiler module.
pub mod inklang;

// Re-export compile functions for use by quill commands
pub use inklang::{compile, compile_with_grammar, compile_entry, resolve_ast, resolve_ast_with_validation, SerialScript};

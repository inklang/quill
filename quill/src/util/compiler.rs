use std::path::Path;

use crate::error::{QuillError, Result};
use crate::printing_press::{compile, SerialScript};

/// Compile an .ink source file to .inkc JSON bytecode using printing_press.
pub fn compile_ink(source: &Path, output: &Path) -> Result<()> {
    let source_text = std::fs::read_to_string(source)
        .map_err(|e| QuillError::io_error(format!("failed to read source '{}'", source.display()), e))?;

    let name = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("main");

    let script: SerialScript = compile(&source_text, name)
        .map_err(|e| QuillError::CompilerFailed {
            script: source.to_string_lossy().into(),
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

use crate::error::Result;

use super::GrammarIr;

/// Serializer for GrammarIr to JSON.
pub struct GrammarSerializer;

impl GrammarSerializer {
    /// Serialize a GrammarIr to a JSON string.
    pub fn serialize(ir: &GrammarIr) -> Result<String> {
        serde_json::to_string_pretty(ir)
            .map_err(|e| crate::error::QuillError::GrammarValidation {
                errors: vec![format!("serialization failed: {}", e)],
            })
    }

    /// Serialize a GrammarIr to a JSON string (compact format).
    pub fn serialize_compact(ir: &GrammarIr) -> Result<String> {
        serde_json::to_string(ir)
            .map_err(|e| crate::error::QuillError::GrammarValidation {
                errors: vec![format!("serialization failed: {}", e)],
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn test_serialize_grammar_ir() {
        let ir = GrammarIr {
            package: "test".to_string(),
            rules: BTreeMap::new(),
            keywords: BTreeMap::new(),
            imports: vec!["ink.base".to_string()],
        };

        let json = GrammarSerializer::serialize(&ir).unwrap();
        assert!(json.contains("test"));
        assert!(json.contains("ink.base"));
    }

    #[test]
    fn test_serialize_compact() {
        let ir = GrammarIr {
            package: "test".to_string(),
            rules: BTreeMap::new(),
            keywords: BTreeMap::new(),
            imports: Vec::new(),
        };

        let json = GrammarSerializer::serialize_compact(&ir).unwrap();
        assert!(!json.contains("\n"));
    }
}

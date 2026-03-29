//! Copy Propagation pass.
//!
//! Eliminates Move instructions by replacing all downstream uses of the
//! destination with the source. In SSA form this is global and unconditional
//! because each value is defined exactly once.

use super::super::block::SsaInstr;
use super::super::function::SsaFunction;
use super::super::value::SsaValue;
use super::super::SsaOptPass;
use super::SsaOptResult;
use std::collections::{HashMap, HashSet};

/// Copy Propagation pass.
pub struct SsaCopyPropagationPass;

impl SsaCopyPropagationPass {
    pub fn new() -> Self {
        SsaCopyPropagationPass
    }
}

impl Default for SsaCopyPropagationPass {
    fn default() -> Self {
        Self::new()
    }
}

impl SsaOptPass for SsaCopyPropagationPass {
    fn name(&self) -> &str {
        "SsaCopyPropagation"
    }

    fn run(&mut self, ssa_func: SsaFunction) -> SsaOptResult {
        // Step 1: Build global copy map from Move instructions.
        // For Move { defined_value: dst, src }, record dst -> src.
        // Skip Moves where src is UNDEFINED.
        let mut copy_map: HashMap<SsaValue, SsaValue> = HashMap::new();
        for block in &ssa_func.blocks {
            for instr in &block.instrs {
                if let SsaInstr::Move { defined_value, src } = instr {
                    if !src.is_undefined() && !defined_value.is_undefined() {
                        copy_map.insert(*defined_value, *src);
                    }
                }
            }
        }

        if copy_map.is_empty() {
            return SsaOptResult { func: ssa_func, changed: false };
        }

        // Step 2: Resolve chains transitively.
        // For dst -> src -> ultimate, collapse to dst -> ultimate.
        // Uses a visited set to break cycles.
        let keys: Vec<SsaValue> = copy_map.keys().copied().collect();
        for dst in keys {
            let mut current = copy_map[&dst];
            let mut visited = HashSet::new();
            visited.insert(dst);
            while copy_map.contains_key(&current) && !visited.contains(&current) {
                visited.insert(current);
                current = copy_map[&current];
            }
            // Only update if we resolved cleanly (no cycle at current)
            if !visited.contains(&current) {
                copy_map.insert(dst, current);
            }
        }

        // Step 3: Rewrite all use-sites in instructions and phi operands.
        // Never rewrite definition sides (defined_value / phi.result).
        let resolve = |v: SsaValue| -> SsaValue {
            copy_map.get(&v).copied().unwrap_or(v)
        };

        let mut any_changed = false;
        let new_blocks = ssa_func.blocks.iter().map(|block| {
            use super::super::block::SsaBlock;
            let mut new_block = SsaBlock::new(block.id, block.label);
            new_block.predecessors.clone_from(&block.predecessors);
            new_block.successors.clone_from(&block.successors);

            // Rewrite phi operand values (not phi.result — that's a definition)
            for phi in &block.phi_functions {
                let new_phi = super::super::function::PhiFunction {
                    result: phi.result,
                    operands: phi.operands.iter().map(|(&blk, &v)| (blk, resolve(v))).collect(),
                };
                if new_phi.operands != phi.operands {
                    any_changed = true;
                }
                new_block.phi_functions.push(new_phi);
            }

            // Rewrite instruction operands
            for instr in &block.instrs {
                let new_instr = rewrite_instr(instr, &resolve);
                if !instrs_eq(instr, &new_instr) {
                    any_changed = true;
                }
                new_block.instrs.push(new_instr);
            }

            new_block
        }).collect();

        if !any_changed {
            return SsaOptResult { func: ssa_func, changed: false };
        }

        SsaOptResult {
            func: SsaFunction::new(
                new_blocks,
                ssa_func.constants,
                ssa_func.entry_block,
                ssa_func.exit_blocks,
                ssa_func.arity,
            ),
            changed: true,
        }
    }
}

/// Rewrite use-site operands in an instruction using the provided resolve function.
/// Definition sides (defined_value) are never touched.
fn rewrite_instr<F: Fn(SsaValue) -> SsaValue>(instr: &SsaInstr, resolve: &F) -> SsaInstr {
    match instr {
        SsaInstr::Move { defined_value, src } =>
            SsaInstr::Move { defined_value: *defined_value, src: resolve(*src) },
        SsaInstr::BinaryOp { defined_value, op, src1, src2 } =>
            SsaInstr::BinaryOp { defined_value: *defined_value, op: *op, src1: resolve(*src1), src2: resolve(*src2) },
        SsaInstr::UnaryOp { defined_value, op, src } =>
            SsaInstr::UnaryOp { defined_value: *defined_value, op: *op, src: resolve(*src) },
        SsaInstr::StoreGlobal { name, src } =>
            SsaInstr::StoreGlobal { name: name.clone(), src: resolve(*src) },
        SsaInstr::JumpIfFalse { src, target } =>
            SsaInstr::JumpIfFalse { src: resolve(*src), target: *target },
        SsaInstr::Call { defined_value, func, args } =>
            SsaInstr::Call { defined_value: *defined_value, func: resolve(*func), args: args.iter().map(|&a| resolve(a)).collect() },
        SsaInstr::Return { src } =>
            SsaInstr::Return { src: resolve(*src) },
        SsaInstr::GetIndex { defined_value, obj, index } =>
            SsaInstr::GetIndex { defined_value: *defined_value, obj: resolve(*obj), index: resolve(*index) },
        SsaInstr::SetIndex { obj, index, src } =>
            SsaInstr::SetIndex { obj: resolve(*obj), index: resolve(*index), src: resolve(*src) },
        SsaInstr::NewArray { defined_value, elements } =>
            SsaInstr::NewArray { defined_value: *defined_value, elements: elements.iter().map(|&e| resolve(e)).collect() },
        SsaInstr::GetField { defined_value, obj, name } =>
            SsaInstr::GetField { defined_value: *defined_value, obj: resolve(*obj), name: name.clone() },
        SsaInstr::SetField { obj, name, src } =>
            SsaInstr::SetField { obj: resolve(*obj), name: name.clone(), src: resolve(*src) },
        SsaInstr::NewInstance { defined_value, class_reg, args } =>
            SsaInstr::NewInstance { defined_value: *defined_value, class_reg: resolve(*class_reg), args: args.iter().map(|&a| resolve(a)).collect() },
        SsaInstr::IsType { defined_value, src, type_name } =>
            SsaInstr::IsType { defined_value: *defined_value, src: resolve(*src), type_name: type_name.clone() },
        SsaInstr::HasCheck { defined_value, obj, field_name } =>
            SsaInstr::HasCheck { defined_value: *defined_value, obj: resolve(*obj), field_name: field_name.clone() },
        // Instructions with no use-site operands to rewrite
        _ => instr.clone(),
    }
}

/// Compare two instructions for structural equality on their use-site operands.
/// (SsaInstr doesn't derive PartialEq due to complex nested types, so we compare
/// the fields we care about — src operands — via the Display representation.)
fn instrs_eq(a: &SsaInstr, b: &SsaInstr) -> bool {
    format!("{}", a) == format!("{}", b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::super::block::{SsaBlock, SsaInstr};
    use super::super::super::function::{PhiFunction, SsaFunction};
    use super::super::super::value::SsaValue;
    use super::super::SsaOptPass;
    use crate::printing_press::inklang::value::Value;

    fn v(base: usize, ver: usize) -> SsaValue { SsaValue::new(base, ver) }

    fn make_single_block_func(instrs: Vec<SsaInstr>) -> SsaFunction {
        let mut block = SsaBlock::new(0, None);
        block.instrs = instrs;
        SsaFunction::new(vec![block], vec![], 0, vec![0], 0)
    }

    // Helper: get first instruction from block 0 at given index
    fn instr(result: &SsaOptResult, idx: usize) -> &SsaInstr {
        &result.func.blocks[0].instrs[idx]
    }

    fn block_instr(result: &SsaOptResult, block: usize, idx: usize) -> &SsaInstr {
        &result.func.blocks[block].instrs[idx]
    }

    #[test]
    fn test_direct_copy_replaced_in_return() {
        // v0.0 = LoadGlobal "x"
        // v1.0 = Move v0.0
        // Return v1.0   <-- should become Return v0.0
        let instrs = vec![
            SsaInstr::LoadGlobal { defined_value: v(0, 0), name: "x".to_string() },
            SsaInstr::Move { defined_value: v(1, 0), src: v(0, 0) },
            SsaInstr::Return { src: v(1, 0) },
        ];
        let func = make_single_block_func(instrs);
        let mut pass = SsaCopyPropagationPass::new();
        let result = pass.run(func);

        assert!(result.changed);
        assert!(matches!(instr(&result, 2), SsaInstr::Return { src } if *src == v(0, 0)));
    }

    #[test]
    fn test_chain_copy_collapses_to_ultimate_source() {
        // v0.0 = LoadGlobal "x"
        // v1.0 = Move v0.0
        // v2.0 = Move v1.0
        // Return v2.0   <-- should become Return v0.0
        let instrs = vec![
            SsaInstr::LoadGlobal { defined_value: v(0, 0), name: "x".to_string() },
            SsaInstr::Move { defined_value: v(1, 0), src: v(0, 0) },
            SsaInstr::Move { defined_value: v(2, 0), src: v(1, 0) },
            SsaInstr::Return { src: v(2, 0) },
        ];
        let func = make_single_block_func(instrs);
        let mut pass = SsaCopyPropagationPass::new();
        let result = pass.run(func);

        assert!(result.changed);
        assert!(matches!(instr(&result, 3), SsaInstr::Return { src } if *src == v(0, 0)));
    }

    #[test]
    fn test_cross_block_propagation() {
        // Block 0: v0.0 = LoadGlobal "x"; v1.0 = Move v0.0; Jump -> block 1
        // Block 1: Return v1.0   <-- should become Return v0.0
        let mut block0 = SsaBlock::new(0, None);
        block0.successors = vec![1];
        block0.instrs = vec![
            SsaInstr::LoadGlobal { defined_value: v(0, 0), name: "x".to_string() },
            SsaInstr::Move { defined_value: v(1, 0), src: v(0, 0) },
        ];

        let mut block1 = SsaBlock::new(1, None);
        block1.predecessors = vec![0];
        block1.instrs = vec![
            SsaInstr::Return { src: v(1, 0) },
        ];

        let func = SsaFunction::new(vec![block0, block1], vec![], 0, vec![1], 0);
        let mut pass = SsaCopyPropagationPass::new();
        let result = pass.run(func);

        assert!(result.changed);
        assert!(matches!(block_instr(&result, 1, 0), SsaInstr::Return { src } if *src == v(0, 0)));
    }

    #[test]
    fn test_phi_operands_are_rewritten() {
        // Block 0: v0.0 = LoadGlobal "x"; v1.0 = Move v0.0
        // Block 1: phi(v1.0 from B0) -> v2.0   <-- operand should become v0.0
        use std::collections::HashMap;

        let mut block0 = SsaBlock::new(0, None);
        block0.successors = vec![1];
        block0.instrs = vec![
            SsaInstr::LoadGlobal { defined_value: v(0, 0), name: "x".to_string() },
            SsaInstr::Move { defined_value: v(1, 0), src: v(0, 0) },
        ];

        let mut block1 = SsaBlock::new(1, None);
        block1.predecessors = vec![0];
        let mut operands = HashMap::new();
        operands.insert(0usize, v(1, 0)); // incoming from block 0
        block1.phi_functions = vec![PhiFunction::new(v(2, 0), operands)];
        block1.instrs = vec![SsaInstr::Return { src: v(2, 0) }];

        let func = SsaFunction::new(vec![block0, block1], vec![], 0, vec![1], 0);
        let mut pass = SsaCopyPropagationPass::new();
        let result = pass.run(func);

        assert!(result.changed);
        // Phi result (v2.0) must NOT be rewritten
        assert_eq!(result.func.blocks[1].phi_functions[0].result, v(2, 0));
        // Phi operand from block 0 must be rewritten to v0.0
        assert_eq!(result.func.blocks[1].phi_functions[0].operands[&0], v(0, 0));
    }

    #[test]
    fn test_phi_result_is_not_rewritten() {
        // v0.0 = LoadGlobal "x"
        // phi result is v0.0 -- if copy map has v0.0->something, phi.result must stay v0.0
        // (This tests the definition-side protection.)
        use std::collections::HashMap;

        // Create a Move that maps v0.0 -> v99.0 in a different block
        // The phi result is v0.0 — it must NOT be replaced.
        let mut block0 = SsaBlock::new(0, None);
        block0.successors = vec![1];
        block0.instrs = vec![
            SsaInstr::LoadGlobal { defined_value: v(99, 0), name: "y".to_string() },
        ];

        let mut block1 = SsaBlock::new(1, None);
        block1.predecessors = vec![0];
        // Phi whose result happens to be v0.0 and operand is v99.0 -- no Move for this
        let mut operands = HashMap::new();
        operands.insert(0usize, v(99, 0));
        block1.phi_functions = vec![PhiFunction::new(v(0, 0), operands)];
        block1.instrs = vec![SsaInstr::Return { src: v(0, 0) }];

        let func = SsaFunction::new(vec![block0, block1], vec![], 0, vec![1], 0);
        let mut pass = SsaCopyPropagationPass::new();
        let result = pass.run(func);

        // No moves, so phi.result must be unchanged
        assert_eq!(result.func.blocks[1].phi_functions[0].result, v(0, 0));
    }

    #[test]
    fn test_undefined_not_propagated() {
        // Move { dst: v1.0, src: UNDEFINED } -- must not add to copy map
        // Return v1.0 should stay v1.0
        let instrs = vec![
            SsaInstr::Move { defined_value: v(1, 0), src: SsaValue::UNDEFINED },
            SsaInstr::Return { src: v(1, 0) },
        ];
        let func = make_single_block_func(instrs);
        let mut pass = SsaCopyPropagationPass::new();
        let result = pass.run(func);

        assert!(!result.changed);
        assert!(matches!(instr(&result, 1), SsaInstr::Return { src } if *src == v(1, 0)));
    }

    #[test]
    fn test_non_move_instructions_untouched() {
        // LoadGlobal is not a Move — should be unchanged, changed=false
        let instrs = vec![
            SsaInstr::LoadGlobal { defined_value: v(0, 0), name: "x".to_string() },
            SsaInstr::Return { src: v(0, 0) },
        ];
        let func = make_single_block_func(instrs);
        let mut pass = SsaCopyPropagationPass::new();
        let result = pass.run(func);

        assert!(!result.changed);
    }

    #[test]
    fn test_changed_false_when_move_exists_but_no_uses_replaced() {
        // v0.0 = LoadGlobal "x"; v1.0 = Move v0.0; Return v0.0
        // Move exists, but the Return already uses v0.0, not v1.0 — no actual replacement
        let instrs = vec![
            SsaInstr::LoadGlobal { defined_value: v(0, 0), name: "x".to_string() },
            SsaInstr::Move { defined_value: v(1, 0), src: v(0, 0) },
            SsaInstr::Return { src: v(0, 0) },
        ];
        let func = make_single_block_func(instrs);
        let mut pass = SsaCopyPropagationPass::new();
        let result = pass.run(func);

        // The Move instruction itself stays (DCE removes it later).
        // The Return already references v0.0 directly, so no use-site changed.
        assert!(!result.changed);
    }
}

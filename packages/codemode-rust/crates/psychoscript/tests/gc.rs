//! What the collector must keep that the conformance cases do not reach.
#![cfg(feature = "gc-incremental")]

use psychoscript::Runtime;

/// A closure only the heap holds swaps the value out of its cell while a cycle marks, so the cell no longer refers to
/// it when the collector gets there: the value it returned must survive anyway. Cycles overlap the swap reliably only
/// with `PSYCHOSCRIPT_GC_STRESS=1`. The padding closure keeps `x` off cell 0, which any zero on the stack keeps.
#[test]
fn a_value_swapped_out_of_a_cell_survives_the_cycle() {
    let code = r#"
        function make() {
          let pad = 0
          const g = () => pad
          let x = { v: g() }
          return (y) => {
            const old = x
            x = y
            return old
          }
        }
        const holder = { f: make() }
        let bad = 0
        for (let i = 1; i < 2000; i++) {
          const old = holder.f({ v: i })
          for (let j = 0; j < 300; j++) [j, { j }]
          if (old.v !== i - 1) bad++
        }
        return bad
    "#;
    let outcome = Runtime::make().execute(code);
    assert_eq!(outcome.json().unwrap(), serde_json::json!(0));
}

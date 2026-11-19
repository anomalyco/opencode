//! What the collector must keep that the conformance cases do not reach.

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

/// Map keys and property names made and dropped all the time: their atoms are freed and their ids reused, so the
/// atom table stays near what is live (about 2,000 keys) instead of growing by one per key ever used (about 200,000
/// here). The run stops for the host every round, where it reports its heap.
#[cfg(feature = "gc-stats")]
#[test]
fn atoms_of_dropped_keys_are_freed() {
    use std::sync::{Arc, Mutex};

    use psychoscript::{HostFunction, HostValue};

    let code = r#"
        const m = new Map()
        let n = 0
        for (let round = 0; round < 200; round++) {
          for (let j = 0; j < 500; j++, n++) {
            m.set("key" + n, n)
            if (n >= 1000) m.delete("key" + (n - 1000))
            const o = { [`dyn${n}`]: n }
            o[`dyn${n + 1}`] = n
            delete o[`dyn${n}`]
          }
          await tick()
        }
        let sum = 0
        for (const [k, v] of m) if (k === "key" + v) sum += 1
        return [m.size, sum, m.get("key" + (n - 1))]
    "#;
    let peak = Arc::new(Mutex::new(0u64));
    let seen = peak.clone();
    let rt = Runtime::make().globals(move |run| {
        let (run, seen) = (run.clone(), seen.clone());
        [(
            "tick",
            HostFunction::new_async(move |_, _| {
                let atoms = run.heap_stats().atoms;
                let mut p = seen.lock().unwrap();
                *p = (*p).max(atoms);
                async { Ok(HostValue::Undefined) }
            }),
        )]
    });
    let outcome = rt.execute(code);
    assert_eq!(
        outcome.json().unwrap(),
        serde_json::json!([1000, 1000, 99999])
    );
    let peak = *peak.lock().unwrap();
    assert!(peak > 0 && peak < 40_000, "{peak} atoms at most");
}

/// `JSON.stringify` keeps an object's keys while a replacer runs, and the replacer may delete the properties and
/// allocate enough for cycles to run: the keys still left to write, held by nothing but the walk, must keep their
/// atoms, or they would print under another key's name. Cycles overlap the walk reliably only with
/// `PSYCHOSCRIPT_GC_STRESS=1`.
#[test]
fn keys_only_json_stringify_holds_survive() {
    let code = r#"
        function churn() {
          const a = []
          for (let i = 0; i < 200; i++) a.push({ i })
          return a.length
        }
        let bad = 0
        for (let r = 0; r < 40; r++) {
          const o = {}
          for (let k = 0; k < 10; k++) o["p" + r + "_" + k] = k
          const first = "p" + r + "_0"
          const got = JSON.stringify(o, function (key, v) {
            churn()
            if (key === first) for (const k of Object.keys(this)) if (k !== first) delete this[k]
            return v === undefined ? "gone" : v
          })
          let want = '{"' + first + '":0'
          for (let k = 1; k < 10; k++) want += ',"p' + r + "_" + k + '":"gone"'
          if (got !== want + "}") bad++
        }
        return bad
    "#;
    let outcome = Runtime::make().execute(code);
    assert_eq!(outcome.json().unwrap(), serde_json::json!(0));
}

/// Accessor halves only an accessor holds: a getter and setter defined and replaced on a long-lived object while cycles
/// run (a write of a pair into an object already traced must reach the collector), and an accessor's pair copied by
/// `defineProperty` from a descriptor that is then dropped. Cycles overlap the writes reliably only with
/// `PSYCHOSCRIPT_GC_STRESS=1`.
#[test]
fn accessor_halves_survive_the_cycle() {
    let code = r#"
        const holder = { n: 0 }
        let bad = 0
        for (let i = 1; i < 1500; i++) {
          const v = { i }
          Object.defineProperty(holder, "x", { get() { return v }, set(w) { v.i = w }, configurable: true })
          const lit = { get y() { return [i] } }
          holder.lit = lit
          for (let j = 0; j < 200; j++) [j, { j }]
          holder.x = holder.x.i + 1
          if (holder.x.i !== i + 1 || holder.lit.y[0] !== i) bad++
        }
        return bad
    "#;
    let outcome = Runtime::make().execute(code);
    assert_eq!(outcome.json().unwrap(), serde_json::json!(0));
}

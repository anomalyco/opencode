//! Map and Set iteration while deleted entries are compacted away: iterators, `forEach` and the Set methods continue
//! past deletes and inserts, skip what was deleted before they reached it, see what was added, and continue after
//! `clear()`, also across a suspend in the middle of a walk. The expected values are what JavaScript engines give.

use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

use psychoscript::{HostFunction, HostValue, Json, ProgramOptions, RunOutcome, Runtime};
use serde_json::json;

fn value(code: &str) -> Json {
    match Runtime::make().execute(code).result {
        Ok(v) => v.to_json(),
        Err(e) => panic!("expected success, got {}: {}", e.kind, e.message),
    }
}

#[test]
fn for_of_over_a_map_continues_across_compaction() {
    let code = r#"
        const m = new Map()
        for (let i = 0; i < 100; i++) m.set(i, i)
        const seen = []
        for (const [k, v] of m) {
          seen.push([k, v])
          if (k === 10) {
            for (let i = 0; i < 10; i++) m.delete(i)
            for (let i = 20; i < 100; i++) if (i % 10 !== 0) m.delete(i)
            m.set(5, "again")
            m.set(200, 200)
          }
          if (k === 200) {
            m.clear()
            m.set(300, 300)
            m.set(301, 301)
          }
          if (k === 300) m.delete(301)
        }
        return seen"#;
    let mut expected: Vec<Json> = (0..20).map(|i| json!([i, i])).collect();
    expected.extend((20..100).step_by(10).map(|i| json!([i, i])));
    expected.extend([json!([5, "again"]), json!([200, 200]), json!([300, 300])]);
    assert_eq!(value(code), Json::Array(expected));
}

#[test]
fn for_of_over_a_set_continues_across_compaction() {
    let code = r#"
        const s = new Set()
        for (let i = 0; i < 100; i++) s.add(i)
        const seen = []
        for (const v of s) {
          seen.push(v)
          if (v === 3) for (let i = 0; i < 90; i++) if (i !== 50) s.delete(i)
          if (v === 50) { s.add(1); s.add(1000) }
        }
        return seen"#;
    assert_eq!(
        value(code),
        json!([
            0, 1, 2, 3, 50, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 1, 1000
        ])
    );
}

#[test]
fn keys_values_and_entries_iterators_continue_across_compaction_and_clear() {
    let code = r#"
        const m = new Map()
        for (let i = 0; i < 50; i++) m.set("k" + i, i)
        const keys = m.keys(), values = m.values(), entries = m.entries()
        const out = [keys.next().value, values.next().value, entries.next().value]
        for (let i = 0; i < 45; i++) m.delete("k" + i)
        m.set("new", -1)
        out.push(keys.next().value, values.next().value, entries.next().value)
        for (let i = 46; i < 50; i++) m.delete("k" + i)
        out.push(keys.next().value, values.next().value, entries.next().value)
        m.clear()
        m.set("after", 1)
        out.push(keys.next().value, values.next().value, entries.next().value)
        out.push(keys.next().done, values.next().done, entries.next().done)
        m.set("late", 2)
        out.push(keys.next().done, values.next().done, entries.next().done)
        return out"#;
    assert_eq!(
        value(code),
        json!([
            "k0",
            0,
            ["k0", 0],
            "k45",
            45,
            ["k45", 45],
            "new",
            -1,
            ["new", -1],
            "after",
            1,
            ["after", 1],
            true,
            true,
            true,
            true,
            true,
            true
        ])
    );
    let code = r#"
        const s = new Set()
        for (let i = 0; i < 80; i++) s.add(i)
        const it = s.values(), en = s.entries()
        const out = [it.next().value, en.next().value]
        s.add(-1)
        for (let i = 1; i < 79; i++) s.delete(i)
        out.push(it.next().value, en.next().value, it.next().value, en.next().value)
        s.delete(-1)
        s.add(5)
        out.push(it.next().value, en.next().value, it.next().done, en.next().done)
        return out"#;
    assert_eq!(
        value(code),
        json!([0, [0, 0], 79, [79, 79], -1, [-1, -1], 5, [5, 5], true, true])
    );
}

#[test]
fn for_each_continues_across_compaction_and_clear() {
    let code = r#"
        const m = new Map()
        for (let i = 0; i < 100; i++) m.set(i, "v" + i)
        const seen = []
        m.forEach((v, k, map) => {
          seen.push(k + ":" + v)
          if (k === 2) for (let i = 0; i < 2; i++) map.delete(i)
          if (k === 4) for (let i = 5; i < 98; i++) if (i % 30 !== 0) map.delete(i)
          if (k === 30) { map.set(0, "back"); map.delete(60) }
          if (v === "back") { map.clear(); map.set("x", 1) }
        })
        const s = new Set()
        for (let i = 0; i < 100; i++) s.add(i)
        s.add("last")
        s.forEach(v => {
          seen.push(v)
          if (v === 0) for (let i = 1; i < 99; i++) s.delete(i)
          if (v === 99) s.add("tail")
        })
        return seen"#;
    assert_eq!(
        value(code),
        json!([
            "0:v0", "1:v1", "2:v2", "3:v3", "4:v4", "30:v30", "90:v90", "98:v98", "99:v99",
            "0:back", "x:1", 0, 99, "last", "tail"
        ])
    );
}

#[test]
fn set_methods_continue_when_their_walk_is_compacted() {
    let code = r#"
        const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i)
        const out = {}
        // A built-in has: difference deletes from the Set it builds while walking it.
        out.differenceBuiltin = [...new Set(range(0, 100)).difference(new Set([...range(0, 97), 500, 501, 502, 503]))]
        // A has the program wrote, asked from a native frame.
        out.difference = [...new Set(range(0, 100)).difference({ size: 1000, has: x => x < 97, keys: () => [].values() })]
        const a = new Set(range(0, 100))
        out.intersection = [...a.intersection({
          size: 1000,
          has(x) {
            if (x === 5) for (let i = 6; i < 90; i++) a.delete(i)
            return x % 2 === 0
          },
          keys: () => [].values(),
        })]
        const b = new Set(range(0, 100))
        const asked = []
        out.isSubsetOf = b.isSubsetOf({
          size: 1000,
          has(x) {
            asked.push(x)
            if (x === 0) for (let i = 1; i < 99; i++) b.delete(i)
            return true
          },
          keys: () => [].values(),
        })
        out.asked = asked
        const c = new Set(range(0, 100))
        out.isDisjointFrom = c.isDisjointFrom({
          size: 1000,
          has(x) {
            if (x === 1) { for (let i = 2; i < 99; i++) c.delete(i); c.add(-5) }
            return x === -5
          },
          keys: () => [].values(),
        })
        const d = new Set(range(0, 100))
        out.union = [...new Set(["a"]).union({
          size: 100,
          has: () => false,
          keys() {
            const it = d.keys()
            return {
              next() {
                const r = it.next()
                if (r.value === 3) for (let i = 4; i < 95; i++) d.delete(i)
                return r
              },
            }
          },
        })]
        return out"#;
    assert_eq!(
        value(code),
        json!({
            "differenceBuiltin": [97, 98, 99],
            "difference": [97, 98, 99],
            "intersection": [0, 2, 4, 90, 92, 94, 96, 98],
            "isSubsetOf": true,
            "asked": [0, 99],
            "isDisjointFrom": false,
            "union": ["a", 0, 1, 2, 3, 95, 96, 97, 98, 99]
        })
    );
}

/// Marks that the program called `reached()`, after which it busy-waits so a suspend lands mid-walk.
#[derive(Clone, Default)]
struct Reached(Arc<(Mutex<bool>, Condvar)>);

impl Reached {
    fn mark(&self) {
        let (m, c) = &*self.0;
        *m.lock().unwrap() = true;
        c.notify_all();
    }

    fn wait(&self) {
        let (m, c) = &*self.0;
        let mut r = m.lock().unwrap();
        while !*r {
            r = c.wait_timeout(r, Duration::from_millis(10)).unwrap().0;
        }
    }
}

fn reaching(reached: Reached) -> Runtime {
    Runtime::make().globals(move |_| {
        let reached = reached.clone();
        [(
            "reached",
            HostFunction::new(move |_, _| {
                reached.mark();
                HostValue::Undefined
            }),
        )]
    })
}

/// Suspends `code` while it busy-waits after `reached()`, resumes it from bytes in a fresh runtime, and gives its
/// result.
fn suspended_mid_walk(code: &str) -> Json {
    let reached = Reached::default();
    let rt = reaching(reached.clone());
    let program = rt.program(code, &ProgramOptions::new());
    let suspender = program.suspender();
    let (outcome, answer) = thread::scope(|s| {
        let h = s.spawn(move || {
            reached.wait();
            // The suspend is refused while `reached()` itself runs.
            for _ in 0..1000 {
                match suspender.suspend(None) {
                    Err(e) if !e.running.is_empty() => thread::sleep(Duration::from_millis(1)),
                    other => return other,
                }
            }
            suspender.suspend(None)
        });
        (program.run_resumable().unwrap(), h.join().unwrap())
    });
    let RunOutcome::Suspended(state) = outcome else {
        panic!("expected a suspended run, got {answer:?}");
    };
    let fresh = reaching(Reached::default());
    let resumed = fresh
        .resume_bytes(&psychoscript::to_bytes(&state.state))
        .unwrap()
        .run_resumable()
        .unwrap();
    match resumed {
        RunOutcome::Done(o) => o.result.unwrap().to_json(),
        RunOutcome::Suspended(_) => panic!("expected the resumed run to end"),
    }
}

#[test]
fn a_for_of_suspended_after_compaction_resumes_where_it_was() {
    let code = r#"
        const m = new Map()
        for (let i = 0; i < 100; i++) m.set(i, i)
        const seen = []
        for (const [k] of m) {
          seen.push(k)
          if (k === 10) {
            for (let i = 0; i < 10; i++) m.delete(i)
            for (let i = 20; i < 100; i++) if (i % 10 !== 0) m.delete(i)
            reached()
            const t = Date.now(); while (Date.now() - t < 300) {}
            m.delete(30)
            m.set(1, "again")
          }
        }
        return seen"#;
    let mut expected: Vec<Json> = (0..21).map(|i| json!(i)).collect();
    expected.extend([40, 50, 60, 70, 80, 90, 1].map(|i| json!(i)));
    assert_eq!(suspended_mid_walk(code), Json::Array(expected));
}

#[test]
fn a_for_each_suspended_after_compaction_resumes_where_it_was() {
    let code = r#"
        const s = new Set()
        for (let i = 0; i < 100; i++) s.add(i)
        const seen = []
        s.forEach(v => {
          seen.push(v)
          if (v === 10) {
            for (let i = 0; i < 95; i++) if (i % 20 !== 0) s.delete(i)
            reached()
            const t = Date.now(); while (Date.now() - t < 300) {}
            s.delete(40)
            s.add(7)
          }
        })
        return seen"#;
    assert_eq!(
        suspended_mid_walk(code),
        json!([
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 60, 80, 95, 96, 97, 98, 99, 7
        ])
    );
}

#[test]
fn a_set_method_suspended_after_compaction_resumes_where_it_was() {
    let code = r#"
        const a = new Set()
        for (let i = 0; i < 100; i++) a.add(i)
        return [...a.intersection({
          size: 1000,
          has(x) {
            if (x === 5) {
              for (let i = 6; i < 90; i++) a.delete(i)
              reached()
              const t = Date.now(); while (Date.now() - t < 300) {}
              a.delete(92)
              a.add(200)
            }
            return x % 2 === 0
          },
          keys: () => [].values(),
        })]"#;
    assert_eq!(
        suspended_mid_walk(code),
        json!([0, 2, 4, 90, 94, 96, 98, 200])
    );
}

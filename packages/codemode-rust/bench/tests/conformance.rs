//! Runs every `conformance/cases/<name>.js` through `psychoscript::Runtime` and compares it with the reference outcome
//! in `<name>.json`. Reports every failing case at once. `CONFORMANCE_FILTER=<substring>` narrows the run. A case
//! with a `// @platform "<os>"` header is checked only on that OS, where `conformance/generate.ts` records it. Every
//! case runs twice: blocking, and as a future, where a long stretch of compute continues on a worker thread.

use std::panic::{self, AssertUnwindSafe};
use std::path::Path;

use psychoscript::{
    HostValue, Json, Limits, ProgramOptions, Runtime, Translate, TranslateFunctions,
    TranslatePromises,
};

#[path = "../../conformance/reference.rs"]
mod reference;

use reference::same;

/// The reference generator's runtime: only the `tools` namespace, with the case's limits and translation.
fn runtime(limits: Limits, translate: Translate) -> Runtime {
    Runtime::make()
        .globals(|_| [("tools", HostValue::from(reference::tools()))])
        .limits(limits)
        .translate(translate)
}

fn check(name: &str, code: &str, expected: &Json, future: bool) -> Result<(), String> {
    let bindings = expected["bindings"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    let limits = Limits {
        timeout_ms: expected["limits"]["timeout_ms"].as_u64(),
        max_output_bytes: expected["limits"]["max_output_bytes"]
            .as_u64()
            .map(|n| n as usize),
    };
    let translate = Translate {
        functions: match expected["translate"]["functions"].as_str() {
            Some("drop") => TranslateFunctions::Drop,
            _ => TranslateFunctions::Error,
        },
        promises: match expected["translate"]["promises"].as_str() {
            Some("await") => TranslatePromises::Await,
            _ => TranslatePromises::Error,
        },
    };
    let rt = runtime(limits, translate);
    let options = ProgramOptions::new().bindings(bindings);
    let run = || match future {
        true => drive(rt.execute_async(code, &options)).unwrap_or_else(|i| psychoscript::Outcome {
            result: Err(psychoscript::Diagnostic {
                kind: psychoscript::DiagnosticKind::ExecutionFailure,
                message: i.to_string().into(),
                location: None,
                suggestions: Vec::new(),
            }),
            warnings: Vec::new(),
            logs: Vec::new(),
            truncated: false,
            metadata: psychoscript::Data::Null,
        }),
        false => rt.execute_with(code, &options),
    };
    let outcome = panic::catch_unwind(AssertUnwindSafe(run)).map_err(|payload| {
        let msg = payload
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).to_owned()))
            .unwrap_or_default();
        format!("{name}: panicked: {msg}")
    })?;

    let mut problems = Vec::new();
    match (&outcome.result, expected["ok"].as_bool()) {
        (Ok(value), Some(true)) => {
            if !same(&value.to_json(), &expected["value"]) {
                problems.push(format!(
                    "value\n    expected: {}\n    actual:   {value}",
                    expected["value"]
                ));
            }
        }
        (Err(d), Some(false)) => {
            if d.kind.name() != expected["kind"] {
                problems.push(format!(
                    "kind: expected {}, got {} ({})",
                    expected["kind"],
                    d.kind.name(),
                    d.message
                ));
            }
        }
        (Ok(value), _) => problems.push(format!(
            "expected {} error, got ok: {value}",
            expected["kind"]
        )),
        (Err(d), _) => problems.push(format!(
            "expected ok {}, got {}: {}",
            expected["value"],
            d.kind.name(),
            d.message
        )),
    }
    if let Some(metadata) = expected.get("metadata")
        && !same(&outcome.metadata.to_json(), metadata)
    {
        problems.push(format!(
            "metadata\n    expected: {metadata}\n    actual:   {}",
            outcome.metadata
        ));
    }
    if let Some(logs) = expected.get("logs") {
        let actual = Json::from(outcome.log_lines());
        if !same(&actual, logs) {
            problems.push(format!(
                "logs\n    expected: {logs}\n    actual:   {actual}"
            ));
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(format!("{name}: {}", problems.join("\n  ")))
    }
}

#[test]
fn conformance() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../conformance/cases");
    let filter = std::env::var("CONFORMANCE_FILTER").unwrap_or_default();
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .expect("conformance/cases")
        .filter_map(|e| {
            e.ok()?
                .file_name()
                .into_string()
                .ok()?
                .strip_suffix(".js")
                .map(str::to_owned)
        })
        .filter(|n| n.contains(&filter))
        .collect();
    names.sort();
    assert!(!names.is_empty(), "no conformance cases matched");

    let hook = panic::take_hook();
    panic::set_hook(Box::new(|_| {}));
    let failures: Vec<String> = names
        .iter()
        .filter_map(|name| {
            let code = std::fs::read_to_string(dir.join(format!("{name}.js"))).unwrap();
            let platform = code
                .lines()
                .find_map(|l| l.strip_prefix("// @platform "))
                .map(|p| serde_json::from_str::<String>(p).unwrap());
            if platform.is_some_and(|p| p != std::env::consts::OS) {
                return None;
            }
            let expected: Json = serde_json::from_str(
                &std::fs::read_to_string(dir.join(format!("{name}.json"))).unwrap(),
            )
            .unwrap();
            check(name, &code, &expected, false)
                .and_then(|()| {
                    check(name, &code, &expected, true).map_err(|p| format!("as a future: {p}"))
                })
                .err()
        })
        .collect();
    panic::set_hook(hook);

    if !failures.is_empty() {
        panic!(
            "{} of {} conformance cases failed:\n{}",
            failures.len(),
            names.len(),
            failures.join("\n")
        );
    }
    println!("{} conformance cases passed", names.len());
}

/// Polls a future to its end on this thread, parking until it is woken.
fn drive<F: std::future::Future>(future: F) -> F::Output {
    struct Unpark(std::thread::Thread);
    impl std::task::Wake for Unpark {
        fn wake(self: std::sync::Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = std::task::Waker::from(std::sync::Arc::new(Unpark(std::thread::current())));
    let mut cx = std::task::Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    loop {
        if let std::task::Poll::Ready(v) = future.as_mut().poll(&mut cx) {
            return v;
        }
        std::thread::park();
    }
}

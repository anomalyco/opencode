//! Runs a program file and prints its outcome: `cargo run --example run -- program.js`. The program reaches one host
//! global, a `tools` namespace with an async `echo` that gives its input's `id`.

use psychoscript::{Failure, HostFunction, HostValue, Limits, Namespace, Resolved, Runtime};

fn main() {
    let path = std::env::args().nth(1).expect("usage: run <program.js>");
    let code = std::fs::read_to_string(&path).expect("readable program");
    let tools = Namespace::new(
        |path| match path {
            [] => Ok(vec!["echo".into()]),
            _ => Ok(Vec::new()),
        },
        |path| -> Resolved {
            match path {
                [name] if name == "echo" => HostFunction::new_async(|args, _| async move {
                    Ok(args
                        .first()
                        .and_then(|a| a.get("id"))
                        .cloned()
                        .unwrap_or(HostValue::Null))
                })
                .into(),
                _ => Failure::missing(format!(
                    "No function at tools.{}.",
                    path.iter()
                        .map(|k| k.to_string())
                        .collect::<Vec<_>>()
                        .join(".")
                ))
                .into(),
            }
        },
    );
    let runtime = Runtime::make()
        .globals(move |_| [("tools", HostValue::from(tools.clone()))])
        .limits(Limits {
            timeout_ms: Some(2000),
            max_output_bytes: None,
        });
    let outcome = runtime.execute(&code);
    for line in &outcome.logs {
        println!("log: {line}");
    }
    match outcome.result {
        Ok(v) => println!("ok: {v}"),
        Err(d) => println!("error: {}: {} {:?}", d.kind, d.message, d.location),
    }
}

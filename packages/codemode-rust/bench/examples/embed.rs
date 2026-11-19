//! Minimal embedding: the `tools` namespace of the conformance harness, one program, print the result.

use psychoscript::{HostValue, Runtime};

#[path = "../../conformance/reference.rs"]
mod reference;

fn main() {
    let runtime = Runtime::make().globals(|_| [("tools", HostValue::from(reference::tools()))]);
    let code = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "return 1".to_owned());
    let outcome = runtime.execute(&code);
    for line in &outcome.logs {
        eprintln!("{line}");
    }
    match outcome.result {
        Ok(value) => println!("{value}"),
        Err(d) => {
            eprintln!("{}: {}", d.kind, d.message);
            std::process::exit(1);
        }
    }
}

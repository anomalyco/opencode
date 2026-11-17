//! Minimal embedding: one tool, one program, print the result.

use psychoscript::Runtime;

fn main() {
    let runtime = Runtime::new().tool("echo", |input| Ok(input.clone()));
    let code = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "return 1".to_owned());
    let outcome = runtime.execute(&code, &serde_json::Map::new());
    for line in &outcome.logs {
        eprintln!("{line}");
    }
    match outcome.result {
        Ok(value) => println!("{value}"),
        Err(d) => {
            eprintln!("{:?}: {}", d.kind, d.message);
            std::process::exit(1);
        }
    }
}

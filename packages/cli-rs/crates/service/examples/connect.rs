//! Connects the way the CLI does and prints the server version from `/api/info`.
//!
//! `cargo run -p opencode-service --example connect [-- --print-logs] [--server URL]
//! [--standalone] [--no-autostart]`. Without a running service it starts the TypeScript one
//! (`OPENCODE_TS_BIN`, else `opencode`).

use opencode_api::transport::Reqwest;
use opencode_local::paths::Paths;
use opencode_service::connect::{self, Env, Options};
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut env = Env::from_env();
    env.print_logs |= args.iter().any(|arg| arg == "--print-logs");
    let options = Options {
        server: args.iter().position(|arg| arg == "--server").and_then(|index| args.get(index + 1).cloned()),
        standalone: args.iter().any(|arg| arg == "--standalone"),
        client_version: "local".to_owned(),
        standalone_fallback: args.iter().any(|arg| arg == "--no-autostart"),
        on_start: Some(|| eprintln!("Starting background server...")),
    };
    let transport = Arc::new(Reqwest::default());
    let connection = connect::resolve(transport.clone(), &Paths::from_env()?, &env, &options).await?;
    // A second, typed request through the generated client, with the endpoint's credentials.
    let info = connection.endpoint.client(transport)?.server_info().await?;
    println!("source:  {:?}", connection.source);
    println!("url:     {}", connection.endpoint.url);
    println!("version: {}", info.version);
    Ok(())
}

//! The opencode-rs binary. C.0 replaces this with the command tree.

// Like the TypeScript CLI, a build without OPENCODE_VERSION reports "local".
const VERSION: &str = match option_env!("OPENCODE_VERSION") {
    Some(version) => version,
    None => "local",
};

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("--version") => println!("{VERSION}"),
        _ => {
            eprintln!("usage: opencode-rs --version");
            std::process::exit(1);
        }
    }
}

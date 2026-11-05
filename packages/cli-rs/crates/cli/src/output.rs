//! Writing to stdout, and how errors end the process.

use std::io::{ErrorKind, Write};

/// Writes `text` to stdout. A closed pipe (`opencode-rs ... | head`) is not an error, as in
/// `packages/cli/src/node/index.ts:4-7`; `print!` would panic instead.
pub fn print(text: &str) -> anyhow::Result<()> {
    let mut stdout = std::io::stdout().lock();
    match stdout.write_all(text.as_bytes()).and_then(|()| stdout.flush()) {
        Err(error) if error.kind() != ErrorKind::BrokenPipe => Err(error.into()),
        _ => Ok(()),
    }
}

/// An error that ends the process with `code` after the handler has reported what happened itself.
#[derive(Debug)]
pub struct Exit(pub u8);

impl std::fmt::Display for Exit {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "exit {}", self.0)
    }
}

impl std::error::Error for Exit {}

/// The exit code for a failed handler: `Exit` keeps its code and prints nothing; any other error prints to
/// stderr and exits 1.
pub fn fail(error: anyhow::Error) -> u8 {
    if let Some(exit) = error.downcast_ref::<Exit>() {
        return exit.0;
    }
    eprintln!("Error: {error:#}");
    1
}

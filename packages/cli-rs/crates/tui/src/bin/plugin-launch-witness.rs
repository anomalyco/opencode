//! For the tests: a program that witnesses its own launch, on every platform, without a shell. It adds a line to the
//! file its one argument names, and prints nothing (`tests/all/plugin_ownership.rs`).

use std::io::Write;

fn main() {
    let Some(path) = std::env::args_os().nth(1) else { return };
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path).expect("the witness file opens");
    writeln!(file, "launched").expect("the witness file takes a line");
}

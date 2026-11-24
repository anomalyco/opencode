# opencode-pty

## Objective

Build a persistent Rust PTY service. The service owns multiple terminal child
processes, continuously drains output, parses it with libghostty-vt, retains a
bounded raw replay tail, and exposes thread-safe terminal operations.

## Current Scope

- Use portable-pty directly.
- Give each terminal blocking reader, actor/parser, writer, and child-wait
  threads.
- Keep libghostty-vt on the actor thread that creates it.
- Bound raw output, input, and actor queues.
- Make libghostty authoritative for terminal-generated PTY responses.
- Provide an interactive local CLI for exercising multiple terminals.
- Do not add OpenCode IPC integration yet.
- Do not implement descriptor passing or live service replacement.

## Engineering Rules

- Never block the service control path on PTY I/O.
- Never perform a blocking write from a libghostty callback.
- Keep exactly one PTY reader and one PTY writer per terminal.
- Preserve child-exit and PTY-EOF as distinct lifecycle signals.
- Treat PID as metadata, never terminal identity.
- Bound by bytes, not only message count.
- Do not expose borrowed libghostty values outside the actor thread.
- Keep terminal shutdown idempotent and join all worker threads.

## Verification

```sh
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo run -- play
```

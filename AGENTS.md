# AGENTS.md

## Project

pencode — Rust rewrite of the opencode coding agent. Cargo workspace under `crates/`.

- Default branch: `dev`. The `rust-rewrite` branch holds the Rust implementation.
- Build: `cargo build` · Test: `cargo test --workspace` · Lint: `cargo clippy --workspace`
- Run tests with cargo from the repo root; per-package tests via `cargo test -p <crate>`.

## Architecture

Dependency direction: `pencode (bin)` → server/client/tui → core → protocol. The
protocol crate must stay dependency-light (serde types only); core owns config,
session storage, and tools; server/client/tui compose core.

## Style Guide

- Use `anyhow::Result` at application boundaries; add context with `.with_context()`.
- Prefer serde camelCase wire formats to match upstream opencode clients.
- Keep handlers thin in pencode-server; logic belongs in core.
- No `unwrap()`/`expect()` outside tests.
- Use early returns; avoid deep nesting.
- Add comments only for non-obvious constraints.

## Testing

- Unit tests live next to code in `#[cfg(test)] mod tests`.
- Server integration tests use `tower::ServiceExt::oneshot` (see `crates/pencode-server/tests/api.rs`).

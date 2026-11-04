//! `acp --login` (`packages/cli/src/commands/handlers/acp.ts:16-23`).
//!
//! C.12 (`rs-acp-rest`) owns this file. TS runs `auth login` with no target, method, or answers. The
//! CLI calls [`run`] before it starts the agent.

/// Runs the login flow. `None` means C.12 has not built it yet, and the CLI reports that.
pub fn run() -> Option<anyhow::Result<()>> {
    None
}

# @opencode/core

Core runtime services for OpenCode.

## Sandbox execution

`experimental.sandbox_execution: true` (or `OPENCODE_FLAGS=sandbox_execution`) runs tool
processes with credential-like environment variables removed and their working directory
pinned to the project. It also applies to shell commands that use the persistent process
daemon. Enable it from the TUI's Experiments dialog.

This is a process-environment boundary, not an OS security boundary: a command can still
read files the host user can read, and filesystem tool calls are unchanged. It is
opt-in-only in every build channel.

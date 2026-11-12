# O89: a slash command waits for a pending interrupt

**TypeScript.** Submitting a keymap command with slash arguments (`/btw <question>`) runs it at once
(`argumentSlash` in `packages/tui/src/component/prompt/index.tsx`). Its requests and a pending `session.interrupt`
are separate fetches, so the server can receive the command's request before the interrupt, as it can for a prompt.

**Rust.** When the composer's session has an interrupt request without an answer, the command runs once every
pending interrupt of that session has its answer (`prompt/submit.rs`), as a prompt's requests do. Without one it
runs at once, as in TS.

**Reach.** Only a command submitted right after a second Escape (or `ctrl+⏎` of force-input) on a running session,
before the server answers the interrupt. The command's dialog or toast shows after that answer.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations.

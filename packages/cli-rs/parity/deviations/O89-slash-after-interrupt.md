# O89: a slash command waits for a pending interrupt

**TypeScript.** A slash command runs at once, however it is chosen: submitted with arguments (`/btw <question>`,
`argumentSlash` in `packages/tui/src/component/prompt/index.tsx`), picked from the autocomplete popup, or picked
from the command palette. Its requests and a pending `session.interrupt` are separate fetches, so the server can
receive the command's request before the interrupt, as it can for a prompt.

**Rust.** While the session has an interrupt request without an answer, the command runs once every pending
interrupt of that session has its answer, as a prompt's requests do (`Shared::after_interrupts` in
`prompt/editor.rs`). This applies to a command submitted with arguments and to one picked from the popup, both for
the composer's session, and to a palette command with a slash name, for the session in view. Without a pending
interrupt the command runs at once, as in TS.

**Reach.** Only a slash command chosen right after a second Escape (or `ctrl+⏎` of force-input) on a running
session, before the server answers the interrupt. The command's dialog or toast shows after that answer.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations.

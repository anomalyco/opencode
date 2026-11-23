# OT817: `super+backspace` deletes to the start of the line in the prompt

TypeScript: the TUI uses `@opentui/core` 0.8.4 from npm. Its default textarea bindings have no `super+backspace`, so
the key does nothing in the prompt.

Rust: the client pins OpenTUI `ff703d174`, which includes anomalyco/opentui#817. The managed textarea layer
(`ui/src/keymap/mod.rs`) appends OpenTUI's `TEXTAREA_BINDINGS` after the configured `input.*` keys, and those now
bind `super+backspace` to `input.delete.to.line.start`, as macOS editors bind Cmd+Backspace. A terminal sends the
key only when it reports the super modifier (the kitty keyboard protocol with Cmd or Super passed through), so most
setups see no difference.

Reason: the OpenTUI change landed after the npm release that TS uses. The difference goes away when TS moves to an
`@opentui/core` release that includes #817.

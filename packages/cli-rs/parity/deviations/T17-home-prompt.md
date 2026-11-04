# T17: the home prompt draws no placeholder

TypeScript: the home passes its placeholders to the prompt (`packages/tui/src/routes/home.tsx:20-23`), so the
empty prompt shows `Ask anything… "<one picked at random>"` in the muted color.

Rust: E.1 builds the home as TS does (the logo, the prompt slot of at most 75 columns, the footer with the
version), and E.2's prompt fills the slot cell for cell. The prompt has no placeholder yet, so its first row is
empty. P-APP `E.1/home`, `E.1/home-narrow`, `E.1/events`, `E.1/mcp-toast`, `E.1/model-invalid` mask that row
(the TS text is random anyway); `H.2/home-sessions` (`home`, `list`) differs in it.

Reason: not built yet. The prompt (E.2's `prompt/editor.rs`) takes the placeholders; then the masks keep only
the random text, and this file and the `deviation` entries that name it go.

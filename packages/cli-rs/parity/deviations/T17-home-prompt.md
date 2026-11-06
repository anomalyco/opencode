# T17: the home prompt draws no placeholder

TypeScript: the home passes its placeholders to the prompt (`packages/tui/src/routes/home.tsx:20-23`), so the
empty prompt shows `Ask anything… "<one picked at random>"` in the muted color.

Rust: E.1 builds the home as TS does (the logo, the prompt slot of at most 75 columns, the footer with the
version), and E.2's prompt fills the slot cell for cell. The prompt has no placeholder yet, so its first row is
empty. The P-APP and P-TUI scenarios that show the home mask that row with a rectangle (the TS text is random
anyway), or its first three cells where a dialog covers the rest.

Reason: not built yet. The prompt (E.2's `prompt/editor.rs`) takes the placeholders; then the masks keep only
the random text, and this file goes.

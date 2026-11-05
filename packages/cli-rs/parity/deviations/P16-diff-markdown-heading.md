# P16: a Markdown heading in a diff keeps the plain diff color

TypeScript: the `patch` row of a created `docs/lexer.md` shows its added line `# Lexer` in the heading color
(`#9d7cd8ff`, bold and italic) on the added-line background.

Rust: the same seven cells show the added-line text color (`#eeeeeeff`, no attributes). The background matches.
Rust code in a diff is highlighted the same on both sides (P-TUI `E.7a/tools`), and Markdown outside a diff matches
(`U.4b/markdown`), so the difference is Markdown in the diff view, which Core highlights with the inline grammar
injected and opentui-rust's `Diff` apparently does not.

P-TUI `E.7b/blocks` (`open` row 24) shows it.

Reason: an open Rust defect, found by `rs-sim-scenarios`, not yet fixed. The fix removes this file.

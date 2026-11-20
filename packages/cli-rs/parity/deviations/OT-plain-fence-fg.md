# OT: a fence with no highlighting takes the syntax theme's `default` color

**TypeScript (`@opentui/core` 0.9.4).** `MarkdownRenderable` gives each code block's `CodeRenderable` the Markdown's
`fg` (`code.fg = this._fg`, the TUI's `theme.markdown.text`). A fence that is not highlighted, with no language or
one with no grammar, draws its text in that color.

**Rust (`opentui` 0.9.6).** The Markdown widget draws such a fence in the syntax theme's `default` scope
(`text.base`). #2177 laid the text color over `default` for prose and quotes, not for code blocks.

**Where it shows.** Themes whose `markdown.text` differs from `text.base`: `opencode` in both modes (the default;
#eeeeee drawn #ffffff) and `nord` dark. Color only. `P.8/good-fences` (the plain fence, 16 cells a checkpoint) and the
P-COMP test `crates/latex/src/tests.rs` (`invalid`, whose fences fall back to plain code: 24 cells), and P-TUI
`OT/held-fence` (the formula's source once more text comes: 21 cells).

**Ends with.** OpenTUI's Rust Markdown giving an unhighlighted code block the text color, as Core's `code.fg`, in a
release the client pins.

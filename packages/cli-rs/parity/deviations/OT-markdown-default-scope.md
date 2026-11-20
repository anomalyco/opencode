# OT: Markdown prose takes the syntax theme's `default` color

**TypeScript (`@opentui/core` 0.9.4).** `MarkdownRenderable.baseStyle` gives text outside any other part
`fg: this._fg ?? default.fg`: the TUI's `fg={theme.markdown.text}` wins over the syntax theme's `default` scope
(`text.base`). Code in a fence takes `default` over `fg` (`CodeRenderable`).

**Rust (`anomalyco-opentui` 0.9.5).** `MarkdownStyles::new` patches the `default` scope over the text color
(`text: fallback.text.patch(scope("default", ..))`, `widget/markdown.rs:113`), so prose takes `text.base`. The
client cannot work around it: fences read the same syntax theme and need `default` over the text color, as TS draws
them.

**Where it shows.** Themes whose `markdown.text` differs from `text.base`: of the built-ins, `opencode` in both modes
(the default since #64988; #eeeeee prose drawn #ffffff) and `nord` dark. In `opencode-classic` the two are one
color, so P-APP (`parity/app/scenarios.test.tsx`), P-TUI (`parity/sim/run.ts`) and the Markdown P-COMP fixtures
(`U.4a`, `U.4c`, `P.2`, `P.3`) run in `opencode-classic`. `parity/scenarios/OT/markdown-default-scope.app.ts`
keeps the difference in view: style only, the answer's prose cells.

**Ends with.** The OpenTUI fix (branch `backport-20261120-00` of `/home/simon/src/opentui`, worktree
`/home/simon/src/wt/ot-backport-20261120-00`: `text: scope("default", Style::new()).patch(fallback.text)`, with the
test `prose_takes_the_text_color_over_the_default_scope`) in a release the client pins. Then drop this file, the
scenario's budget, and the `opencode-classic` pins (those files, `crates/ui/tests/all/content.rs`,
`crates/latex/src/tests.rs`, `crates/mermaid/tests/all/markdown.rs`).

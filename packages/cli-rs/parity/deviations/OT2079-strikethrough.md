# OT2079: `~~text~~` is struck through

TypeScript: on `@opentui/core` 0.8.4 the TUI and mini hide the tildes of `~~gone~~` and draw `gone` without a strike. The
TUI theme gives `markup.strikethrough` the muted text color only. Native highlight composition in 0.8.4 adds no
attribute that a style does not set, and mini's one-color bodies style nothing.

Rust: the client pins OpenTUI `dbd6949f2`. Since anomalyco/opentui#2079, native composition strikes `markup.strikethrough`
unless its style turns the strike bit off explicitly ("strikethrough styles strike by default", as in Core and the
Rust Markdown widget). A Rust `Style` has no "off" attribute (`SyntaxStyle::register` supplies only the bits that are
set), so the client cannot turn it off. The TUI and mini (prose and the one-color reasoning and mono bodies) now strike
the text through. Colors and characters are unchanged.

Driven against TS, and equal when run TS against TS:

- `parity/scenarios/OT/strikethrough.sim.ts` (P-TUI): a reply `Answer a ~~gone~~ b.` Both clients show
  `Answer a gone b.` in the same colors. In Rust, the 4 cells of `gone` carry the strikethrough attribute.
- `parity/scenarios/OT/strikethrough-mini.pty.ts` (P-PTY, `attributes: true`): mini replays the same answer and a
  reasoning `Thinking a ~~gone~~ thought.` The text is equal. Rust strikes `gone` on both rows, and TS strikes nothing.

`crates/mini/src/scrollback.rs` `strikethrough_text_is_struck` records the Rust behaviour for every theme and body.

Reason: OpenTUI's native default follows Core's newer releases. TS 0.8.4 cannot draw strikethrough at all. The
difference goes away when TS moves to an `@opentui/core` release that includes #2079. To match 0.8.4 before then,
OpenTUI's Rust `Style` would need a way to turn an attribute off.

# V05a: diff gutter width

TypeScript: `PatchDiff` (`packages/tui/src/component/patch-diff.tsx:44-55`) gives every hunk's `<diff>` one gutter:
`paddingLeft: 1` and `minDigits` set to the digits of the largest line number in the patch. The code of all hunks
lines up, and the column before the sign has the line-number background.

Rust: `opencode_ui::diff::view` builds one opentui-rust `Diff` per hunk, as TS does. `Diff` has no gutter
options, so each hunk sizes its gutter to its own numbers, with no left padding. In
`parity/fixtures/U.4a/diff.json`, the first hunk (lines 1 to 4) is one column narrower than TS, and its code starts
one column to the left of the second hunk's (lines 10 to 13). A hunk whose numbers are as wide as the patch's widest
lines up with TS.

Reason: an opentui-rust difference not yet aligned. It needs gutter options (left padding, minimum digits) on
opentui-rust's `Diff`, which the wrapper then sets as TS does. `crates/ui/tests/content.rs` exempts the first hunk's
rows.

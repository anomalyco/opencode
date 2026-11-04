# F13: a closed LaTeX fence keeps its preview until the message completes

**TypeScript.** While a message streams, the LaTeX renderer (`packages/latex/src/markdown.ts:36-46`) keeps
showing the last formula that parsed when the fence's new source does not parse. It does this only while the fence
has no closing marker. When the closing fence arrives with math that does not parse, it shows the source at once
(`markdown.test.ts`, "discards an incomplete preview when the stream ends: close").

**Rust.** `opencode_latex::renderer` keeps the preview while the document streams
(`CodeBlock::streaming`). opentui-rust's `CodeBlock` does not say whether the fence closed. So a closed fence
with broken math keeps showing the earlier formula until the message completes. Then `Markdown::streaming(false)`
runs the renderer again and the source shows. The stop case ("…: stop") and every other case of
`markdown.test.ts` behave as in TS (`crates/latex/src/tests.rs`).

**Reason.** The widget API has no closed-fence flag. Adding one would change opentui-rust's block parser
(`Block::Code`) for this one case. The difference shows only while a message is still streaming after a broken
formula.

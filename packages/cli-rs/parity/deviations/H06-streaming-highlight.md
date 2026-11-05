# H06: streaming code shows new text before its highlight lands

TypeScript: Core's `CodeRenderable` (`packages/core/src/renderables/Code.ts:150,371-412`) highlights in a tree-sitter
worker. While a Markdown document streams, its fenced code blocks have `streaming: true` and `drawUnstyledText: false`.
New content does not touch the text buffer. The block keeps showing the previous highlighted text, without the new
lines, until the worker's highlight of the new content lands. A block's first content shows nothing until its first
highlight lands. A result whose snapshot changed in the meantime is dropped, and the highlight runs again.

Rust: opentui-rust's `Code` (`rust:crates/opentui/src/widget/code.rs`) highlights a view's first content, and any
replaced text, before the frame paints. Once the view shows a highlight, appended text appears at once, unhighlighted
after the old highlight. A worker thread then highlights the whole text, one highlight at a time per view. When the
highlight lands, it styles the text it covered, and text appended since stays unhighlighted until the next highlight.
Replacing the text, the filetype or the styles drops a running highlight.

So between a delta and its highlight landing, a frame shows the new code lines unhighlighted where TypeScript does
not show them yet. Once the highlight lands, the frames are the same. Every parity checkpoint compares such settled
frames. P-APP waits until two renders 25 ms apart are equal. P-COMP and the U.4a/U.4b fixtures render one-shot
content, which highlights before the first frame.

Reason: no stall on the UI thread. Before, every streamed delta highlighted the whole fence again on the UI thread:
48 ms per frame for a 1,000-line fence (350 ms at 4,000 lines), during which input waited. Now such a frame costs
0.08 ms. One frame per worker highlight also pays 1.6 ms to apply the result (`perf_probe::markdown_stream_cost`;
`/home/simon/src/opendocs/oc-rust/steps/stream-highlight.md`). Showing the new text at once also keeps streamed text from
lagging behind the reply.

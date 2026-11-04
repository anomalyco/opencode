# T20: motion text is one line

**TypeScript.** `Spinner` lays out its label as a `<text>` that may shrink and wrap (`flexShrink={1}` on a
labeled spinner). `ShimmerText` and `FadeInText` are `TextRenderable`s, so their text wraps to the width they
get, and the shading mask covers every row.

**Rust.** `motion::Spinner`, `ShimmerText`, and `FadeInText` paint one line, clipped at the widget's width.
The shading covers that row.

**Reason.** Not aligned yet. Every TUI use today is a short status label (`Thinking`, `Loading worktrees…`,
`Checking for updates…`, the home tip line). Wrapping is a follow-up for the step that first shows a label
that can wrap.

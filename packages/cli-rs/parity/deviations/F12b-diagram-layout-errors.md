# F12a, F12b: a diagram the layout cannot place shows as code

**TypeScript.** Besides `MermaidSyntaxError` and `DiagramCanvasSizeError`, which keep the fence as code, the merman
layouts throw a plain `Error` in a few dead ends: a flowchart subgraph with no collision-free responsive position
(`flowchart/layout.ts`), a state note with no exterior corridor, a transition label with no clear position, or state
composites that do not separate (`state/layout.ts`, `state/routing.ts`, `state/drawing.ts`).
`createMermaidCodeBlockRenderer` rethrows it, so the error leaves the Markdown renderer.

**Rust.** The same dead ends return an error, and the fence renders as its code block.

**Reason.** Showing the source is the renderer's own fallback for every other failure; an exception out of a
transcript renderer has no useful TS behavior to copy. None of the 496 corpus cases reaches these paths.

# F16: renderer claims, and what a plugin's fence falls back to

## TypeScript

A TUI plugin can draw the Markdown fences of a language with `markdown.registerCodeBlockRenderer(language, render)`
(`packages/tui/src/plugin/api.tsx`). It cannot draw a tool call: the transcript's tool rows are the host's alone.

- `render` returns a renderable, or `undefined` to leave the fence to the default code view (OpenTUI's
  `createMarkdownCodeBlockRenderer`).
- A `render` that throws: OpenTUI's `MarkdownRenderable.renderCustomNode` destroys the default view it built and
  throws again. No `PluginBoundary` wraps it, and the plugin stays active (read, not run).
- No call is timed, so a slow `render` makes the transcript slow.
- Disabling or reloading the plugin changes the merged renderers, and OpenTUI builds every Markdown block again
  (`plugin/markdown.ts`): the fence shows the default code view, or the new build's output.
- While the message streams, `render` runs for each change of the block; a plugin keeps its own last good output if it
  wants one (the LaTeX and Mermaid renderers do).

## Rust

A plugin can claim the calls of one tool, or the fences of one language, with a renderer claim of contract 2.0
(`abi::claim`, phase Pr). Its view draws each claimed part with a keyed tree, as a surface does, and gets the part as
it is now: a tool call's state (pending, running, completed, error), whether it waits for a permission, and its input,
without what the call returned, which the view names by reference for the host to draw; a fence's info, code, and
whether the message streams and the fence closed. The host's own row is the fallback:

- A view that returns `None` leaves that revision to the host's row: the tool view, or the code view.
- A view that panics fails the plugin (`F16-plugin-panic-no-effects`): the route mounts again, and every part of that
  plugin shows the host's row, as when the user disables it. A toast says `Plugin failed: <id>`.
- A view that returns a tree the host refuses leaves that part to the host's row for the rest of its mount (a keep the
  host does not hold is first asked for once more as a whole tree) (a fence's mount also ends at a theme change, when Markdown builds the block again). The plugin stays active,
  and its other parts keep their trees.
- A view that takes longer than the overrun limit (100 ms; P4c's limits) is treated by carrier, as P4c treats every
  overrun (synthesis 4.4): a built-in in process leaves that part to the host's row and stays active, and the overrun
  is counted as a host bug; a plugin loaded as a library fails, as an external plugin does, and every part it claimed
  shows the host's row, with the `Plugin failed` toast.
- Disabling or reloading the plugin mounts the route again: every part it claimed shows the host's row, or the new
  build's tree.
- While a part streams, its view runs at most once a frame, with the newest content, whichever row shows the part
  until then; a view at the paint that declines or fails hands the part to the host's row in that paint.
- A claimed fence learns that it closed only once Markdown decides the closing line: the transcript gives Markdown the
  text trimmed, as TS does, so a closing line at the end of the text so far is a pending line that may still change,
  until more text arrives or the message completes.

A TS plugin's code-block renderer does not run in the Rust client (`F16-typescript-plugins-skipped`), so no plugin
draws the same fence in both clients; `parity/scenarios/Pr/fence.app.ts` compares a TS renderer with its Rust twin, a
claim.

## Reason

Tool claims are the transcript half of the rich-plugin design (synthesis 4.11): a plugin draws a tool's calls, and
the host keeps its own rows as the fallback. The fallbacks follow the plugin machine of synthesis 4.14 and the budget
of 4.4: a panic fails the plugin as every panicking call does in Rust, and the faults that concern one part (a slow
view, a bad tree) fall back for that part alone, so one odd input does not take the plugin's other parts down.

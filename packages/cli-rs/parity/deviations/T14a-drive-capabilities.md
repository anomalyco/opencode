# T14a: the Rust drive endpoint has no renderables

TypeScript: the `OPENCODE_DRIVE` endpoint (`packages/simulation/src/frontend/server.ts`) offers every capability in
`Frontend.Capabilities`. Action results and `ui.state` list the renderables (`Frontend.State.elements`, with renderable
numbers), `ui.snapshot`, `ui.focus` and `ui.click` work, and a recording holds the bytes the renderer wrote.

Rust: the handshake offers every capability except `ui.click.semantic`, `ui.recording.pointer` and `ui.snapshot`.
Action results and `ui.state` report `focused.editor` and an empty `elements` list. `ui.focus` and `ui.click` are
offered, because opencode-drive requires them, but always answer with a JSON-RPC error that names the alternative
(`ui.mouse` with coordinates); `ui.snapshot` answers with the same error. A recording writes each presented frame
that differs from the last as a full repaint, so its video shows the same screens without the renderer's own
partial updates. `CapturedFrame.images` is always empty. `parity/scenarios/H.4/drive.ts` shows the difference in the
`responses` of its report (`ui.state`).

Reason: renderable numbers are a Core detail with no opentui-rust counterpart, so scenarios address the screen by
coordinates; a headless opentui-rust app writes no output bytes, so the recording is made from its frames; and it has
no image readback (G.7's report).

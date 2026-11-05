# T14a: the Rust drive endpoint offers fewer capabilities

TypeScript: the `OPENCODE_DRIVE` endpoint (`packages/simulation/src/frontend/server.ts`) offers every capability in
`Frontend.Capabilities`. Action results list the renderables (`Frontend.State.elements`, with renderable numbers), and
`ui.state`, `ui.snapshot`, `ui.focus`, `ui.click`, and `ui.recording.finish` work.

Rust: the handshake offers `ui.type`, `ui.press`, `ui.enter`, `ui.arrow`, `ui.mouse`, `ui.resize`, `ui.matches`, and
`ui.capture`. Action results report `focused.editor` and an empty `elements` list. The other methods answer with a
JSON-RPC error that names the alternative (`ui.mouse` with coordinates). `CapturedFrame.images` is always empty.
`P-TUI/H.4/drive` shows the difference in its `responses` (`ui.state`).

Reason: plan 7.3. Renderable numbers are a Core detail with no opentui-rust counterpart, so scenarios address the
screen by coordinates; a headless opentui-rust app writes no output bytes to record, and it has no image readback
(G.7's report).

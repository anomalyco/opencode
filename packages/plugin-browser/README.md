# Browser plugin

`@opencode-ai/plugin-browser` exposes the desktop browser through Code Mode.
The server owns tools, invocation scope, and permissions; the desktop owns tabs,
CDP, captured traffic, evaluations, and capture files. Core only registers the
plugin. Neither endpoint imports the other's implementation.

```js
const tab = await tools.browser.tabs.open({ url: "https://example.com" })
return await tools.browser.snapshot({ tabID: tab.id })
```

All page operations require a `tabID` returned by `browser.tabs.open/list`.
Focus selects the visible Review tab, not an implicit command target. Discover
current signatures with `search({ namespace: "browser" })`.
Screenshots require a focused, visible tab; call `browser.tabs.focus` first.

## Tools

- Tabs: `tabs.list`, `tabs.open`, `tabs.focus`, `tabs.close`.
- Navigation: `navigate`, `back`, `forward`, `reload`, `stop`, `frames`.
- Observation: `snapshot`, `find`, `evaluate`, `wait`, `screenshot`.
- Input: `click`, `hover`, `drag`, `fill`, `fill_form`, `select`, `check`, `press`, `scroll`, `dialog`.
- Files: `files.upload`, `files.drop`, `files.list`, `files.get`.
- Diagnostics: `console`, `network.list`, `network.get`.
- Performance: `trace.start`, `trace.stop`, `trace.analyze`, `cpu.start`, `cpu.stop`, `cpu.analyze`.
- Memory: `heap.snapshot`, `heap.summary`, `heap.query`, `heap.object`, `heap.compare`.
- Audits: `lighthouse` (accessibility, SEO, best practices).

The source of truth for inputs, descriptions, and outputs is
`Browser.Operations` in `@opencode-ai/plugin-browser/rpc`.

The plugin entrypoint only composes its two owners: `connection.ts` manages
desktop attachments and pending RPC requests; `tools.ts` runs the tool workflow.
Server-local file IO stays in `files.ts`. The public `rpc.ts` entrypoint remains
pure and does not load any of these runtime modules.

## Tests

Run `bun test` and `bun typecheck` from this package for its contract checks.
Native browser coverage lives in `packages/desktop/test/browser-native.test.ts`.

## RPC

The plugin-owned contract is `@opencode-ai/plugin-browser/rpc`. This entrypoint
contains only schemas and descriptions; it does not load the server plugin or
filesystem code. The desktop subscribes
to control events before starting `attach` with `version: 4`. The attachment call
stays pending for its lifetime. A matching `attached` event is the readiness barrier.

- `state` publishes the authoritative tab inventory.
- `control` announces a request ID or cancellation; it never broadcasts arguments,
  script source, file bytes, or browser results on the server-wide event feed.
- `command` retrieves the pending request through authenticated RPC.
- `result` completes it. The plugin validates the selected operation's output.
- Inspection commands return only target/source metadata. Execution checks that
  the approved target has not changed while permission was pending.
- `attach` returns `replaced` when another desktop takes ownership. That is not
  a retryable disconnect; the old desktop must not reclaim the session automatically.

The connection ID is correlation, not separate client authentication. Requests
are bound to their attachment and tab. Disconnect, replacement, session movement,
and unload fail outstanding work. Calls are not replayed automatically: a lost
response does not prove that a click or evaluation never happened.

## Files and remote servers

Upload paths are **server-local**. File bytes cross RPC and the desktop writes its
own temporary copy. Captures/downloads travel back as bounded bytes and are saved
to server-local temporary files. Returned `files[].path` values refer to that
server; bytes are not included in the model's structured output. Images are also
attached for the model to inspect. Temporary exports are not deleted on plugin
reload, so a returned path remains usable; they follow the host's temporary-file
lifetime.

Each transfer is limited to 5 MiB total. There is no shared filesystem assumption,
resumable file-transfer service or object store. Browsing uses the connected
server's network: `localhost:8000` reaches that server's port 8000, while Chromium
and page JavaScript still run on the desktop. Dev-server ports need not be public.

`tunnel.open/read/write/close` relay bounded TCP chunks through the existing
authenticated plugin RPC route. The desktop-only `/proxy` entrypoint adapts
Chromium's HTTP/CONNECT proxy traffic, including WebSockets, to those methods.
Network bytes never go onto the global event stream. Attachment closure releases
the sockets; failed writes are not replayed and there is no direct-network fallback.

Remote endpoints can use HTTPS and the existing server credentials. A reverse
proxy must allow long-lived event and attachment requests; the attachment RPC
stays open rather than sending response-body heartbeats.

Lighthouse audits use snapshot mode without changing device emulation or adding
an embedded report screenshot; use `browser.screenshot` for images. Trace exports
contain the target renderer process, not the whole desktop application. A tab
process change or trace-buffer loss is reported as an incomplete capture. Heap
summaries report shallow size, not computed retained size, and do not prove leaks.

All page-derived data is untrusted, including structured outputs. Schema
validation does not make page text an instruction or grant it authority.

## Recovering from errors

Errors name the failed operation and the next supported action. Refresh tab IDs
with `browser.tabs.list`, element refs with `browser.snapshot`, and frame IDs with
`browser.frames`. File and network request IDs must come from the same tab's
current listing. Trace, CPU, and heap files are not interchangeable.

A timeout, cancellation, or disconnection does not prove the action never ran.
Inspect the tab and completed files before repeating clicks, uploads, submissions,
or evaluations. Do not retry a permission denial through another tool or weaken
browser security to work around a TLS or unsupported-operation error.

File errors distinguish server-local upload paths from desktop capture files.
Pending/failed downloads and unavailable response bodies are not empty files.
Oversized output requires a smaller request or capture, not an identical retry.

Per-URL and server-file permission checks belong to the final permission layer
(#46530). This base plugin layer intentionally does not enforce those rules.

Disable through normal configuration:

```jsonc
{ "plugins": ["-opencode.browser"] }
```

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
`Browser.Operations` in `@opencode-ai/schema/browser`.

## RPC

The shared contract remains `@opencode-ai/schema/browser`. The desktop subscribes
to control events before starting `attach` with `version: 2`. The attachment call
stays pending for its lifetime. A matching `attached` event is the readiness barrier.

- `state` publishes the authoritative tab inventory.
- `control` announces a request ID or cancellation; it never broadcasts arguments,
  script source, file bytes, or browser results on the server-wide event feed.
- `command` retrieves the pending request through authenticated RPC.
- `result` completes it. The plugin validates the selected operation's output.

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
resumable transfer service, new socket, or object store. Browsing uses the
desktop's network: its `localhost` is not the remote server's `localhost`.

All page-derived data is untrusted, including structured outputs. Schema
validation does not make page text an instruction or grant it authority.

Per-URL and server-file permission checks belong to the final permission layer
(#46530). This base plugin layer intentionally does not enforce those rules.

Disable through normal configuration:

```jsonc
{ "plugins": ["-opencode.browser"] }
```

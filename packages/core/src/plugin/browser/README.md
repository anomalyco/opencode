# Experimental Browser Plugin

The server-side browser tool lives alongside the other built-in plugins. Its
implementation uses only the public plugin API, public schemas, and Effect. The
shared RPC contract is `@opencode-ai/schema/browser`; desktop clients do not import Core.

Disable it through normal plugin configuration:

```jsonc
{
  "plugins": ["-opencode.browser"],
}
```

The desktop implementation connects with `client.rpc(Browser.Definition)` at the
session's location. Subscribe to server events before calling `attach`; wait for
`server.connected`, then the matching `attached` control event. The `attach` call
stays pending for the attachment lifetime. Abort it when its event stream ends or
the desktop owner closes. Completing the attachment also ends that event consumer.

- `attach` holds one browser attachment per session until cancellation, plugin
  unload, session deletion, or session movement.
- `state` reports the current page, or `null` when no page is open.
- `result` completes a command with its request ID and outcome.
- `control` events carry attachment confirmation, commands, and cancellation.

Control events use OpenCode's existing authenticated, server-wide event feed.
Consumers filter by `connectionID`; this identifier is correlation, not private
event delivery. State and results use RPC calls rather than broadcast events.

Per-URL permission checks are deferred to the final permission layer (#46530).
Until that layer lands, browser actions do not enforce URL-specific ask or deny
rules. Attachment ownership, page validation, and cancellation remain enforced.

Browser content is untrusted. Pages use the desktop's network, with no server-side
tunnel. The desktop owns Chromium, page isolation, and native controls.

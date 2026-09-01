# Experimental Browser Plugin

The server-side browser tool is a standalone Effect plugin. It uses only the public
plugin API and keeps its RPC contract in `@opencode-ai/browser/rpc`.

Load the workspace package with normal plugin configuration:

```jsonc
{
  "plugins": ["./packages/browser"],
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

The plugin requests normal agent permissions before acting on a URL. Browser
content is untrusted. Pages use the desktop's network, with no server-side tunnel.
The desktop owns Chromium, page isolation, and native controls.

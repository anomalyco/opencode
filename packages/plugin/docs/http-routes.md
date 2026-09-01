# HTTP routes for server plugins

Server plugins can expose their own HTTP endpoints on the opencode server by
returning a `routes` entry from the plugin's hooks. This is the official
inbound channel for driving the agent from external systems (chat bridges,
CI, webhooks) — see [anomalyco/opencode#41362](https://github.com/anomalyco/opencode/issues/41362).

## Contract

```ts
import type { Plugin, PluginRoute, PluginRouteRequest, PluginRouteResponse } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async (input) => ({
  routes: [
    {
      method: "POST",
      path: "/webhook",
      async handler(request: PluginRouteRequest): Promise<PluginRouteResponse> {
        return { status: 202, body: { ok: true } }
      },
    },
  ],
})
```

- `method` — `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`.
- `path` — relative to `/plugin/<pluginID>`, e.g. `/webhook` or `/issue/:id`.
  Segments starting with `:` are path parameters, available in
  `request.params` (exact matches win over parameterized ones).
- `handler` receives a plain `PluginRouteRequest` and returns a
  `PluginRouteResponse`. Objects are serialized as JSON, strings are sent as
  `text/plain`. An undefined body produces `204 No Content`.

Requests are dispatched by the server at request time (the typed HttpApi
surface is static, so dynamic registration happens in a catch-all dispatcher),
so routes are available without restarting the server after the plugin is
loaded with the instance.

## URL scheme and instance resolution

Routes are mounted at:

```
/plugin/<pluginID>/<path>
```

`<pluginID>` is the plugin id: the exported `id` for path plugins, the
`package.json` `name` for npm packages, or the plugin function name for
anonymous legacy exports.

Which project instance handles the request is resolved the same way as the
rest of the API: `directory` query parameter, then the `x-opencode-directory`
header, then the server's working directory. So a webhook for a specific
project should send one of those:

```bash
curl -X POST 'http://localhost:4096/plugin/webhook-plugin/webhook?directory=/path/to/project' \
  -H 'content-type: application/json' \
  -H 'x-webhook-secret: s3cret' \
  -d '{"text": "fix the failing tests"}'
```

## Security

**Plugin routes are public.** They are intentionally outside `ServerAuth`
because they are meant to be called by external systems that do not hold
opencode credentials. Authenticate inside the handler instead — the
convention used by the example plugin is a shared secret in the
`x-webhook-secret` header, configured through the plugin options:

```json
{
  "plugin": [
    [
      "file:///path/to/webhook-plugin.ts",
      { "agent": "build", "secret": "s3cret" }
    ]
  ]
}
```

Only bind the server to loopback or protect it at the network layer if
unauthenticated access to the route is not acceptable for your setup.

## Example: webhook that starts an agent run

[`examples/webhook-plugin.ts`](../examples/webhook-plugin.ts) demonstrates the
intended flow:

1. The handler validates the `x-webhook-secret` header (401 on mismatch).
2. If the request body carries a `sessionID`, that session is reused;
   otherwise a fresh session is created with the `agent` from the plugin
   options (or the `agent` field of the request body).
3. The message is submitted through `client.session.promptAsync`, which
   returns immediately — the agent runs in the background.
4. The response is `202 Accepted` with the `sessionID`, so the caller can
   follow the session through the regular API or SSE stream.

```bash
curl -X POST http://localhost:4096/plugin/webhook-plugin/webhook \
  -H 'content-type: application/json' \
  -H 'x-webhook-secret: s3cret' \
  -d '{"text": "fix the failing tests"}'

# → 202 {"sessionID":"ses_...","agent":"build"}
```

## Error handling

Handler failures are isolated: a throwing handler produces a `500` with the
error message and does not take the server down. Unknown plugin ids or
paths produce `404`.

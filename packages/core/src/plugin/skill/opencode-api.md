## [API](https://opencode.ai/docs/api)

OpenCode exposes an HTTP API from its server.

In Code Mode, use the built-in `opencode` tool namespace first, called inside
`execute` as `tools.opencode.*`; find its tools with Code Mode's `search`, for
example `search({ namespace: "opencode" })`. For anything they do not cover, call
the API with `fetch("opencode:///api/...")`. It reaches this OpenCode server,
already signed in, and uses the session's directory. `current` in place of a
session ID names the calling session:

```js
const session = await (await fetch("opencode:///api/session/current")).json()
```

Read `skill://opencode/api.md` for the available endpoints, then the file it
points to for the group you need.


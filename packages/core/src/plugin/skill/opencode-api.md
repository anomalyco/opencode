## [API](https://opencode.ai/docs/api)

OpenCode exposes an HTTP API from its server.

Use your built-in tools first (including `tools.opencode.*` and other Code Mode
namespaces in `search(...)`). Only fall back to `fetch("opencode:///api/...")`
for things they do not cover. It reaches this OpenCode server,
already signed in, and uses the session's directory. `current` in place of a
session ID names the calling session:

```js
const session = await (await fetch("opencode:///api/session/current")).json()
```

Read `skill://opencode/api.md` for the available endpoints, then the file it
points to for the group you need.

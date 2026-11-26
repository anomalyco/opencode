# OpenCode

This is an index of core OpenCode concepts. Before answering a question or
editing config, fetch the linked page at <https://opencode.ai/docs/> and use it
as the source of truth. Follow links from that page for detail, or fetch
<https://opencode.ai/docs/llms.txt> to find the right page.

## Version policy

Answer for OpenCode V2. Use <https://opencode.ai/docs/> for V2, and do not use
web search when the V2 docs cover the question. Consult
<https://opencode.ai/v1/docs/> (V1) only when the user asks about V1 or as
migration input, and still produce V2 output unless they ask for V1.
<https://opencode.ai/config.json> still accepts deprecated V1 fields; never
recommend fields it marks deprecated. If V2 docs are missing or contradictory,
say so instead of falling back to V1.

## [CLI](https://opencode.ai/docs/cli)

Terminal and TUI preferences (`run`, `mini`, themes, input, sessions, tabs,
diffs, alerts, keybindings, terminal plugins, debugging) live in global
`~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`).
There is no project-local CLI config. `OPENCODE_CLI_CONFIG_CONTENT` merges
inline JSON over it. Most settings are also under `Ctrl+P` → **Open settings**.

- [CLI settings](https://opencode.ai/docs/cli/config): terminal-only settings;
  do not put these in `opencode.json(c)`.
- [Keybinds](https://opencode.ai/docs/cli/keybinds): configured under
  `keybinds` in `cli.json` (`keybinds.leader` for the leader key,
  `leader.timeout` for timing; values can be a string, string array, or object
  with `preventDefault`; disable with `"none"` or `false`). Never guess
  command IDs, defaults, or key syntax.

## [OpenCode configuration](https://opencode.ai/docs/config)

Server and project configuration uses JSON or JSONC with the published schema:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
}
```

Global config lives at `~/.config/opencode/opencode.json(c)`. Project config
lives in any directory as `opencode.json(c)` or `.opencode/opencode.json(c)`.
Discovery walks from the filesystem root down to the current Location directory,
merging direct `opencode.json(c)` files first, then `.opencode/opencode.json(c)`
files — so any `.opencode` config overrides any direct config, and both
override global config.

Common fields: `model`, `default_agent`, `permissions`, `agents`,
`commands`, `plugins`, `providers`, `mcp`, `skills`, `instructions`,
`references`, `formatter`, `lsp`.

Config changes apply live without a restart; OpenCode watches config files and
reloads agents, commands, skills, MCP servers, and plugins on save (and the TUI
watches `cli.json`). Use `/reload` to force a full reload. Don't tell the
user to restart OpenCode after editing config.

Preserve unrelated settings when editing, never guess field shapes, and keep
`$schema` in examples without fetching it as a V2 reference.

## [MCP servers](https://opencode.ai/docs/mcp-servers)

Configured under `mcp.servers`. Prefer the CLI so unrelated config is
preserved; pass `--global` unless the user wants project-local config:

```sh
opencode mcp add <name> --global --url <remote-url>
opencode mcp list
```

Remote servers use OAuth by default. If `mcp list` shows a server needs auth,
tell the user to run `/mcps`, select it, and sign in. Do not run
`opencode mcp auth` through the shell tool (its interactive auth link can be
hidden). Report the server as awaiting sign-in until status confirms connected.

Do not ask for or store an API key when OAuth is supported. For header-based
auth, use `{env:MCP_API_KEY}` instead of inline secrets.

## [V1 to V2 migration](https://opencode.ai/docs/migrate-v1)

V1 config files and `.opencode/` definitions remain compatible; only the
server API and plugin API have breaking changes. Converting to native V2 config
is optional. When asked to migrate, inspect the full config, preserve behavior
and unrelated settings, and for plugins also follow the
[plugins guide](https://opencode.ai/docs/build/plugins). If non-API V1
functionality fails in V2, use the `report` skill to file a compatibility bug.

## [Plugins](https://opencode.ai/docs/build/plugins)

Covers hooks, transforms, tools, plugin context, and package entrypoints. Also
see [CLI plugins](https://opencode.ai/docs/build/plugins/cli) for TUI
extensions and [RPC](https://opencode.ai/docs/build/plugins/rpc) for custom
methods and events shared across plugins or clients.

## [Service](https://opencode.ai/docs/troubleshooting#check-the-background-service)

Clients such as the TUI connect to a shared background service that owns
sessions, config, plugins, permissions, and tool execution. It starts
automatically; only restart it if stuck or unhealthy, not for config changes:

```sh
opencode service restart
opencode service status
```

## [API](https://opencode.ai/docs/api)

The server exposes an HTTP API described at `/openapi.json` (and published at
<https://opencode.ai/docs/openapi.json>).

Use your built-in tools first (including `tools.opencode.*` and other Code Mode
namespaces in `search(...)`). Only fall back to `opencode api` for things they
do not cover; it handles service discovery and auth and accepts either
`<method> <path>` or an OpenAPI operation ID:

```sh
opencode api get /api/info
opencode api post /api/example --data '{"key":"value"}'
opencode api get /api/example --header 'X-Example:value'
```

Request bodies default to `Content-Type: application/json`. When connected to
an explicit server, reuse its configured server and auth context.

## [Client](https://opencode.ai/docs/build/client)

`@opencode/client` is the generated TypeScript HTTP client. The default
entrypoint exposes Promise-based resource clients and async iterables for
streams; `@opencode/client/effect` exposes typed Effects, Streams, decoded
schemas, and a `Service` API for managing the local background service from
Node.

## [SDK](https://opencode.ai/docs/build/sdk)

Embeds OpenCode in-process without an HTTP listener. See the
[Effect SDK](https://opencode.ai/docs/build/sdk/effect) and
[Cloudflare Durable Objects SDK](https://opencode.ai/docs/build/sdk/cloudflare)
guides.

## [Troubleshooting](https://opencode.ai/docs/troubleshooting)

First determine whether the problem is in the client, shared server, or one
project:

- Check `opencode service status` and `opencode api get /api/info`.
- Run `opencode --standalone` (private server) to isolate shared-service issues.
- Inspect `~/.local/share/opencode/log/opencode.log` (`role=cli` for client
  startup, `role=server` for sessions, providers, plugins, permissions, tools).
- Reproduce once with `OPENCODE_LOG_LEVEL=DEBUG` when normal logs aren't enough.
- Do not delete or edit the database, service registration, or service config
  while diagnosing; back up persistent data before inspecting externally.
- Redact API keys, auth headers, prompts, file contents, and other sensitive
  data before sharing diagnostics.

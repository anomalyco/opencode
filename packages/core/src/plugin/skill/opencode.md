# OpenCode

Use this guide as the starting point for work involving OpenCode itself. It
covers the core concepts needed to configure and customize OpenCode, extend it
with plugins, and build integrations with the OpenCode SDK, clients, and API.

Full documentation is available at <https://v2.opencode.ai/>. This overview is
only an index of core concepts. Before answering a question about a topic below,
fetch the URL named in that section and use the full page as the source of
truth. Follow links from that page when the question needs more detail. Fetch
<https://v2.opencode.ai/llms.txt> first when you need to discover the relevant
documentation page.

## Version policy

Always answer for OpenCode V2 unless the user explicitly asks about V1,
legacy OpenCode, or migrating from V1.

Use only <https://v2.opencode.ai/> documentation as the source of truth for V2.
Do not use <https://opencode.ai/docs/>, which documents V1, and do not use
general web search to resolve a V2 documentation question when the V2 docs or
their `llms.txt` index cover it. The schema served from
<https://opencode.ai/config.json> may describe V1 even though V2 configuration
files include that URL for editor integration. Never use it to infer V2 field
names or shapes. If V2 documentation is missing or contradictory, state the
uncertainty or ask for clarification instead of falling back to V1.

V1 documentation and syntax may be consulted only when the user explicitly
asks about V1 or when needed as migration input. Outputs and recommendations
must still use V2 unless the user specifically requests a V1 result.

## [Configuration](https://v2.opencode.ai/config)

OpenCode configuration uses JSON or JSONC. Include the published schema so the
user's editor can validate fields and provide autocomplete:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
}
```

Global configuration lives at `~/.config/opencode/opencode.json(c)` and applies
to every project for that user. Project configuration can live in any directory
as `opencode.json(c)` or `.opencode/opencode.json(c)`, including nested packages
in a monorepo.

When OpenCode starts, it searches from the current directory up to the project
root. It merges direct `opencode.json(c)` files from root to current directory,
then does the same for `.opencode/opencode.json(c)` files. This means every
`.opencode` config overrides every direct config. Global configuration has the
lowest precedence.

Common configuration fields include `model`, `default_agent`, `permissions`,
`agents`, `commands`, `plugins`, `providers`, `mcp`, `skills`, `instructions`,
`references`, `formatter`, and `lsp`.

Do not guess field names or shapes. Fetch the V2 configuration guide and its
linked topic guide as the source of truth, and preserve unrelated settings when
editing an existing file. Keep the published `$schema` URL in configuration
examples, but do not fetch it to determine the V2 configuration shape.

See the [full configuration guide](https://v2.opencode.ai/config) for
every field, examples, config locations, and links to dedicated feature guides.

## [V1 to V2 migration](https://v2.opencode.ai/migrate-v1)

For any request to migrate OpenCode configuration, agents, commands, skills,
plugins, integrations, or other behavior from V1 to V2, read the full
[migration guide](https://v2.opencode.ai/migrate-v1) before acting. In
the repository, its source is `packages/docs/migrate-v1.mdx`.

V1 config files and `.opencode/` definitions are intended to remain compatible.
The only intentional breaking changes are the server API and plugin API. Native
V2 config uses more ergonomic shapes, but conversion is optional. When the user
requests conversion, inspect the complete configuration, preserve behavior and
unrelated settings, and apply only the relevant migrations from the guide. For
plugin migrations, fetch and follow both the migration guide and the full
[plugins guide](https://v2.opencode.ai/build/plugins). If non-API V1
functionality fails in V2, use the `report` skill to file it as a compatibility
bug.

## [Plugins](https://v2.opencode.ai/build/plugins)

For questions about creating, configuring, loading, publishing, or migrating
plugins, fetch the full [plugins guide](https://v2.opencode.ai/build/plugins)
before answering. This includes questions about the Effect plugin API, hooks,
transforms, tools, plugin context capabilities, and package entrypoints.

## [Service](https://v2.opencode.ai/troubleshooting#check-the-background-service)

OpenCode uses a client-server architecture. Interfaces such as the TUI connect
to a background OpenCode service, which owns sessions, configuration, plugins,
permissions, and tool execution.

OpenCode normally discovers or starts the shared background service
automatically. If the service is stuck or unhealthy, restart it:

```sh
opencode2 service restart
```

Check its status after restarting:

```sh
opencode2 service status
```

## [API](https://v2.opencode.ai/api)

OpenCode exposes an HTTP API from its server. The API is described by an
OpenAPI document available from the running server at `/openapi.json`.

Use OpenCode's built-in `api` command for local requests. It uses the same
discovery and authentication flow as the TUI and may start the background
service when no compatible healthy service is available. It accepts either an
HTTP method and path or an OpenAPI operation ID.

Call an endpoint with an HTTP method and path:

```sh
opencode2 api get /api/health
```

Pass a request body with `--data` or `-d`, and additional headers with
`--header` or `-H`:

```sh
opencode2 api post /api/example --data '{"key":"value"}'
opencode2 api get /api/example --header 'X-Example:value'
```

Request bodies default to `Content-Type: application/json`. When OpenCode is
connected to an explicit server instead of its managed background service, use
the same configured server and authentication context rather than constructing
an unauthenticated request separately.

See the [full API reference](https://v2.opencode.ai/api) for available
endpoints, parameters, request bodies, and response schemas. The
raw [OpenAPI specification](https://v2.opencode.ai/openapi.json) is also
available for code generation and other tooling.

## [Client](https://v2.opencode.ai/build/client)

For questions about connecting an application to OpenCode over the network,
fetch the full [client guide](https://v2.opencode.ai/build/client) before
answering.

`@opencode-ai/client` is the generated TypeScript client for the OpenCode HTTP
API. Its methods and types come from the same contract as the API reference.
The default entrypoint exposes Promise-based resource clients and async
iterables for streaming endpoints. The `@opencode-ai/client/effect` entrypoint
exposes typed Effects, Streams, and decoded OpenCode schema values. Its
`Service` API can discover, start, stop, and authenticate with the local
background service from a Node application.

## [Troubleshooting](https://v2.opencode.ai/troubleshooting)

OpenCode runs a client and a background server. Start by determining whether a
problem belongs to the client, the shared server, or one project.

- Check the service with `opencode2 service status` and verify the API with
  `opencode2 api get /api/health`.
- Compare with `opencode2 --standalone`, which runs the TUI with a private
  server, to isolate shared-service issues.
- Inspect `~/.local/share/opencode/log/opencode.log`. Filter `role=cli` for
  client startup and `role=server` for sessions, providers, plugins,
  permissions, and tools.
- Run one reproduction with `OPENCODE_LOG_LEVEL=DEBUG` when normal logs are not
  sufficient.
- Do not delete or edit the database, service registration, or service config
  while diagnosing a problem. Back up persistent data before inspecting it
  with external tools.
- Redact API keys, authorization headers, prompts, file contents, and other
  sensitive data before sharing diagnostics.

See the [full troubleshooting guide](https://v2.opencode.ai/troubleshooting)
for service lifecycle commands, API inspection, log locations, explicit server
connections, issue-reporting details, and local development paths.

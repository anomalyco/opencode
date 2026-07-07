# OpenCode

Use this guide as the starting point for work involving OpenCode itself. It
covers the core concepts needed to configure and customize OpenCode, extend it
with plugins, and build integrations with the OpenCode SDK, clients, and API.

Full documentation is available at <https://opencode.mintlify.site/>. Consult
it when this overview does not contain enough detail for the task.

## Configuration

OpenCode configuration uses JSON or JSONC. Include the published schema so the
user's editor can validate fields and provide autocomplete:

```jsonc
{
  "$schema": "https://opencode.ai/config.json"
}
```

Global configuration lives at `~/.config/opencode/opencode.json(c)` and applies
to every project for that user. Project configuration can live in any directory
as `opencode.json(c)` or `.opencode/opencode.json(c)`, including nested packages
in a monorepo.

When OpenCode starts, it searches upward from the current directory for project
configuration and merges the files it finds with the global configuration.

Common configuration fields include `model`, `default_agent`, `permissions`,
`agents`, `commands`, `plugins`, `providers`, `mcp`, `skills`, `instructions`,
`references`, `formatter`, and `lsp`.

Do not guess field names or shapes. Use
<https://opencode.ai/config.json> as the source of truth and preserve unrelated
settings when editing an existing file.

See the [full configuration guide](https://opencode.mintlify.site/config) for
every field, examples, config locations, and links to dedicated feature guides.

## Service

OpenCode uses a client-server architecture. Interfaces such as the TUI connect
to a background OpenCode service, which owns sessions, configuration, plugins,
permissions, and tool execution.

Configuration and related files are typically watched and reloaded while the
service is running. If a change does not appear, restart the service:

```sh
opencode2 service restart
```

Check its status after restarting:

```sh
opencode2 service status
```

## API

OpenCode exposes an HTTP API from its server. The API is described by an
OpenAPI document available from the running server at `/openapi.json`.

Use OpenCode's built-in `api` command for local requests. It discovers the same
background server used by the TUI, starts it when necessary, and applies the
server's authentication headers automatically.

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

See the [full API reference](https://opencode.mintlify.site/api) for available
endpoints, parameters, request bodies, and response schemas. The
raw [OpenAPI specification](https://opencode.mintlify.site/openapi.json) is also
available for code generation and other tooling.

## Troubleshooting

OpenCode runs a client and a background server. Start by determining whether a
problem belongs to the client, the shared server, or one project.

- Check the service with `opencode2 service status` and verify the API with
  `opencode2 api get /api/health`.
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

See the [full troubleshooting guide](https://opencode.mintlify.site/troubleshooting)
for service lifecycle commands, API inspection, log locations, explicit server
connections, issue-reporting details, and local development paths.

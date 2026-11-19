# Agents, Skills, Plugins & MCP

Inspect agents, commands, skills, plugins, MCP servers/resources, integrations, RPC methods, and websearch providers.

## `GET /api/agent`
List agents. Retrieve currently registered agents.
- Returns: 200 `{ location: Location.PublicRef; data: Agent.Info[] }`

## `GET /api/agent/{agentID}`
Get agent. Retrieve a single currently registered agent.
- Returns: 200 `{ location: Location.PublicRef; data: Agent.Info }`

## `GET /api/plugin`
List plugins. Retrieve enabled server plugins and their current status.
- Returns: 200 `{ location: Location.PublicRef; data: Plugin.Info[] }`

## `GET /api/plugin/gui`
Read plugin GUI bundle. Read an active plugin's prebuilt CommonJS `./gui-experimental` bundle. Desktop app windows run its default export; the desktop app's main process runs its `main` export. Fails with not found when no active plugin has the id or the plugin exports no `./gui-experimental`.
- Query: `id: string`
- Returns: 200 `{ location: Location.PublicRef; data: Plugin.GuiBundle }`

## `POST /api/plugin/check`
Check plugin updates. Check one or all package plugins for available updates.
- Body: `{ target?: string | null }`
- Returns: 200 `{ location: Location.PublicRef; data: Plugin.Info[] }`

## `POST /api/plugin/update`
Update plugins. Update package plugins concurrently and notify active locations to reload them. Responds once every update has finished; fails when any update fails.
- Body: `{ targets: string[] }`
- Returns: 204 No Content

## `GET /api/integration`
List integrations. Retrieve available integrations and their authentication methods.
- Returns: 200 `{ location: Location.PublicRef; data: Integration.Info[] }`

## `GET /api/integration/{integrationID}`
Get integration. Retrieve one integration and its authentication methods.
- Returns: 200 `{ location: Location.PublicRef; data: Integration.Info }`

## `GET /api/integration/{integrationID}/connect/oauth/{attemptID}`
Get OAuth attempt status. Poll the current status of an OAuth attempt.
- Returns: 200 `{ location: Location.PublicRef; data: Integration.AttemptStatus }`

## `GET /api/integration/{integrationID}/connect/command/{attemptID}`
Get command attempt status. Poll the current status and output of a command authentication attempt.
- Returns: 200 `{ location: Location.PublicRef; data: Integration.CommandAttemptStatus }`

## `GET /api/mcp`
List MCP servers. Retrieve configured MCP servers and their connection status.
- Returns: 200 `{ location: Location.PublicRef; data: Mcp.Server[] }`

## `POST /api/experimental/mcp/{server}/connect`
Connect MCP server. Connect an MCP server at runtime, overriding a disabled configuration until restart.
- Returns: 204 No Content

## `POST /api/experimental/mcp/{server}/disconnect`
Disconnect MCP server. Disconnect an MCP server at runtime, removing its tools until reconnected.
- Returns: 204 No Content

## `GET /api/mcp/resource`
List MCP resources. Retrieve resources and resource templates from connected MCP servers.
- Returns: 200 `{ location: Location.PublicRef; data: Mcp.ResourceCatalog }`

## `GET /api/command`
List commands. Retrieve currently registered commands.
- Returns: 200 `{ location: Location.PublicRef; data: Command.Info[] }`

## `GET /api/skill`
List skills. Retrieve currently registered skills.
- Returns: 200 `{ location: Location.PublicRef; data: Skill.Info[] }`

## `POST /api/rpc/{rpcID}/{method}`
Call a plugin RPC. Dispatch a method to the currently registered RPC at the requested location.
- Body: `Rpc.Input`
- Returns: 200 `Rpc.Output`

## `GET /api/websearch/provider`
List web search providers. Return the registered web search providers.
- Returns: 200 `{ location: Location.PublicRef; data: WebSearch.Provider[] }`

## Types

- `Agent.Info`: `{ id: string; name: string; model?: Model.Ref; request: Provider.Request; system?: string; description?: string; mode: "subagent" | "primary" | "all"; hidden: boolean; color?: string; steps?: number; permissions: Permission.Ruleset }`
- `Command.Info`: `{ name: string; description?: string }`
- `Integration.AttemptStatus`: `{ status: "pending"; time: { created, expires } } | { status: "complete"; time: { created, expires } } | { status: "failed"; message: string; time: { created, expires } } | { status: "expired"; time: { created, expires } }`
- `Integration.CommandAttemptStatus`: `{ status: "pending"; message?: string; time: { created, expires } } | { status: "complete"; time: { created, expires } } | { status: "failed"; message: string; time: { created, expires } } | { status: "expired"; time: { created, expires } }`
- `Integration.Info`: `{ id: string; name: string; metadata?: Record<string, unknown>; methods: Integration.Method[]; connections: Connection.Info[] }`
- `Location.PublicRef`: `{ directory: string }`
- `Mcp.ResourceCatalog`: `{ resources: Mcp.Resource[]; templates: Mcp.ResourceTemplate[] }`
- `Mcp.Server`: `{ name: string; status: Mcp.Status.Connected | Mcp.Status.Pending | Mcp.Status.Disabled | Mcp.Status.Failed | Mcp.Status.NeedsAuth; title?: string; integrationID?: string }`
- `Plugin.GuiBundle`: `{ code: string; revision: string; options: Record<string, unknown> }`
- `Plugin.Info`: `{ id?: string; source: Plugin.Source; features: Plugin.Features; state: Plugin.State }`
- `Rpc.Input`: `{ input?: unknown }`
- `Rpc.Output`: `{ output?: unknown }`
- `Skill.Info`: `{ id: string; name: string; description?: string; autoinvoke?: boolean; path: string; content: string }`
- `WebSearch.Provider`: `{ id: string; name: string }`

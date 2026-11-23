# config

## GET /api/config

Return configuration documents and discovery sources for the requested location, from lowest to highest priority.

Returns: `Config.Entry[]`

## GET /api/config/shell

Return shells available to terminal and agent execution.

Returns: `ConfigShell.Option[]`

## Types

- `Config.DirectoryEncoded`: `{ type: "directory"; path: string }`
- `Config.DocumentEncoded`: `{ type: "document"; path?: string; info: Config.InfoEncoded }`
- `Config.Entry`: `Config.DocumentEncoded | Config.DirectoryEncoded`
- `Config.InfoEncoded`: `{ $schema, shell, model, default_agent, update, share, enterprise, username, timezone, automations, permissions, policies, agents, snapshots, watcher, formatter, lsp, media, tool_output, mcp, compaction, skills, commands, instructions, references, websearch, plugins, worktree, warming, providers, experimental }`
- `ConfigShell.Option`: `{ path: string; name: string; acceptable: boolean }`

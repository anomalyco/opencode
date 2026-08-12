# Ashby MCP mock (read-first edge)

Local stdio MCP server that serves fixture jobs/candidates so moks can exercise Ashby **read** tools without a live Ashby sandbox. Write tools exist so permission allowlists can deny them; calls return an error pointing at `moks commit` / `moks push`.

| File | Role |
|------|------|
| `ashby-mock.ts` | stdio MCP server (`bun run …/ashby-mock.ts`) |
| `ashby-data.json` | open/closed jobs + candidates (Northline / Jordan Lee aligned) |
| `opencode.ashby-mock.json` | sample mcp + permission snippet (not enabled in monorepo `.opencode/`) |

## Tools

**Reads** (fixture-backed):

| MCP tool | Permission key |
|----------|----------------|
| `list_jobs` | `ashby_list_jobs` |
| `get_job` | `ashby_get_job` |
| `list_candidates` | `ashby_list_candidates` |
| `get_candidate` | `ashby_get_candidate` |

**Writes** (always error in mock; default deny):

| MCP tool | Permission key |
|----------|----------------|
| `change_stage` | `ashby_change_stage` |
| `create_note` | `ashby_create_note` |

Permission keys = `McpCatalog.toolName(server, tool)` with server name `ashby` (sanitize alphanumeric/`_`/`-` only).

## Wire into a workspace

Do **not** enable this under the monorepo root `.opencode/` (that configures the coding agent while developing moks). Copy or merge into a TA workspace config.

From `packages/opencode` (package root):

```bash
# absolute path to the mock entry
MOCK="$(pwd)/src/product/fixtures/mcp/ashby-mock.ts"
```

Relative from package root: `src/product/fixtures/mcp/ashby-mock.ts`.

Example `opencode.json` (or merge `permission` + `mcp` from `opencode.ashby-mock.json` after replacing `REPLACE_WITH_PATH`):

```json
{
  "mcp": {
    "ashby": {
      "type": "local",
      "command": ["bun", "run", "/abs/path/to/packages/opencode/src/product/fixtures/mcp/ashby-mock.ts"],
      "enabled": true
    }
  },
  "permission": {
    "ashby_list_jobs": "allow",
    "ashby_get_job": "allow",
    "ashby_list_candidates": "allow",
    "ashby_get_candidate": "allow",
    "ashby_change_stage": "deny",
    "ashby_create_note": "deny"
  }
}
```

Programmatic defaults: `ashbyPermissionDefaults()` / `ashbyMockMcpConfig(command)` in `packages/opencode/src/product/ashby-edge.ts`. The native `recruit` agent already denies Ashby write tool names and allows the four reads.

## Notes MCP

Skipped for v0 — optional later; do not block on notes read.

# `@/monitor`

Real-time monitoring layer for opencode sessions, agents and tool
activity — re-implemented natively on opencode's bus + Drizzle stack.

Inspired by [hoangsonww/Claude-Code-Agent-Monitor][ccam] (MIT), but
adapted to opencode's architecture:

| CCAM | opencode monitor |
|---|---|
| External hook scripts (stdin → POST) | In-process `Bus.subscribeAll()` |
| Hook into `~/.claude/settings.json` | Mounted as Hono routes under `/monitor/*` |
| Own SQLite DB + JSONL tail scan | Reads `SessionTable` / `MessageTable` / `PartTable` / `EventTable` directly via Drizzle |
| JSONL transcript cache | Event-sourced `EventTable` + `EventSequenceTable` (already shipped) |
| Subagent inferred from `Agent` tool | Subagent = `SessionTable.parent_id` (already shipped) |
| Spawn `claude` subprocess from dashboard | None — TUI / web client already in `packages/app` |

What we kept (verbatim or re-implemented):

- 8-mood Tabby mascot state machine (`tabby.ts`)
- i18n resources en / zh / vi (`i18n/`)
- 14 first-class webhook providers + generic HMAC (`webhook.ts`)
- 4 alert condition types (`alerts.ts`)

[ccam]: https://github.com/hoangsonww/Claude-Code-Agent-Monitor

## Layout

Multi-sibling directory (per `packages/opencode/AGENTS.md`):

| File | Role |
|---|---|
| `sql.ts`           | Drizzle schema (4 derived tables) |
| `service.ts`       | Effect Service: bus subscription + `InstanceState` lifecycle |
| `kanban.ts`        | Pure query → board snapshot (4 / 5 columns) |
| `health.ts`        | Composite health score |
| `workflows.ts`     | 11 datasets for the D3 page |
| `alerts.ts`        | Rule engine (4 condition types) + cooldown dedup |
| `webhook.ts`       | Provider registry + delivery stub |
| `tabby.ts`         | Mood derivation + quip factory |
| `routes.ts`        | Hono routes mounted under `/monitor/*` |
| `i18n/`            | en / zh / vi JSON resources |

## Status

Skeleton — schemas, types, route shapes and Tabby logic in place. The
concrete Drizzle queries for `kanban` / `health` / `workflows` and the
delivery path in `webhook.ts` are stubs to be filled in by the next
milestone.

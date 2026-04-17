# OpenCode — Quick Architecture Summary

**What it is:** A 100% open-source, provider-agnostic AI coding agent (think Claude Code alternative). TUI-first, with a client/server architecture so the "driver" (TUI, desktop app, mobile, ACP client) is decoupled from the agent runtime.

## Repo Shape

Bun + Turbo monorepo (`packageManager: bun@1.3.11`, TS 5.8, `type: module`). Workspaces under `packages/*`:

- **`packages/opencode`** — the core agent runtime & CLI (the brain)
- **`packages/app`** — SolidJS web client (Vite)
- **`packages/desktop`** / **`desktop-electron`** — Tauri + Electron desktop apps
- **`packages/console`** — cloud/console UI
- **`packages/sdk/js`** — generated JS SDK (from `openapi.json`, regen via `packages/sdk/js/script/build.ts`)
- **`packages/plugin`**, **`packages/function`**, **`packages/slack`**, **`packages/extensions`**, **`packages/identity`**, **`packages/containers`** — integrations
- **`packages/ui`** / **`packages/storybook`** — shared components
- **`packages/web`**, **`packages/docs`** — marketing/docs site
- **`infra/`** + `sst.config.ts` — deploys on SST

## Core Package Architecture (`packages/opencode/src/`)

**Entry:** `index.ts` — yargs-based CLI. Commands (`cli/cmd/*`) include `run`, `serve`, `tui/attach`, `acp`, `mcp`, `agent`, `github`, `pr`, `session`, `db`, `stats`, `export/import`, `upgrade`, etc. Bootstrap does log init, heap sampling, and a one-time JSON→SQLite migration (`JsonMigration.run`) against `~/.opencode/opencode.db`.

**Runtime foundation:** Heavy use of **Effect (v4 beta)** for composition. Two orthogonal runtime concepts:

- `makeRuntime` (`src/effect/run-service.ts`) — shared memoized layers
- `InstanceState` (`src/effect/instance-state.ts`) — `ScopedCache` keyed by project directory, giving each open project its own isolated state with automatic cleanup (watchers, processes, subscriptions). `Instance.bind` propagates AsyncLocalStorage context into native callbacks.

**Server (`src/server/`):** Hono app with a pluggable adapter (`#hono` conditional export → `adapter.bun.ts` / `adapter.node.ts`). Two route trees:

- `InstanceRoutes` — per-project session/message/tool APIs + WebSocket upgrade for streaming
- `ControlPlaneRoutes` — multi-instance/workspace plane (gated by `OPENCODE_WORKSPACE_ID`)
- `UIRoutes` — serves bundled UI
- Middleware stack: Error → Auth → Logger → Compression → CORS → Fence
- mDNS broadcast (`mdns.ts`) for local discovery; OpenAPI auto-generated via `hono-openapi` (drives SDK regen)

**Session (`src/session/`):** The conversation engine.

- `session.ts` — CRUD over `SessionTable`/`PartTable` (Drizzle + SQLite via Bun/Node adapters: `#db` conditional)
- `llm.ts` — provider calls via Vercel AI SDK (Anthropic, OpenAI, Google, Bedrock, xAI, Groq, etc. — one dependency per provider)
- `processor.ts`, `run-state.ts`, `status.ts` — run loop state machine
- `compaction.ts` + `overflow.ts` + `summary.ts` — context management
- `message-v2.ts` — typed message/part model (text, tool calls, files)
- `prompt/` + `system.ts` + `instruction.ts` — prompt assembly
- `retry.ts`, `revert.ts`, `todo.ts`, `projectors.ts` — supporting concerns

**Tools (`src/tool/`):** Each tool is a `Def` with a `Zod` schema, description (often loaded from a sibling `.txt` prompt file), and an `Effect`-returning `execute`. The `tool.ts` `wrap()` adds validation, tracing spans, and automatic output truncation (`truncate.ts`) keyed on the calling agent. Built-ins: `bash`, `read`, `write`, `edit`, `multiedit`, `apply_patch`, `grep`, `glob`, `codesearch`, `lsp`, `webfetch`, `websearch`, `task` (subagent), `plan`, `todo`, `question`, `skill`. Extras via MCP.

**Agents (`src/agent/`):** Built-ins — `build` (full-access), `plan` (read-only, denies edits, asks before bash), and a `general` subagent for multistep searches. Switched via `Tab` in the TUI; invoked as `@general` inline.

**Other key modules:**

- `mcp/` — Model Context Protocol client (external tool servers)
- `lsp/` — LSP client for diagnostics/symbols used by the `lsp` tool
- `permission/` — user-gated tool execution (plan mode hook)
- `acp/` — Agent Client Protocol (IDE/editor integration)
- `pty/` — cross-runtime pty (`#pty` conditional: `bun-pty` vs `@lydell/node-pty`)
- `provider/` — provider discovery/config across all AI SDKs
- `auth/`, `account/`, `control-plane/`, `share/`, `sync/` — auth/cloud sharing
- `storage/` — Drizzle schema (tables in `**/*.sql.ts`, snake_case), migrations in `migration/`, JSON→SQL migrator
- `bus/` — event bus (`Bus.publish`) for cross-service async events
- `snapshot/` + `git/` + `worktree/` + `patch/` — checkpoint/undo via git worktrees and patch apply
- `project/` — project/instance bootstrap; `bootstrap.ts` forks every service `init()` detached
- `skill/` + `plugin/` — user extension points
- `ide/`, `installation/`, `command/`, `shell/` — platform glue

## How a request flows

1. CLI command (`opencode run …` / `serve` / TUI attach) → bootstrap → Effect runtime
2. For a project dir: `InstanceState` materializes services (Agent, Tool, Session, Provider, LSP, Bus) scoped to that dir
3. Hono server listens; TUI/desktop client connects via HTTP + WebSocket
4. A user message starts a `Session` run: LLM call via AI SDK → streaming parts → tool calls routed through `tool/registry.ts` → each tool yields an `Effect`, outputs get truncated & persisted as `PartTable` rows → Bus events stream back to the client over the WebSocket
5. Permissions gate destructive tools depending on the active agent; MCP/plugin tools merge into the registry

## Conventions worth noting (from AGENTS.md)

- No `export namespace`; instead flat exports + `export * as Foo from "./foo"` at file bottom
- No barrel `index.ts` in multi-sibling dirs (keeps tree-shaking)
- Drizzle schemas in `src/**/*.sql.ts`, snake_case columns
- Effect-style: `Effect.gen` + `Effect.fn("Domain.method")`, prefer typed errors via `Schema.TaggedErrorClass`, no `Effect.fork` (use `forkIn(scope)`), `Effect.cached` for dedup
- Prefer Bun APIs (`Bun.file()`), avoid `try/catch`, avoid `any`, avoid `else` (early return), prefer ternaries, inline single-use vars
- Default branch is `dev` (not `main`); tests run from package dirs, typecheck via `bun typecheck` (tsgo)

## TL;DR

A Bun/Effect-powered monorepo where `packages/opencode` exposes a CLI that boots a Hono HTTP+WS server. The server hosts a per-project session engine that talks to any AI SDK provider, executes Zod-typed tools (including MCP/LSP/bash/edit/etc.) under Effect, persists everything in SQLite via Drizzle, and streams to pluggable clients (TUI, desktop, web, ACP, mobile).

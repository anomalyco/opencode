# Process Control Plane V1 (Claxedo Adaptation)

Date: February 11, 2026
Owners: Claxedo App + Gateway + OpenCode Runtime
Status: Proposed implementation spec

## 1) Objective

Implement Process Control Plane in `claxedo-app` as a local-first control plane that lets users:

1. manage project-level process definitions and lifecycle from one UI,
2. interact with each process through an embedded terminal,
3. keep process config and runtime state synchronized,
4. observe live multipane agent runs (Codex/Claude/Amp/etc.),
5. tail logs, extract agent messages, and summarize an entire tab.

This document maps the feature into this repository's architecture and files.

## 2) Fit With Current Architecture

Existing building blocks already present:

1. terminal UX and persistence in `packages/claxedo-app/src/overrides/context/terminal.tsx`,
2. buffered terminal stream logic in `packages/claxedo-app/src/overrides/components/terminal-stream.ts`,
3. terminal recovery/persist helpers in `packages/claxedo-app/src/overrides/components/terminal-buffer.ts`,
4. terminal runtime queue/backpressure in `packages/claxedo-app/src/overrides/components/terminal-runtime-queue.ts`,
5. PTY websocket forwarding in `claxedo/src/server/proxy/websocket.ts`,
6. PTY lifecycle/events in:
   - `packages/opencode/src/pty/index.ts`,
   - `packages/claxedo-app/src/opencode-patches/pty/index.ts`,
7. PTY cursor-based delta replay contract (`cursor=...` + meta frame `{ cursor }`) in:
   - `packages/opencode/src/pty/index.ts`,
   - `packages/claxedo-app/src/opencode-patches/pty/index.ts`,
   - `packages/claxedo-app/src/overrides/components/terminal.tsx`,
8. event bus -> SSE bridge at `GET /event` in `packages/claxedo-app/src/opencode-patches/server/server.ts`.

Primary gaps:

1. no first-class process registry + lifecycle orchestration layer,
2. no pane-centric live observability model (`idle`/`running`) for multi-agent tabs,
3. no unified control-plane logs endpoint for pane/process consumers,
4. no normalized agent-message extraction layer,
5. no tab-wide summary contract.

## 3) V1 Scope in This Repo

### 3.1 In Scope

1. Project and process CRUD, ordering, and persistence.
2. Process lifecycle controls (start/stop/restart, per-process and per-project).
3. Per-process terminal interaction and output management.
4. Process groups: run a full process group per project in parallel across different worktrees, with port allocation and conflict avoidance.
5. First-run review for auto-detected processes (user reviews and saves on first detection).
6. Logs-first control-plane endpoint surface (no MCP dependency for V1).
7. Live multipane observability in Control Plane:
   - every PTY is a pane,
   - detect pane state (`idle`, `running`, `exited`, `disconnected`, `error`),
   - identify active coding CLI per pane (`codex`, `claude`, `amp`, `unknown`, `null` when idle),
   - stream pane logs incrementally,
   - extract normalized agent messages,
   - summarize at the workspace tab level (parent of panes) on demand.
8. Output hydration/append behavior based on existing PTY cursor semantics.
9. Optional bounded in-memory retention for recent logs/messages.

### 3.2 Out of Scope for V1

1. Team/cloud sync for process definitions or pane state.
2. Remote host process execution outside current sandbox/runtime model.
3. MCP server exposure for process/pane control.
4. Long-term historical archival of all pane logs/messages.
5. Plugin marketplace.

## 4) Proposed System Design

### 4.1 Control Plane Subdomains

V1 has two related subdomains in one feature:

1. `Definition + Lifecycle Domain` (durable):
   - project/process definitions,
   - trust, lifecycle, status,
   - process-level operations.
2. `Live Pane Observability Domain` (ephemeral):
   - what each pane is running right now,
   - pane agent identity,
   - pane log/message tailing,
   - tab-wide summarization.

### 4.2 Frontend (`packages/claxedo-app`)

Add/extend control-plane UI and state under overrides:

1. `src/overrides/context/process-control.tsx` (definitions + lifecycle state),
2. `src/overrides/context/control-plane-live.tsx` (live pane model),
3. `src/overrides/context/control-plane-logs.ts` (cursor-based log tail state),
4. `src/overrides/context/control-plane-messages.ts` (normalized message stream),
5. `src/overrides/components/process-control/` (split view + panes + summaries),
6. `src/overrides/pages/process-control.tsx`.

Frontend responsibilities:

1. keep durable and live state separate,
2. poll/subscribe to live pane state,
3. tail logs/messages per pane with cursors,
4. render explicit idle panes (a pane can have no active run),
5. request tab summary on demand,
6. keep PTY details hidden behind control-plane APIs.

### 4.3 Gateway + Runtime (`claxedo` + `packages/opencode`)

**Decoupling principle:** The control plane must not be tightly coupled to OpenCode internals. OpenCode's upstream changes frequently. V1 uses OpenCode's PTY creation and handling, but the architecture must allow extracting control-plane logic into a standalone layer that is not tied to OpenCode core.

Route strategy:

1. Control-plane routes live in `claxedo/` (gateway) or `packages/claxedo-app/` (frontend patches), **not** in `packages/opencode/`.
2. Gateway intercepts control-plane requests at the `/pm/*` prefix and handles them directly, delegating to OpenCode PTY only for transport.
3. For cloud claxedo: gateway proxies control-plane routes the same way it proxies `/w/{workspaceId}/*` — the control-plane API surface works identically in local and cloud modes.

Expose two endpoint groups:

1. `Process Lifecycle APIs` (definition + execution),
2. `Live Pane Observability APIs` (discover/tail/parse/summarize).

### Route Mounting Location

Control-plane routes are mounted as **member routes** in `claxedo/src/server/app.ts`, after auth middleware and alongside existing API routes like `/project`, `/session`, `/provider`.

Mounting point in `app.ts`:

```ts
// In the member routes section:
const memberRoutes = new Hono<GatewayContext>()
memberRoutes.use("*", requireAuth("member"))

// ... existing routes ...
memberRoutes.route("/pm", PMRoutes())
```

This placement is correct because:

1. **After auth** — PM routes are auth-gated in cloud mode (see auth model below)
2. **Before SPA fallback** — ensures `/pm/*` is handled before static file serving
3. **Not in proxy roots** — `pm` is intentionally NOT added to `directoryProxyRoots` because PM state is gateway-owned, not proxied to sandbox OpenCode instances
4. **All three modes work** — local, hybrid, and cloud proxy middlewares all skip `/pm/*` because it's not in their root sets, so the request falls through to member routes

Route module lives at `claxedo/src/server/routes/pm.ts` (or `pm/index.ts` for a directory).

Re-export from `claxedo/src/server/routes/index.ts`:

```ts
export { PMRoutes } from "./pm.ts"
```

### 4.4 Persistence

**Storage is control-plane-owned**, not dependent on OpenCode's `storage.ts`. This keeps the control plane extractable if we later decouple from OpenCode core.

Storage location: `$projectDir/.claxedo/control-plane/` (separate from `.opencode/`).

Durable state for lifecycle domain:

1. `projects.json`: path/name/display_name/ordering/ui prefs/auto_start,
2. `processes.json`: project_id/name/command/cwd/trusted/auto_start/restart policy/ports (named port requests),
3. `runs.json`: run_id/process_id/pty_id/status/pid/started_at/stopped_at/exit_code,
4. `ports.json`: global port registry — `(project_id, worktree_id, port_name) → port number + status`,
5. `settings.json`: control-plane feature flags and UI prefs.

Concurrency: file-level advisory locking (same pattern as OpenCode's `FileStorage` but independent implementation). Multiple browser tabs may read concurrently; writes acquire lock.

Ephemeral state for live pane domain:

1. workspace-tab/pane live snapshot cache (in-memory only),
2. bounded in-memory ring buffers for pane logs/messages,
3. optional minimal cursor/UI persistence for refresh continuity (localStorage via `persisted()`).

### 4.5 Config File Source-of-Truth

For lifecycle domain, keep existing config precedence via `opencode.json{,c}` and `.opencode/opencode.json{,c}`.

For live pane domain:

1. no upfront pane definitions are required,
2. pane identity and state are discovered from current runtime activity,
3. pane may transition `idle -> running -> idle` without any config write.

## 5) Transport Abstraction (Swap PTY Later)

Control-plane contracts should not require direct UI dependency on `/pty/*`.

**V1 approach:** Implement directly against OpenCode PTY. Do **not** extract a formal adapter interface yet — we only have one transport and the abstraction would be speculative. Instead, document the isolation boundary in code so it is clear where PTY-specific logic lives.

Isolation boundary (document in code comments, extract to interface in Phase 4):

```ts
// PTY-SPECIFIC BOUNDARY: The following types represent the contract
// that must be isolated when we support alternative transports.
// Do not leak cursor/meta-frame semantics outside this boundary.

type PaneDescriptor = {
  pane_id: string
  status: "idle" | "running" | "exited" | "disconnected" | "error"
  transport_kind: "pty" | "sandbox_agent" | "custom"
  transport_id?: string
  command?: string
  cwd?: string
}

type TailResult = {
  pane_id: string
  run_id?: string
  cursor: number
  next_cursor: number
  chunk: string
  truncated?: boolean
}
```

V1: use OpenCode PTY directly via existing `packages/opencode/src/pty/index.ts` + claxedo patches.

Future (Phase 4+): extract `TerminalTransport` interface once a second transport (sandbox-agent, Daytona) proves the contract boundary:

1. `SandboxAgentTransport`,
2. `DaytonaTransport`,
3. custom runtime adapter.

## 6) Output/Log Contract

Use existing PTY cursor replay semantics as baseline for dedup and incremental fetch:

1. start from `cursor=0` when no prior position,
2. use `cursor=<last_seen>` for delta tail,
3. allow `cursor=-1` only when client already has full buffer and intentionally skips replay,
4. update cursor from stream + meta frames,
5. cap memory/response sizes to bound pressure.

Control-plane log endpoint mirrors this contract in HTTP form for pane consumers.

## 7) Trust and Security Model

Trust gating exists only for **auto-detected processes** (not user-created ones). When the control plane auto-detects a new process definition, the user is prompted to review and save it on first detection. After the user approves, the definition is persisted as trusted.

1. auto-detected process → prompt user to review command/cwd/config → user saves → `trusted: true`,
2. user-created processes are trusted implicitly (user defined them),
3. live pane endpoints are read-only in V1,
4. all endpoints follow existing auth boundary,
5. enforce strict cursor/limit validation,
6. include deterministic error codes for UI handling,
7. surface low-confidence detection/parsing without hiding raw logs.

### 7.1 Authentication Model

Control-plane routes use the same auth model as all other gateway routes:

**Cloud mode** (`AUTH_ENABLED=true`):
- Routes are gated by `requireAuth("member")` via the member routes middleware
- Clerk JWT tokens are validated, organization membership is checked
- All standard auth rules apply — no special control-plane auth logic needed

**Local mode** (`AUTH_ENABLED=false`):
- `requireAuth()` injects a stub identity: `{ userId: "dev", role: "admin" }`
- All requests pass auth checks — no tokens required
- The gateway binds to `127.0.0.1` by default (`Config.HOST`), preventing external access
- This matches how all other local gateway routes (session, project, etc.) already work

**Hybrid/sandbox-agent mode** (`USE_RIVET_SANDBOX_AGENT_SERVER=true`):
- Same as local mode for auth — `AUTH_ENABLED` is typically false
- Gateway still binds to `127.0.0.1`

No additional auth middleware is needed for control-plane routes. The existing `requireAuth("member")` on the member routes Hono instance (where control-plane routes are mounted, see Section 4.3) provides the correct auth behavior in all three modes.

**Security note:** Control-plane routes that mutate state (POST/PATCH/DELETE on process definitions, start/stop/restart) are inherently trusted in local mode because the user has physical access to the machine. In cloud mode, they're gated by Clerk auth + organization membership, same as all other workspace mutations.

## 8) API Surface (V1)

### 8.1 Process Lifecycle APIs

1. `GET /pm/projects`
2. `POST /pm/projects`
3. `GET /pm/projects/:projectID/processes`
4. `POST /pm/processes`
5. `PATCH /pm/processes/:processID`
6. `DELETE /pm/processes/:processID`
7. `POST /pm/processes/:processID/start`
8. `POST /pm/processes/:processID/stop`
9. `POST /pm/processes/:processID/restart`
10. `POST /pm/processes/:processID/trust`
11. `GET /pm/processes/:processID/logs` (for process-run logs).

### 8.2 Live Terminal Observability APIs

`tabID` refers to a **workspace tab** (from split workspace groups). Each workspace tab can contain multiple terminals (PTY instances). Terminal discovery and summary are scoped to the workspace tab.

1. `GET /pm/tabs/:tabID/live`
2. `GET /pm/terminals/:terminalID/logs?cursor=<n>&limit_bytes=<n>`
3. `GET /pm/terminals/:terminalID/messages?cursor=<n>&limit=<n>`
4. `POST /pm/tabs/:tabID/summarize-live`

### 8.3 Error Codes

1. `CP_TAB_NOT_FOUND` (404)
2. `CP_TERMINAL_NOT_FOUND` (404)
3. `CP_TERMINAL_IDLE` (409)
4. `CP_PROCESS_NOT_FOUND` (404)
5. `CP_TRUST_REQUIRED` (403)
6. `CP_CURSOR_INVALID` (400)
7. `CP_LIMIT_TOO_LARGE` (400)
8. `CP_PORT_EXHAUSTED` (409) — no free ports available in configured range
9. `CP_PORT_EXTERNAL_CONFLICT` (409) — all candidate ports (preferred + fallbacks) externally bound
10. `CP_TRANSPORT_UNAVAILABLE` (503)
11. `CP_INTERNAL` (500)

## 9) Process Groups and Worktree Parallelism

### 9.1 Process Groups

A **process group** is the set of processes defined for a project. When a project runs in a worktree, its entire process group starts together.

Key semantics:

1. each project has exactly one process group (its full list of processes),
2. the same process group can run in parallel across **different worktrees**,
3. each worktree instance gets its own set of PTYs, PIDs, and ports,
4. process group instances are isolated — stopping one worktree's group does not affect another.

### 9.2 Port Handling — Global Port Registry

The control plane owns a **global port registry**. Instead of users hardcoding port numbers, processes request ports by name via `get_port("name")`. The registry guarantees no two processes ever receive the same port, and the same port name in different worktrees automatically resolves to different ports.

As long as all processes go through the control plane, port conflicts within the system are impossible by construction.

#### 9.2.1 `get_port("name")` — Named Port Allocation

Users declare named ports in their process definition instead of numeric ports:

```ts
type ProcessDef = {
  name: string
  command: string
  cwd?: string
  ports: PortRequest[]
  env?: Record<string, string>   // supports ${port.<name>} template references
}

type PortRequest = {
  name: string        // logical name, e.g. "api", "gateway", "vite"
  env_var?: string    // env var to inject, defaults to "PORT_<NAME>" (uppercased)
  preferred?: number  // optional hint, e.g. 3000 — used if available, not guaranteed
}
```

#### 9.2.2 Template Syntax in Static Config

In a static config file (JSON/YAML), `get_port("name")` is expressed as a **template variable**: `${port.<name>}`. The control plane resolves all `${port.*}` references before spawning any process.

Templates can appear in:

1. `command` — e.g. `"bun serve --port ${port.gateway}"`,
2. `env` values — e.g. `"VITE_BACKEND_URL": "http://127.0.0.1:${port.gateway}"`,
3. any string field in the process definition.

References work **across processes** within the same project. A process can reference any port name declared by any other process in the group.

Resolution order:

1. All `PortRequest` entries across all processes in the group are collected.
2. All ports are resolved and reserved atomically (see 9.2.4).
3. All `${port.*}` templates are substituted with resolved values.
4. Resolved env vars (`PORT_<NAME>` or custom `env_var`) are injected.
5. Processes are spawned with fully resolved commands and environments.

Simple example:

```json
{
  "name": "web-server",
  "command": "bun run dev",
  "ports": [
    { "name": "api", "preferred": 3000 },
    { "name": "hmr", "env_var": "HMR_PORT" }
  ]
}
```

On start, the control plane resolves and injects:

```
PORT_API=3000      (or next available if 3000 is taken)
HMR_PORT=3001      (custom env_var name)
```

#### 9.2.3 Real-World Example: Claxedo Dev Stack

The claxedo dev environment has four interconnected services with port cross-references. Here is how they map to the process control plane config.

**Current manual setup** (env vars, hardcoded ports):

| Service | Port | Env Var | References |
|---------|------|---------|------------|
| OpenCode backend | 4096 | `OPENCODE_PORT` | — |
| Gateway | 3000 | `PORT` | needs `OPENCODE_PORT` for proxy |
| Sandbox-Agent | 8080 | `SANDBOX_AGENT_PORT` | — |
| Vite dev server | 4444 | hardcoded | needs gateway URL for proxy |

**Process group config with `${port.*}` templates:**

```jsonc
// .claxedo/control-plane/processes.json
{
  "project_id": "claxedo-dev",
  "processes": [
    {
      "name": "opencode",
      "command": "bun src/index.ts serve --port ${port.opencode} --hostname 127.0.0.1",
      "cwd": "packages/opencode",
      "ports": [
        { "name": "opencode", "preferred": 4096, "env_var": "OPENCODE_PORT" }
      ]
    },
    {
      "name": "gateway",
      "command": "bun run src/server/index.ts",
      "cwd": "claxedo",
      "ports": [
        { "name": "gateway", "preferred": 3000, "env_var": "PORT" }
      ],
      "env": {
        "HOST": "127.0.0.1",
        "OPENCODE_PORT": "${port.opencode}",
        "OPENCODE_URL": "http://127.0.0.1:${port.opencode}"
      }
    },
    {
      "name": "sandbox-agent",
      "command": "bun run start:agent",
      "cwd": "claxedo",
      "ports": [
        { "name": "sandbox-agent", "preferred": 8080, "env_var": "SANDBOX_AGENT_PORT" }
      ]
    },
    {
      "name": "vite",
      "command": "bun run vite",
      "cwd": "packages/claxedo-app",
      "ports": [
        { "name": "vite", "preferred": 4444 }
      ],
      "env": {
        "VITE_OPENCODE_BACKEND_URL": "http://127.0.0.1:${port.gateway}"
      }
    }
  ]
}
```

**What happens on `start-group` in worktree 0:**

1. Control plane collects all port requests: `opencode`, `gateway`, `sandbox-agent`, `vite`.
2. Resolves each: `opencode → 4096`, `gateway → 3000`, `sandbox-agent → 8080`, `vite → 4444` (all preferred ports free).
3. Substitutes templates:
   - opencode command → `bun src/index.ts serve --port 4096 --hostname 127.0.0.1`
   - gateway env → `OPENCODE_PORT=4096`, `OPENCODE_URL=http://127.0.0.1:4096`
   - vite env → `VITE_OPENCODE_BACKEND_URL=http://127.0.0.1:3000`
4. Injects group-wide port env vars into every process:
   ```
   PORT_OPENCODE=4096
   PORT_GATEWAY=3000 (alias: PORT=3000 via env_var override)
   PORT_SANDBOX_AGENT=8080
   PORT_VITE=4444
   ```
5. Spawns all four processes.

**What happens on `start-group` in worktree 1 (parallel):**

1. Same port requests, but preferred ports 4096/3000/8080/4444 are already bound by worktree 0.
2. Registry assigns next available: `opencode → 4097`, `gateway → 3001`, `sandbox-agent → 8081`, `vite → 4445`.
3. Templates resolve with new values automatically:
   - gateway env → `OPENCODE_PORT=4097`, `OPENCODE_URL=http://127.0.0.1:4097`
   - vite env → `VITE_OPENCODE_BACKEND_URL=http://127.0.0.1:3001`
4. Everything works — no config changes, no manual port shuffling.

**Port dashboard after both worktrees running:**

```
Port   Process         Worktree  Status
4096   opencode        wt-0      bound
4097   opencode        wt-1      bound
3000   gateway         wt-0      bound
3001   gateway         wt-1      bound
8080   sandbox-agent   wt-0      bound
8081   sandbox-agent   wt-1      bound
4444   vite            wt-0      bound
4445   vite            wt-1      bound
```

#### 9.2.4 Global Registry

The registry is a single map keyed by `(project_id, worktree_id, port_name)`:

```ts
type PortRegistryEntry = {
  port: number
  project_id: string
  process_id: string
  worktree_id: string
  port_name: string
  pid: number | null
  status: "reserved" | "bound" | "released"
  assigned_at: number
}
```

Rules:

1. **Reserve before bind** — when a process group starts, all its ports are reserved atomically before any process spawns. If any port can't be reserved, the entire start fails with a clear report.
2. **Worktree isolation** — the same `port_name` in worktree A and worktree B always resolves to different port numbers. No configuration needed.
3. **Stability across restarts** — once a port is assigned to a `(project, worktree, name)` tuple, it stays the same across process restarts within the same session. The user sees consistent ports.
4. **Release on stop** — when a process stops, its ports move to `released`. They remain in the registry for re-use on next start (same port if still free).
5. **No double-assign** — the registry never assigns the same port number to two active entries. This is the core invariant.

#### 9.2.5 Port Resolution Algorithm

When `get_port("name")` is called:

1. Check if `(project, worktree, name)` already has a `released` entry → try to reclaim the same port.
2. If `preferred` hint is set and that port is free (not in registry, not externally bound) → use it.
3. Otherwise, allocate the next free port from a configurable range (default: `3000–9999`).
4. Before assigning, probe the port with a TCP connect to confirm it's not externally bound.
5. Record in the global registry as `reserved`.
6. After process spawns and binds, mark as `bound`.

```ts
type PortRange = {
  start: number   // default 3000
  end: number     // default 9999
}
```

#### 9.2.6 Cross-Process Port References

Processes within the same project/worktree often need to know each other's ports (e.g., frontend needs the API port for proxy config). Two mechanisms:

1. **`${port.<name>}` templates** (config-time) — reference any port by name in `command`, `env`, or any string field. Resolved before spawn. This is the primary mechanism for static config files.
2. **Group-wide env injection** (runtime) — all resolved ports are injected as `PORT_<NAME>` (or custom `env_var`) into **every** process in the group. This lets application code read ports at runtime via `process.env.PORT_<NAME>`.

Both work together. Use templates when you need the port in a config value (URL, CLI flag). Use env vars when application code reads ports dynamically.

#### 9.2.7 Auto-Detection From Framework Config

Before a user manually declares ports, the control plane can suggest port names and preferred values by scanning:

1. **package.json scripts** — parse `--port` / `-p` flags from `dev`/`start`/`serve` scripts,
2. **vite.config.{ts,js}** — `server.port` field (default 5173),
3. **next.config.{ts,js,mjs}** — Next.js defaults to 3000, check for custom port,
4. **.env / .env.local** — scan for `PORT=` assignments,
5. **docker-compose.yml** — `ports:` mappings,
6. **Procfile** — Heroku-style declarations with `$PORT`.

Auto-detected ports become `preferred` hints in suggested `PortRequest` entries. Shown in UI for user review (same first-run review flow from Section 7).

#### 9.2.8 Port Dashboard

The global registry is directly exposed as a port dashboard:

1. `GET /pm/ports` — full registry across all projects and worktrees,
2. shown in the Control Plane UI as a collapsible port overview panel,
3. updated in real-time on process start/stop events.

Users see at a glance: which ports are in use, by which project/worktree/process, and which are released.

#### 9.2.9 External Conflict Handling

The registry prevents internal conflicts by construction. For external conflicts (a port bound by something outside the control plane):

1. **Pre-start probe** — before assigning, probe the port via TCP connect.
2. **If externally bound** — skip that port, try next available. Log a warning.
3. **If externally bound and it was the `preferred` port** — assign a different port, surface a notice in the UI: "Port 3000 requested by 'api' is in use externally. Assigned 3002 instead."
4. **Identify the holder** — best-effort lookup via `lsof -i :<port>` on macOS/Linux, show PID + command in the notice.

#### 9.2.10 Post-Crash Cleanup

After an unclean shutdown, ports may remain bound by zombie processes. On control plane startup:

1. load the registry from `$projectDir/.claxedo/control-plane/ports.json`,
2. probe each port that was `bound` at last shutdown,
3. if the port is still bound but the recorded PID is dead (or doesn't match), mark the entry as `released` and surface a cleanup notice,
4. if the port is still bound by the original PID (zombie), offer to kill it:
   - show PID + command for confirmation,
   - require explicit user approval (never auto-kill),
   - after kill, re-probe and release.

### 9.3 Process Group APIs

1. `POST /pm/projects/:projectID/start-group` — reserve all ports atomically then start all processes for a project in a specific worktree,
2. `POST /pm/projects/:projectID/stop-group` — stop all running processes and release ports for a project in a specific worktree,
3. `GET /pm/projects/:projectID/group-status` — status of all process instances across worktrees,
4. `GET /pm/ports` — full global port registry.

## 10) Live Terminal Runtime Model

### 10.1 Terminal = PTY

Every PTY instance is a terminal. Terminals are not declared upfront — they are discovered from live PTY activity. A workspace tab (split workspace group) can contain multiple terminals.

### 10.2 Terminal Runtime

`TerminalRuntime` fields:

1. `terminal_id` (= PTY id)
2. `workspace_tab_id` (parent workspace tab)
3. `status`
4. `agent_kind`
5. `agent_confidence`
6. `run_id` (nullable)
7. `transport_kind`
8. `transport_id`
9. `command` (best-effort)
10. `cwd` (best-effort)
11. `started_at` / `ended_at`
12. `log_cursor`
13. `last_activity_at`

### 10.3 Rules

1. no active process means `status=idle` and `agent_kind=null`,
2. `run_id` changes for each new run in same terminal,
3. logs/messages are always scoped by `(terminal_id, run_id)`,
4. stale identity is cleared when terminal returns to idle,
5. terminal lifecycle follows PTY lifecycle — terminal is created when PTY opens, transitions when process runs/exits.

## 11) Agent Detection and Message Extraction

### 11.1 Detection Approach

Agent detection is **AI-driven**, not deterministic heuristic rules.

Flow:

1. A `.md` instruction file describes what to look for (command signatures, output patterns, known agent CLIs).
2. An AI agent reads the instruction file + recent terminal output and generates a `.yaml` or `.json` config file describing the detected agent kind, confidence, and message extraction hints.
3. The generated config is persisted per terminal/run and used for subsequent message parsing.
4. On first detection, user is prompted to review (see Section 7 trust model).

Initial agent labels:

1. `codex`
2. `claude`
3. `amp`
4. `unknown`
5. `null` (idle terminal)

### 11.2 Message Parsing

Parser behavior follows the AI-generated config rather than hardcoded parser adapters:

1. config specifies message boundaries, role markers, and extraction patterns,
2. a generic parser applies the config to terminal output incrementally,
3. parser failures degrade to raw log slices,
4. parser never blocks log delivery,
5. confidence (from detection config) exposed to UI,
6. fallback: when no config exists or detection failed, raw log slices are returned as-is.

## 12) Tab Summary Contract

Summary operates at the **workspace tab level** — a workspace tab is the parent of its terminals. `POST /pm/tabs/:tabID/summarize-live` produces a summary across all terminals in that workspace tab.

Response shape:

1. `terminals[]` with per-terminal gist,
2. `tab_summary` for whole workspace tab,
3. `blockers[]`,
4. `next_actions[]`,
5. `confidence`.

### 12.1 Per-Terminal Summary Strategy

The summary strategy varies by what the terminal is doing:

1. **Normal terminal (no agent detected):** summarize scroll-back history with AI — feed recent terminal output to an AI summarizer.
2. **Agent running (codex/claude/amp):** extract and summarize last N agent messages from the parsed message stream.
3. **Closed and restarted session:** use the last session's summary as context. When a user closes an agent session and starts a new one in the same terminal, carry forward the prior session summary so the tab-level summary has continuity.

### 12.2 Summary Input

Per-terminal input combines:

1. recent normalized messages (if agent detected),
2. recent raw terminal output / scroll-back (if normal terminal),
3. prior session summary (if session was restarted),
4. terminal state + recency.

### 12.3 Idle Terminals

When all terminals are idle:

1. return explicit no-active-runs summary,
2. include recent ended-run context and prior session summaries if still in memory.

## 13) UI Adaptation Plan

### 13.1 Navigation and Layout

1. keep fixed `Control Plane` tab,
2. split main view into:
   - process registry/lifecycle panel,
   - live pane grid/list,
   - selected pane logs/messages,
   - workspace tab summary panel,
3. preserve keyboard-first navigation between list/terminal/log panes.

### 13.2 Terminal UX Requirements

Per terminal:

1. terminal label,
2. status chip,
3. agent chip + confidence,
4. command/cwd preview,
5. quick actions: `View Logs`, `View Messages`, `Summarize Tab`.

## 14) Rollout Phases

### Phase 1: Core Lifecycle

1. process CRUD + first-run review + start/stop/restart,
2. process group start/stop per worktree,
3. port allocation and conflict detection,
4. process logs endpoint,
5. process status wiring in UI.

### Phase 2: Live Terminal Discovery + Logs

1. workspace tab live endpoint (terminal = PTY discovery),
2. terminal logs tail endpoint,
3. terminal identity/status chips.

### Phase 3: Message Extraction + Summary

1. AI-driven agent detection (.md instructions → .yaml/.json config),
2. generic parser driven by detection config,
3. workspace tab summarize-live endpoint with three strategies (scroll-back / agent messages / session carry-forward),
4. summary UI panel.

### Phase 4: Hardening and Swap Readiness

1. document transport isolation boundary in code,
2. high-output stress validation,
3. verify PTY replacement boundary for future adapter extraction.

## 15) Acceptance Criteria Mapping

V1 is complete when all are true:

1. process definitions and lifecycle operations work end-to-end,
2. auto-detected processes prompt user for first-run review before execution,
3. process groups can run in parallel across different worktrees — `get_port("name")` returns unique ports per worktree via the global registry,
4. each workspace tab terminal (PTY) correctly shows idle/running state,
5. each running terminal shows best-effort agent identity and confidence (AI-driven detection),
6. terminal logs tail incrementally via cursor without duplication,
7. terminal messages endpoint returns normalized output with raw fallback,
8. workspace tab summary uses correct strategy per terminal (scroll-back / agent messages / session carry-forward),
9. terminal can transition back to idle cleanly with no stale run leakage,
10. UI relies on `/pm/*` for identity/logs/messages/summary flows,
11. control-plane routes and storage are decoupled from OpenCode internals (gateway-owned).

## 16) Test Matrix (Repository-Aligned)

1. unit tests:
   - lifecycle reducer transitions,
   - first-run review gating logic,
   - terminal state transitions (`idle -> running -> idle`),
   - `get_port("name")` resolution algorithm (preferred hint, reclaim, next-free),
   - `${port.*}` template substitution in command, env, and string fields,
   - global port registry invariant (no double-assign),
   - cross-process port references (templates + group-wide env injection),
   - port auto-detection from framework configs (vite, next, package.json scripts),
   - summary strategy selection (scroll-back vs agent messages vs session carry-forward),
   - summary output contract shape,
2. integration tests:
   - process start/stop/restart with runtime events,
   - process group parallel start across worktrees,
   - atomic port reservation for process group start,
   - worktree isolation (same port name → different ports),
   - external conflict detection and fallback assignment,
   - post-crash stale port cleanup and registry reconciliation,
   - terminal discovery from live PTY activity,
   - logs tail cursor correctness,
   - messages incremental retrieval,
   - AI-driven detection config generation,
   - summarize-live endpoint behavior,
3. e2e desktop checks:
   - multi-terminal mixed states (running + idle),
   - rapid terminal churn without stale identity bleed,
   - workspace tab summary updates after new activity,
   - same process group running in two worktrees simultaneously,
   - port dashboard reflects live registry state,
   - cross-worktree port isolation verified visually,
   - stale port cleanup prompt after simulated crash.

## 17) Initial Implementation Backlog

1. Add control-plane route module in gateway (`claxedo/`), not in `packages/opencode/`.
2. Add control-plane-owned storage layer (`$projectDir/.claxedo/control-plane/`).
3. Implement process lifecycle service and first-run review flow.
4. Implement global port registry (`ports.json`) and `get_port("name")` resolution algorithm.
5. Implement process group start/stop with atomic port reservation and cross-process injection.
6. Add port auto-detection from framework configs (vite, next, package.json, .env).
7. Add port dashboard endpoint, external conflict probing, and post-crash cleanup.
8. Add live terminal discovery service (PTY → terminal mapping).
9. Add terminal logs tail endpoint and cursor validation.
10. Add AI-driven agent detection service (`.md` instructions → config generation).
11. Add generic message parser driven by detection config.
12. Add summarize-live service with three terminal strategies.
13. Add Control Plane UI sections for process + live terminal views.
14. Add per-terminal logs/messages UI and workspace tab summary panel.
15. Add port dashboard UI and conflict resolution UX.
16. Add error-code mapping with HTTP status alignment.
17. Add test matrix coverage and stress validation.

## 18) Agent Swarm Workstreams

### Workstream A: Runtime + Routes

1. control-plane routes in gateway (decoupled from OpenCode),
2. control-plane-owned storage layer,
3. process lifecycle APIs,
4. global port registry + `get_port("name")` resolution + process group APIs,
5. live terminal APIs,
6. error-code contracts.

### Workstream B: Transport Isolation

1. document PTY isolation boundary in code,
2. PTY-based terminal discovery implementation,
3. prepare for future adapter extraction (Phase 4).

### Workstream C: Detection + Parsing

1. AI-driven detection instruction file (`.md`),
2. detection config generation pipeline,
3. generic config-driven parser.

### Workstream D: Frontend

1. control-plane state contexts,
2. terminal identity/log/message UI,
3. workspace tab summary panel with strategy selection,
4. process group management UI.

### Workstream E: QA + Hardening

1. unit/integration/e2e suite,
2. worktree parallel execution + port conflict tests,
3. high-output and reconnection stress tests,
4. degraded-path validation.

## Why

Permission decisions today are a closed `allow | ask | deny` ruleset. Power users want smarter auto-gating inspired by Copilot Autopilot / Claude Code auto mode: a cheap classifier model that permit/denies tool calls without blocking the human on every ask. KanCode already lets users bring their own models; extending permission config with named **permission modules** (built-in `cruise_control`, plugin-provided customs like `puetsua_permit`) is the natural next step without throwing away existing rules.

## What Changes

- Extend V1 permission **action** values so a rule may name a registered **permission module** (e.g. `"cruise_control"`) in addition to `"allow" | "ask" | "deny"`
- Add a top-level `permission_modules` (and dual-read–aware aliases) config map for per-module options (classifier model, timeout, fallback, tool allow/deny lists)
- Extend V2 permission rules with an optional `module` field that routes an `ask`-class decision through a module while keeping `effect` as the fail-closed / fallback outcome vocabulary
- Introduce a **permission module registry** (first-party `cruise_control` + plugin registration for custom modules)
- Ship a built-in **`cruise_control`** module: call a user-configured model to classify a pending tool permission → `allow` | `deny` | `ask`
- Wire modules into the existing ask path (V1 production TUI/CLI first; V2 Core assert path in the same change or immediately after, same contract)
- Safety defaults: fail closed on unknown module / classifier error / timeout; deny-on-uncertainty; optional ask fallback; hard never-auto-allow list for sensitive permissions
- Audit/logging of classifier decisions for session debugging
- **Not BREAKING** for existing configs: plain `allow`/`ask`/`deny` and pattern maps keep working unchanged

Non-goals / not in this change:
- Implementing the full runtime in this propose stage (specs/tasks only here; apply comes later)
- Replacing TUI/CLI `--auto` / permission mode `auto` (blunt always-once); keep it distinct from `cruise_control`
- Restoring web/desktop/console permission UIs
- Clustered / remote classifier placement
- Guaranteeing classifier immunity to prompt injection (mitigate; do not claim solved)

## Design opinion (short)

- **Worth doing for KanCode.** Users already bring cheap/fast models; gating tool use with a dedicated classifier matches the fork’s BYO-model culture and reduces ask fatigue without the bluntness of TUI `auto`.
- **Schema pick: module ID as the permission action string**, not nested `{ module, model }` under each tool. V1 already uses `Record<string, Action>` for pattern→action maps (`bash: { "*": "ask", "rm *": "deny" }`); nesting module options there collides with patterns. Put options under top-level `permission_modules.cruise_control`.
- **Built-in `cruise_control`; plugin path for customs.** First-party owns the classifier contract and safety rails. Custom modules like `puetsua_permit` register via the plugin API (revive/replace the unused `permission.ask` hook with an explicit module registry).
- **Risks:** prompt injection via tool args fooling the classifier; latency on every gated tool call; silent allow of destructive commands. Mitigate with deny-on-uncertainty, optional ask fallback, tool/permission allowlists for `cruise_control`, hard never-auto list (`external_directory` outside workspace, etc.), timeouts, and audit logs.
- **Recommended shape:** evaluate static rules first (existing last-match-wins); only when the matched action is a module ID, invoke that module; module must return `allow|deny|ask`; never invent a fourth durable effect on the wire for replies.

## Capabilities

### New Capabilities

- `permission-modules`: Pluggable permission module IDs in config, module registry (built-in + plugin), evaluation order relative to static allow/ask/deny rules, dual-read config surface, safety/audit requirements
- `permission-cruise-control`: Built-in LLM classifier module (`cruise_control`) that maps a pending tool permission request to allow/deny/ask using a user-configured model

### Modified Capabilities

- _(none — no existing OpenSpec permission requirements; `product-surface` / `package-architecture` unchanged at requirement level)_

## Impact

- `packages/schema` — widen V1 action / V2 rule shapes for module IDs; regenerate client/SDK after Protocol HttpApi changes if any
- `packages/core` — V1 config schema (`ConfigPermissionV1`), V2 `Permission` assert path, migrate helpers
- `packages/opencode` — V1 `Permission.ask` / `fromConfig`, agent merge, tool ask wiring
- `packages/plugin` — replace unused `permission.ask` hook with a permission-module registration API
- `packages/tui` / CLI — surface classifier pending/audit optionally; keep existing `auto` mode separate
- Config files: project `kancode.json(c)` / `opencode.json(c)` dual-read; user scope KanCode-only; env override story for module options TBD in design
- Docs / skill copy that describe permission as only allow/ask/deny

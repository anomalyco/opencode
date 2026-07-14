## Context

KanCode permissions are a closed `allow | ask | deny` ruleset with last-match-wins wildcards. Production TUI/CLI still runs **V1** (`permission: { bash: "ask" }` → `{ permission, pattern, action }` rules in `packages/opencode/src/permission`). **V2** Core uses `permissions: [{ action, resource, effect }]` in `packages/core/src/permission.ts`. Both evaluate the same way: find last matching rule, default to ask.

There is no module registry today. The closest seams are:

- Unused plugin hook `permission.ask` (`packages/plugin`) — typed but never triggered
- TUI/CLI permission mode `auto` — immediately replies `"once"` to every ask (not LLM-based)

Users want named modules (built-in `cruise_control`, custom `puetsua_permit`) and a first-party LLM classifier inspired by Copilot Autopilot / Claude Code auto mode that auto permit/denies tool use with a BYO cheap model.

## Goals / Non-Goals

**Goals:**

- Keep built-in `allow` / `ask` / `deny` unchanged and compatible
- Allow config to name registered permission **modules** as V1 action strings
- Provide top-level module options (`permission_modules`) without colliding with V1 pattern maps
- Registry: built-in `cruise_control` + plugin-registered custom modules
- `cruise_control`: configured model classifies tool permission → `allow` | `deny` | `ask`
- Fail-closed safety (unknown module, timeout, parse failure, uncertainty)
- Dual-read `kancode.json(c)` / `opencode.json(c)` like the rest of config
- Same contract on V1 ask path (ship first) and V2 assert path (same change)

**Non-Goals:**

- Replacing or removing TUI/CLI `--auto` / `permission.mode = auto`
- Claiming prompt-injection-proof classification
- Durable fourth wire effect beyond allow/deny/ask for human replies
- Web/desktop/console permission UIs
- Implementing runtime in the propose stage (this design guides apply later)

## Decisions

### 1. Module ID as V1 permission action (not nested under each tool)

**Decision:** Extend V1 `Action` so a rule value may be `"allow" | "ask" | "deny" | <ModuleId>`. Example:

```jsonc
{
  "permission": {
    "bash": "cruise_control",
    "edit": { "*": "ask", "*.md": "allow" },
    "read": "allow"
  },
  "permission_modules": {
    "cruise_control": {
      "model": "opencode/deepseek-v4-flash",
      // or "ollama_cloud/kimi-k2.7-code"
      "fallback": "ask",
      "timeout_ms": 8000,
      "allowlist": ["bash", "edit", "read", "glob", "grep", "list"],
      "never_auto": ["external_directory", "doom_loop"]
    }
  }
}
```

Reserved literals `allow`, `ask`, `deny` remain built-ins. Any other non-empty string is treated as a module ID lookup at evaluation time.

**Why not nested `{ module, model }` under `bash`?** V1 `Rule = Action | Record<string, Action>` already uses object keys as **patterns**. Nested module options would collide with `"*"` / `"git *"` pattern maps and break `propertyOrder`-based precedence.

**Alternative considered:** Global-only `permission_mode: "cruise_control"` — rejected; users need per-tool mix (`bash: cruise_control`, `edit: ask`).

### 2. Top-level `permission_modules` options map

**Decision:** Module-specific options live under config key `permission_modules` (snake_case to match existing config style where present; accept camelCase alias `permissionModules` if the config layer already normalizes both — prefer one canonical snake_case in schema docs).

Minimum `cruise_control` options:

| Field | Meaning | Default |
|-------|---------|---------|
| `model` | Provider/model ref (e.g. `opencode/deepseek-v4-flash`, `ollama_cloud/kimi-k2.7-code`) | required when module used |
| `fallback` | Outcome when uncertain / timeout / error: `ask` or `deny` | `deny` (fail closed); recommend documenting `ask` for interactive TUI |
| `timeout_ms` | Classifier deadline | small fixed default (e.g. 8000) |
| `allowlist` | Permission keys `cruise_control` may auto-`allow` | empty ⇒ no auto-allow (prefer **require allowlist for allow**) |
| `never_auto` | Keys that must never resolve to allow from the module | includes sensitive defaults |

**Alternative considered:** Per-rule model override — deferred; keep options at module level for v1 of this feature.

### 3. V2 rule shape: optional `module` + closed `effect`

**Decision:** Keep `effect: "allow" | "deny" | "ask"`. Add optional `module?: string`.

Semantics:

- If `effect` is `allow` or `deny`, ignore `module` (static wins; no classifier call).
- If `effect` is `ask` and `module` is set, invoke the module; use module result; on module failure use `fallback` from module config (not the rule effect).
- V1→V2 migrate: action string that is a module ID becomes `{ effect: "ask", module: "<id>" }` so static effect vocabulary stays closed on the wire.

**Alternative considered:** Put module IDs into `effect` union — rejected; breaks Schema/SDK/OpenAPI and Reply/UI assumptions that effects are only three literals.

### 4. Evaluation order

**Decision:**

1. Build ruleset as today (defaults → agent → user → session overlays → in-session always-approvals / PermissionSaved).
2. `evaluate(permission, pattern)` → last matching rule.
3. If action/effect is `allow` or `deny` → return immediately (no module).
4. If action is a module ID (V1) or `effect === "ask"` with `module` (V2) → resolve module from registry.
5. Unknown module → **deny** (fail closed) + audit event.
6. Module runs with timeout; must return `allow | deny | ask`.
7. If module returns `ask` → existing human ask UI / ACP / CLI reject-in-noninteractive path.
8. `cruise_control`-specific: if permission key not in allowlist, or in `never_auto`, force not eligible for auto-allow → use `fallback`, never silent allow.

Static `deny` still short-circuits before modules (V2 already short-circuits config deny before saved allows — preserve that).

### 5. Registry: built-in + plugin

**Decision:**

- First-party registers `cruise_control` at process startup.
- Plugins register additional modules via a new API (e.g. `permission.registerModule({ id, decide })`), replacing the unused `permission.ask` mutate-output hook.
- Module IDs MUST be unique; plugin collision with built-in or another plugin → fail load / deny registration with clear error.
- Reserved IDs: `allow`, `ask`, `deny` cannot be registered as modules.

**Alternative considered:** Only revive `permission.ask` as a single interceptor — rejected; does not support named per-tool module selection in config.

### 6. `cruise_control` classifier contract

**Decision:**

- Input to the model: structured, non-executable summary — permission key, patterns/resources, tool name/call metadata, truncated args, optional short agent/session context. Do **not** treat tool args as instructions in the system prompt; put them in a clearly delimited data section.
- Output: constrained JSON `{ "decision": "allow"|"deny"|"ask", "reason": string }` (schema-validated). Invalid / missing decision → `fallback`.
- Confidence: if we add a score later, low confidence → `fallback`; v1 may omit score and map only explicit decisions.
- Use existing provider/model resolution (same stack as chat models); one classifier call per gated ask, not per pattern if multiple patterns share one pending request — decide once for the request aggregate (deny if any pattern would deny; else ask if any ask; else allow) mirroring V2 aggregate semantics.
- Logging: session-local audit of `{ module, model, decision, reason, permission, patterns, latency_ms, error? }` without dumping secrets (redact env-like values).

### 7. Safety rails (hard defaults)

**Decision:**

- Default `fallback`: `deny` for non-interactive / missing UI; config may set `ask` for interactive comfort.
- `never_auto` defaults MUST include at least: `external_directory`, `doom_loop`, and any permission that exits plan mode / changes agent mode if those remain ask-gated (`plan_enter` / `plan_exit` where present).
- `cruise_control` MUST NOT auto-allow when allowlist is empty (safe default: classifier can only return deny/ask until user configures allowlist) **or** document the inverse clearly — prefer **require allowlist for allow**.
- Timeout / provider error / abort → `fallback`, never allow.
- Catalog hiding (`*` deny) unchanged; modules do not hide tools by themselves.

### 8. Compatibility with existing rules and auto mode

**Decision:**

- Existing configs with only allow/ask/deny need no migration.
- TUI `permission.mode = auto` remains “always reply once”; it MUST NOT invoke `cruise_control`. If both are configured, static/module evaluation still runs first; auto only applies when a human ask would be shown.
- Prefer documenting: use `cruise_control` for smart gating; use TUI `auto` only for trusted CI-like loops.

### 9. Package / dependency direction

**Decision:**

- Schema owns widened V1 action typing + V2 optional `module` + module config structs (wire-safe).
- Core owns V2 assert integration + shared module registry service interface.
- Opencode owns V1 `Permission.ask` integration (production path).
- Plugin package owns registration types.
- `cruise_control` implementation may live in core or opencode but MUST call LLM through existing provider APIs without Schema depending on Core.

### 10. Config dual-read

**Decision:** `permission` / `permissions` / `permission_modules` load through existing config merge (kancode preferred filenames, `.kancode` wins over `.opencode`). Env JSON override (`KANCODE_PERMISSION` / `OPENCODE_PERMISSION`) continues to merge into `permission`; optional later env for module options is an open question — not required for v1.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Prompt injection via tool args fools classifier into allow | Delimited data section; deny-on-uncertainty; require allowlist for allow; `never_auto`; audit log |
| Latency on every gated tool | Cheap/fast model required in docs; timeout; cache identical pending signatures optional later |
| User confuses TUI `auto` with `cruise_control` | Distinct names in docs/UI; do not alias; Copilot/Claude names are inspiration only |
| Module ID typos silently deny | Config validation: warn/error at load if module ID not registered |
| V1/V2 drift | Shared decide() + same migrate mapping; tests on both paths |
| Classifier model unavailable | Fail closed to `fallback`; clear error in audit |
| Over-broad `bash: "cruise_control"` auto-allows `rm -rf` | Pattern rules still apply if user mixes maps; allowlist + never_auto; encourage `bash: { "git *": "allow", "*": "cruise_control" }` patterns in docs |

## Migration Plan

1. Schema + config parse accept module IDs and `permission_modules` (unknown module at runtime still fail-closed).
2. Registry + `cruise_control` behind config (no behavior change until user sets a module action).
3. Wire V1 ask path; add tests.
4. Wire V2 assert path + migrate mapping.
5. Plugin registration API; deprecate unused `permission.ask` hook (or map it as a legacy bridge that registers a single anonymous interceptor — prefer delete/replace).
6. Docs / skill copy update.

Rollback: remove module actions from config; system behaves as before. Feature flags optional but not required if inert without config.

## Open Questions

1. Exact default for interactive TUI: ship `fallback: "ask"` recommended in examples while schema default remains `"deny"`?
2. Should `cruise_control` decisions that return `allow` ever write V2 `PermissionSaved` / V1 session `always`? **Recommendation:** no — classifier allows are once-scoped unless user explicitly replies always in UI.
3. Env override for `permission_modules` in v1?
4. Whether `workflow_tool_approval` participates in modules (likely out of scope initially).
5. SDK/OpenAPI: expose module field on V2 rules only; keep Reply as once/always/reject.

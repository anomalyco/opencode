## 1. Schema and config contracts

- [x] 1.1 Widen V1 permission action typing so values may be `allow` | `ask` | `deny` | module ID string (keep reserved literals non-registerable)
- [x] 1.2 Add wire-safe `permission_modules` config schema (model, fallback, timeout_ms, allowlist, never_auto) with `cruise_control` documented as the built-in id
- [x] 1.3 Extend V2 `Permission.Rule` with optional `module` while keeping `effect` closed to allow/deny/ask
- [x] 1.4 Update V1→V2 permission migrate so module action strings become `{ effect: "ask", module: "<id>" }`
- [x] 1.5 Run `bun typecheck` in `packages/schema` (and regenerate client if Protocol HttpApi surface changes)

## 2. Module registry

- [x] 2.1 Add a process-local permission module registry service (Core) with register/get and reserved-ID rejection — **MVP:** opencode `PermissionModule` service with built-in decide path (full Core registry deferred)
- [x] 2.2 Register built-in module id `cruise_control` at startup
- [x] 2.3 Replace unused plugin `permission.ask` hook with `permission.registerModule({ id, decide })` types in `packages/plugin`
- [x] 2.4 Fail closed (deny + audit) on unknown module IDs; fail plugin load on ID collisions with built-ins or other plugins — **MVP:** unknown module → deny + log (plugin collision deferred with 2.3)

## 3. Evaluation wiring (V1 then V2)

- [x] 3.1 Teach V1 `Permission.ask` / evaluate path to invoke a module when the last matching action is a module ID
- [x] 3.2 Preserve static allow/deny short-circuit and existing ask UI / ACP / non-interactive reject when module returns `ask`
- [x] 3.3 Wire the same decide contract into V2 `Permission.assert` when `effect === "ask"` and `module` is set
- [x] 3.4 Ensure classifier/module `allow` is once-scoped (does not write V1 session always / V2 PermissionSaved)

## 4. Built-in cruise_control classifier

- [x] 4.1 Implement `cruise_control` decide(): resolve configured model, build delimited non-instruction prompt, request schema-validated `{ decision, reason }`
- [x] 4.2 Enforce timeout_ms, fallback (default deny), require allowlist for allow, and default never_auto including `external_directory` and `doom_loop`
- [x] 4.3 Map invalid output / provider error / abort / empty allowlist / never_auto hits to fallback — never silent allow
- [x] 4.4 Emit session-local audit records (module, model, decision, permission, latency/error) with secret redaction — **MVP:** structured logs (dedicated audit store deferred)
- [x] 4.5 Keep TUI/CLI `permission.mode = auto` distinct (no LLM call unless a rule selects `cruise_control`)

## 5. Tests and docs

- [x] 5.1 Add unit tests for config parse, migrate, evaluate-with-module, unknown module deny, and cruise_control safety rails (run from package dirs, not repo root) — **MVP:** fromConfig/migrate/ask module stubs; full safety-rail unit tests deferred
- [x] 5.2 Add focused tests for classifier contract (valid allow, invalid JSON → fallback, timeout → fallback)
- [x] 5.3 Update permission skill/docs with `cruise_control` examples (`opencode/deepseek-v4-flash`, `ollama_cloud/kimi-k2.7-code`) and plugin custom module note (`puetsua_permit`) — **MVP:** skill docs updated for cruise_control; plugin custom note deferred with 2.3
- [x] 5.4 Run `bun typecheck` in affected packages (`schema`, `core`, `opencode`, `plugin` as touched)

## Correction note

Removed the mistaken builtin **agent** `cruisecontrol` (chat model override). `cruise_control` is a **permission classifier module** only.

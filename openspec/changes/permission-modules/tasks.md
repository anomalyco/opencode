## 1. Schema and config contracts

- [ ] 1.1 Widen V1 permission action typing so values may be `allow` | `ask` | `deny` | module ID string (keep reserved literals non-registerable)
- [ ] 1.2 Add wire-safe `permission_modules` config schema (model, fallback, timeout_ms, allowlist, never_auto) with `cruise_control` documented as the built-in id
- [ ] 1.3 Extend V2 `Permission.Rule` with optional `module` while keeping `effect` closed to allow/deny/ask
- [ ] 1.4 Update V1→V2 permission migrate so module action strings become `{ effect: "ask", module: "<id>" }`
- [ ] 1.5 Run `bun typecheck` in `packages/schema` (and regenerate client if Protocol HttpApi surface changes)

## 2. Module registry

- [ ] 2.1 Add a process-local permission module registry service (Core) with register/get and reserved-ID rejection
- [ ] 2.2 Register built-in module id `cruise_control` at startup
- [ ] 2.3 Replace unused plugin `permission.ask` hook with `permission.registerModule({ id, decide })` types in `packages/plugin`
- [ ] 2.4 Fail closed (deny + audit) on unknown module IDs; fail plugin load on ID collisions with built-ins or other plugins

## 3. Evaluation wiring (V1 then V2)

- [ ] 3.1 Teach V1 `Permission.ask` / evaluate path to invoke a module when the last matching action is a module ID
- [ ] 3.2 Preserve static allow/deny short-circuit and existing ask UI / ACP / non-interactive reject when module returns `ask`
- [ ] 3.3 Wire the same decide contract into V2 `Permission.assert` when `effect === "ask"` and `module` is set
- [ ] 3.4 Ensure classifier/module `allow` is once-scoped (does not write V1 session always / V2 PermissionSaved)

## 4. Built-in cruise_control classifier

- [ ] 4.1 Implement `cruise_control` decide(): resolve configured model, build delimited non-instruction prompt, request schema-validated `{ decision, reason }`
- [ ] 4.2 Enforce timeout_ms, fallback (default deny), require allowlist for allow, and default never_auto including `external_directory` and `doom_loop`
- [ ] 4.3 Map invalid output / provider error / abort / empty allowlist / never_auto hits to fallback — never silent allow
- [ ] 4.4 Emit session-local audit records (module, model, decision, permission, latency/error) with secret redaction
- [ ] 4.5 Keep TUI/CLI `permission.mode = auto` distinct (no LLM call unless a rule selects `cruise_control`)

## 5. Tests and docs

- [ ] 5.1 Add unit tests for config parse, migrate, evaluate-with-module, unknown module deny, and cruise_control safety rails (run from package dirs, not repo root)
- [ ] 5.2 Add focused tests for classifier contract (valid allow, invalid JSON → fallback, timeout → fallback)
- [ ] 5.3 Update permission skill/docs with `cruise_control` examples (`opencode/deepseek-v4-flash`, `ollama_cloud/kimi-k2.7-code`) and plugin custom module note (`puetsua_permit`)
- [ ] 5.4 Run `bun typecheck` in affected packages (`schema`, `core`, `opencode`, `plugin` as touched)

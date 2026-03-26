# Requirements: CoBuilder

**Defined:** 2026-03-26
**Core Value:** A coding agent that teams can actually trust in production — secure by default, provider-flexible, and extensible with team workflows.

## v1 Requirements

Requirements for the next two planned phases.

### Modular Security

- [ ] **SEC-01**: Each security module (SSRF, prompt injection, path traversal, audit log, rate limiting, security headers) can be individually enabled or disabled via `opencode.json`
- [ ] **SEC-02**: All modules default to enabled — existing configs work without changes
- [ ] **SEC-03**: Each module exposes relevant config options (e.g. SSRF `allowLocalhost`, rate limit `requestsPerMinute`, audit log `path`)
- [ ] **SEC-04**: Config is validated on startup — invalid values produce clear error messages, not silent failures
- [ ] **SEC-05**: `cobuilder onboard` security step shows module status and allows toggling during setup
- [ ] **SEC-06**: New security modules can be added without touching existing module code (open/closed principle)
- [ ] **SEC-07**: README security section updated to reflect modular system with config examples

### Workflow Plugins

- [ ] **WF-01**: `cobuilder workflow add <name-or-url>` installs a workflow plugin from a local path or GitHub URL
- [ ] **WF-02**: `cobuilder workflow list` shows installed workflow plugins with name, version, description
- [ ] **WF-03**: `cobuilder workflow remove <name>` uninstalls a workflow plugin
- [ ] **WF-04**: Installed workflow slash commands become available inside CoBuilder TUI (e.g. `/gsd:plan-phase`, `/ralph-loop`)
- [ ] **WF-05**: Workflow plugin format: directory with `WORKFLOW.md` (metadata), `commands/` (slash command definitions), `agents/` (agent prompts), `hooks/` (lifecycle hooks)
- [ ] **WF-06**: GSD methodology ships as the first reference workflow plugin (installable, not bundled)
- [ ] **WF-07**: Workflow plugins are stored in `~/.config/opencode/workflows/` and persisted across sessions
- [ ] **WF-08**: Plugin commands are sandboxed — they cannot access files outside the project directory
- [ ] **WF-09**: `cobuilder workflow add gsd` works as a shorthand for the official GSD plugin URL
- [ ] **WF-10**: README documents the workflow plugin system with install instructions and how to author plugins

## v2 Requirements

Deferred to future releases.

### Security

- **SEC-V2-01**: Third-party security plugins via MCP — teams ship custom injection detection rules
- **SEC-V2-02**: Security audit report export (PDF/JSON) for compliance teams
- **SEC-V2-03**: Per-project security config overrides (`.cobuilder/security.json` in project root)

### Workflow Plugins

- **WF-V2-01**: Workflow plugin marketplace / registry (cobuilder.dev/plugins)
- **WF-V2-02**: Ralph Loop plugin (iterative dev loop with retrospectives)
- **WF-V2-03**: GStack plugin (deployment workflow)
- **WF-V2-04**: Plugin versioning and auto-update (`cobuilder workflow update`)
- **WF-V2-05**: Plugin sandboxing via Bun's permission system

## Out of Scope

| Feature | Reason |
|---------|--------|
| Rewrite security in a separate service | Overkill — in-process modules are sufficient and simpler |
| Cloud sync of workflow plugins | Data stays local by design |
| Plugin store with paid plugins | Open source first — community plugins only |
| Disabling security modules by default | Modules default to enabled — safety first |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1 | Pending |
| SEC-02 | Phase 1 | Pending |
| SEC-03 | Phase 1 | Pending |
| SEC-04 | Phase 1 | Pending |
| SEC-05 | Phase 1 | Pending |
| SEC-06 | Phase 1 | Pending |
| SEC-07 | Phase 1 | Pending |
| WF-01 | Phase 2 | Pending |
| WF-02 | Phase 2 | Pending |
| WF-03 | Phase 2 | Pending |
| WF-04 | Phase 2 | Pending |
| WF-05 | Phase 2 | Pending |
| WF-06 | Phase 2 | Pending |
| WF-07 | Phase 2 | Pending |
| WF-08 | Phase 2 | Pending |
| WF-09 | Phase 2 | Pending |
| WF-10 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-26*
*Last updated: 2026-03-26 after initial definition*

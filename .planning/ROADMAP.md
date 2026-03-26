# CoBuilder Roadmap

**Created:** 2026-03-26
**Model:** Trunk-based phases — each phase ships a complete, mergeable feature to main.

---

## Phase 1: Modular Security System

**Goal:** Refactor the 6 hardcoded security modules into individually configurable units via `opencode.json`, with defaults that preserve all existing behavior.

**Requirements:** SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07

**Deliverables:**
- `SecurityConfig` schema added to `opencode.json` with all 6 modules and their options
- Each security module reads its config at runtime and skips execution if disabled
- Config validation on startup with clear error messages
- `cobuilder onboard` updated with a security configuration step
- New modules can be added as files in `src/security/` without touching core loader
- README security section updated with config examples

**Definition of Done:**
- `bun test` passes with modular security tests
- Existing configs (no `security` key) behave identically to today
- A new security module can be added by creating one file and registering it in the module index

---

## Phase 2: Workflow Plugin System

**Goal:** Build a first-class workflow plugin system that lets teams install methodology tooling (GSD, Ralph Loop, GStack) as CoBuilder extensions via `cobuilder workflow add`.

**Requirements:** WF-01, WF-02, WF-03, WF-04, WF-05, WF-06, WF-07, WF-08, WF-09, WF-10

**Deliverables:**
- `cobuilder workflow` CLI subcommand (add, list, remove)
- Workflow plugin format spec (`WORKFLOW.md` + `commands/` + `agents/` + `hooks/`)
- Plugin storage at `~/.config/opencode/workflows/`
- Plugin commands surface as slash commands in TUI
- GSD reference plugin (published separately, installable via `cobuilder workflow add gsd`)
- Sandboxing: plugin commands cannot access files outside project directory
- README updated with workflow plugin docs and authoring guide

**Definition of Done:**
- `cobuilder workflow add gsd` installs the GSD plugin
- `/gsd:plan-phase` is available as a slash command after install
- `cobuilder workflow list` shows installed plugins
- `cobuilder workflow remove gsd` cleanly uninstalls
- Plugin commands are blocked from accessing paths outside project root

---

## Future Phases (v2)

These are tracked in REQUIREMENTS.md under v2 but not yet scheduled:

- **Phase 3**: Third-party security plugins via MCP
- **Phase 4**: Ralph Loop + GStack workflow plugins
- **Phase 5**: Plugin registry / marketplace (cobuilder.dev/plugins)

---

*Roadmap created: 2026-03-26*
*Next: `/gsd:plan-phase 1` → Modular Security System*

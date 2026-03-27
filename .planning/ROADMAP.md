# CoBuilder Roadmap

**Created:** 2026-03-26
**Model:** Trunk-based phases — each phase ships a complete, mergeable feature to main.

## Phase Summary

- [ ] **Phase 1: Modular Security System** — Configurable security modules via opencode.json
- [ ] **Phase 2: Workflow Plugin System** — Installable methodology plugins (GSD, Ralph, GStack)

---

## Phase 1: Modular Security System

**Goal:** Refactor the 6 hardcoded security modules into individually configurable units via opencode.json, with all modules defaulting to enabled so existing configs work without changes.

**Requirements:** SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07

**Success Criteria:**
1. Each security module can be individually enabled or disabled via opencode.json
2. All modules default to enabled — existing configs work without changes
3. Config validation on startup produces clear error messages for invalid values
4. cobuilder onboard includes a security configuration step
5. New modules can be added without touching existing module code
6. bun test passes for all 6 security modules

---

## Phase 2: Workflow Plugin System

**Goal:** Build a first-class workflow plugin system that lets teams install methodology tooling (GSD, Ralph Loop, GStack) as CoBuilder extensions via cobuilder workflow add, surfacing their commands as slash commands in the TUI.

**Requirements:** WF-01, WF-02, WF-03, WF-04, WF-05, WF-06, WF-07, WF-08, WF-09, WF-10

**Success Criteria:**
1. cobuilder workflow add gsd installs the GSD plugin from a known URL
2. /gsd:plan-phase is available as a slash command after install
3. cobuilder workflow list shows all installed plugins with name/version/description
4. cobuilder workflow remove gsd cleanly uninstalls
5. Plugin commands are blocked from accessing paths outside project root
6. GSD reference plugin scaffold exists and is installable

---

*Roadmap created: 2026-03-26*

# CoBuilder Roadmap

**Created:** 2026-03-26
**Model:** Trunk-based phases — each phase ships a complete, mergeable feature to main.

## Phase Summary

- [ ] **Phase 1: Modular Security System** — Configurable security modules via opencode.json
- [ ] **Phase 2: Workflow Plugin System** — Installable methodology plugins (GSD, Ralph, GStack)
- [x] **Phase 3: UI/UX Polish** — Fix 13 identified UI/UX issues across TUI, Web app, and Electron shell (completed 2026-03-26)
- [ ] **Phase 4: UI/UX Polish II** — First-run guidance, connection error UX, update flow, onboarding progress

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

## Phase 3: UI/UX Polish

**Goal:** Fix 13 identified UI/UX issues across the TUI, Web app, and Electron shell — completing the CoBuilder rebrand, fixing first-run UX, removing debug artifacts, and improving visual polish.

**Requirements:** UX-01, UX-02, UX-03, UX-04, UX-05, UX-06, UX-07, UX-08, UX-09, UX-10, UX-11, UX-12, UX-13

**Plans:** 3/3 plans complete

Plans:
- [ ] 03-01-PLAN.md — Safe isolated fixes: tips logic, debug log, footer hint, Electron loading polish
- [ ] 03-02-PLAN.md — CoBuilder rebrand sweep across TUI, Web, Electron + cross-platform menu
- [ ] 03-03-PLAN.md — Web app UX flows: reactive onboarding, no-provider guard, composer spinner, drag handles

**Success Criteria:**
1. No "OpenCode" brand references remain in TUI, Electron menu, error pages, or window globals
2. TUI home screen shows tips only to first-time users (zero sessions)
3. Electron app has a native menu bar on Windows and Linux
4. Web app onboarding check is driven by sync state, not a 800ms timeout
5. Session view shows an inline provider prompt when no provider is connected
6. Composer shows a spinner while prompt is loading
7. Electron loading progress bar uses accent/primary color (not warning orange)
8. Web session history truncation is communicated with a "Load older messages" affordance
9. Session tabs have a visible drag handle
10. Debug console.log removed from TUI app.tsx
11. TUI footer provider hint is persistent, not timer-cycling
12. Electron loading screen shows "CoBuilder" product name
13. TUI home.tsx TODO comment resolved with a proper implementation

---

## Phase 4: UI/UX Polish II

**Goal:** Fix the next tier of UI/UX issues — add first-run guidance to TUI and Web home screens, make connection errors actionable, improve the TUI update flow to avoid abrupt exit, and add step progress to the onboarding wizard.

**Requirements:** UX2-01, UX2-02, UX2-03, UX2-04

**Plans:** 3 plans

Plans:
- [ ] 04-01-PLAN.md — Onboarding step progress + ConnectionError elapsed timer and guidance
- [ ] 04-02-PLAN.md — First-run home screens: TUI hint block + Web Getting Started panel
- [ ] 04-03-PLAN.md — TUI update flow: background download + persistent badge

**Success Criteria:**
1. TUI home screen shows contextual getting-started hints beneath the prompt for first-time users
2. Web home screen shows a "Getting started" panel for users with no sessions
3. ConnectionError screen shows elapsed retry time and actionable instructions (e.g. "Run `cobuilder serve`")
4. TUI update flow downloads in background and shows a "Restart to update" badge instead of exiting
5. `cobuilder onboard` shows step progress (e.g. "Step 2 of 4")

---

*Roadmap created: 2026-03-26*

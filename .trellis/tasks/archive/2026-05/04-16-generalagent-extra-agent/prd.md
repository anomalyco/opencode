# PRD: Integrate GeneralAgent as Extra Agent

## Background

The desktop app already integrates **OpenClaw** as a special built-in target with:

- a bottom entry in the left sidebar
- a synthetic project route (`/openclaw`)
- isolated state/persistence behavior
- desktop-side connection/bootstrap logic

The new requirement is to integrate **GeneralAgent** from `/Users/lelouch/apps/GenericAgent` as a **peer extra agent**, parallel to OpenClaw, with an entry at the bottom of the left project rail.

Research established that **GeneralAgent is not shaped like OpenClaw**:

- it is primarily a **Python application**
- core entrypoint is `agentmain.py`
- default GUI launch is `python launch.pyw`
- `launch.pyw` starts a **Streamlit** frontend and wraps it with **pywebview**
- it also includes an alternative **Qt frontend**

Because of this, directly cloning the OpenClaw integration path would create the wrong abstraction.

## Product Goal

Introduce a **generic extra-agent mechanism** in the desktop app so that:

1. OpenClaw becomes the first registered extra agent instead of a hardcoded one-off path.
2. GeneralAgent can be added as the second extra agent with equal UI status.
3. GeneralAgent can initially live as an **independent extra-agent experience** without forcing it into OpenClaw's server-bridge shape.

## Non-Goals

- Do not fully unify extra agents with ordinary project/server semantics in this iteration.
- Do not rewrite GenericAgent itself.
- Do not force GeneralAgent into the same message/file-tree behavior as normal OpenCode projects.
- Do not over-generalize OpenClaw-specific prompt/model/error behavior unless a shared abstraction is clearly needed.

## Confirmed Findings

### Existing OpenClaw coupling points

OpenClaw logic currently spans multiple layers:

- `packages/desktop/src/index.tsx`
- `packages/desktop/src-tauri/src/lib.rs`
- `packages/desktop/src-tauri/src/server.rs`
- `packages/desktop/src/bindings.ts`
- `packages/app/src/pages/layout.tsx`
- `packages/app/src/pages/layout/sidebar-shell.tsx`
- `packages/app/src/context/server.tsx`
- `packages/app/src/context/layout.tsx`
- `packages/app/src/context/global-sync.tsx`
- `packages/app/src/components/dialog-switch-project.tsx`
- `packages/app/src/pages/config.tsx`
- OpenClaw-specific input/session branches in prompt/session UI

### GenericAgent shape

GenericAgent is currently best understood as an independently runnable local app:

- Python core loop in `agentmain.py`
- CLI mode via `python agentmain.py`
- GUI mode via `python launch.pyw`
- Streamlit frontend in `frontends/stapp.py`
- optional Qt frontend in `frontends/qtapp.py`

This suggests that **GeneralAgent should initially be integrated as an extra-agent destination and container/launcher target**, not as a copy of OpenClaw's injected server target.

## Proposed Approach

### Recommendation

Build a **shared extra-agent registry and routing layer** first.

Then:

- migrate OpenClaw onto that shared mechanism
- add GeneralAgent as a second descriptor
- give GeneralAgent its own synthetic route such as `/generalagent`
- render GeneralAgent through a dedicated view/container instead of forcing the normal project/session flow

## Functional Requirements

### 1. Shared extra-agent registration

Introduce a shared descriptor model for extra agents. It should be sufficient to drive:

- id
- label
- icon
- integration key
- synthetic directory
- availability
- navigation target
- capability flags such as file tree support or session reuse assumptions

OpenClaw and GeneralAgent should both be representable through this model.

### 2. Sidebar rail support for multiple extra agents

The sidebar bottom rail currently renders a dedicated OpenClaw button. Replace this with rendering from a list of extra-agent descriptors.

Expected result:

- OpenClaw remains visible
- GeneralAgent appears beside/alongside it in the same bottom entry cluster
- active styling is descriptor-driven rather than OpenClaw-only

### 3. Synthetic project routing

Synthetic project handling must be generalized from `/openclaw` to a reusable mechanism.

Expected result:

- OpenClaw keeps working through its synthetic route
- GeneralAgent gets its own synthetic route
- route encoding/slug/navigation helpers are no longer OpenClaw-specific

### 4. State isolation for extra agents

Current persistence and synchronization logic special-cases OpenClaw. This must become “extra-agent aware”.

Expected result:

- each extra agent has isolated persisted project/session buckets where needed
- switching between ordinary projects and extra agents does not cross-contaminate state
- OpenClaw behavior remains stable after generalization

### 5. GeneralAgent first-stage experience

GeneralAgent should be introduced as an extra-agent entry with a dedicated experience.

First-stage acceptable options:

- launcher-style integration
- embedded local web container for the Streamlit UI
- dedicated panel/page that manages the local GeneralAgent runtime

This stage does **not** require GeneralAgent to fully reuse OpenCode's current project/session/file-tree model.

## Implementation Phases

### Phase 1 — Extract shared extra-agent front-end mechanism

Focus on the host app abstraction only.

Target files:

- `packages/app/src/pages/layout/sidebar-shell.tsx`
- `packages/app/src/pages/layout.tsx`
- `packages/app/src/context/server.tsx`
- `packages/app/src/context/layout.tsx`
- `packages/app/src/context/global-sync.tsx`
- `packages/app/src/components/dialog-switch-project.tsx`

Deliverables:

- shared extra-agent descriptor model
- sidebar bottom list rendering
- synthetic route helpers
- generalized state isolation helpers

### Phase 2 — Migrate OpenClaw to the shared abstraction

Deliverables:

- OpenClaw represented as an extra-agent descriptor
- no behavior loss in current OpenClaw navigation and switching
- removal of the most obvious OpenClaw-only UI/state hardcoding in shared app layers

### Phase 3 — Add GeneralAgent descriptor and dedicated experience shell

Deliverables:

- GeneralAgent entry in bottom rail
- `/generalagent` synthetic route
- dedicated page/container/shell for GeneralAgent

### Phase 4 — Wire desktop/runtime support for GeneralAgent

This phase depends on the selected embedding style.

Possible work includes:

- detecting Python availability
- launching `launch.pyw` or a Streamlit process
- attaching to a local URL
- showing runtime status and setup guidance

## File-Level Plan

### Frontend files to generalize first

- `packages/app/src/pages/layout/sidebar-shell.tsx`
  - replace single OpenClaw props with a descriptor list

- `packages/app/src/pages/layout.tsx`
  - replace `openclawDir`, `openclawSlug`, and navigation helpers with generic extra-agent route helpers

- `packages/app/src/context/server.tsx`
  - replace `integration === "openclaw"`-centric logic with generic extra-agent identity/origin helpers

- `packages/app/src/context/layout.tsx`
  - remove hardcoded filtering that only knows about `/openclaw`

- `packages/app/src/context/global-sync.tsx`
  - generalize switch/isolation behavior to descriptor-driven synthetic directories

- `packages/app/src/components/dialog-switch-project.tsx`
  - inject extra-agent synthetic entries from registry instead of special-casing OpenClaw

### Files likely to remain per-agent for now

- `packages/desktop/src/index.tsx`
- `packages/desktop/src-tauri/src/lib.rs`
- `packages/desktop/src-tauri/src/server.rs`
- `packages/desktop/src/bindings.ts`
- `packages/app/src/pages/config.tsx`
- `packages/app/src/utils/server-errors.ts`
- prompt-input/session-specific OpenClaw branches

These should stay specialized until a genuine shared need appears.

## Risks

### Runtime mismatch

OpenClaw behaves like a server target; GeneralAgent behaves like a Python app. A shared host abstraction is appropriate, but a shared runtime abstraction may not be.

### Over-generalization risk

If OpenClaw-specific prompt/model/session behavior is abstracted too early, complexity will increase without helping GeneralAgent.

### Embedding risk

If GeneralAgent is embedded through a local web container, the app will need stable process lifecycle and local URL handling. This may reveal platform-specific issues.

### Dependency/setup risk

GeneralAgent depends on Python, Streamlit, pywebview, and user-local model credentials in `mykey.py`. The desktop app may need a setup/status surface before deep integration feels usable.

## Acceptance Criteria

### Planning acceptance

- A Trellis task exists for this work.
- This PRD documents the phased implementation plan.
- The task is ready for implementation context initialization.

### Implementation acceptance for Phase 1-3

- OpenClaw still works after migration to shared extra-agent abstractions.
- Bottom sidebar supports multiple extra-agent entries.
- GeneralAgent appears as a peer extra-agent entry.
- A synthetic `/generalagent` route exists.
- Extra-agent switching is isolated from ordinary project state.

### Deferred acceptance for runtime phase

- GeneralAgent can be launched or attached from within the desktop app.
- The user sees a usable dedicated GeneralAgent experience.

## Suggested Next Actions

1. Initialize Trellis implementation context for this task.
2. Start with Phase 1 in shared frontend app layers.
3. Keep OpenClaw desktop-side runtime logic intact while migrating shared UI/state logic.
4. Only decide the exact GeneralAgent runtime container after the shared extra-agent front-end path is in place.

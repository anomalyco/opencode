---
phase: 03-ui-ux-polish
plan: "03"
subsystem: ui
tags: [solidjs, reactive, createEffect, spinner, drag-handle, tailwind]

requires:
  - phase: 03-ui-ux-polish
    provides: Plan 02 UX fixes (footer hint reactive, onMount guard removal, Electron menu cross-platform)

provides:
  - Reactive onboarding check (createEffect replaces 800ms setTimeout) in app.tsx
  - No-provider inline banner in session.tsx with connect action
  - Visual loading spinner in composer region prompt fallback
  - Drag handle grip icon on sortable session tabs

affects:
  - 03-ui-ux-polish (subsequent plans)
  - Any plan touching provider connection flow or session composer

tech-stack:
  added: []
  patterns:
    - "createEffect one-shot reactive gate: checked flag prevents re-firing after first evaluation"
    - "Tailwind animate-spin + SVG for inline loading spinners (no component dependency)"
    - "group/group-hover visibility pattern for contextual affordances (drag handles)"

key-files:
  created: []
  modified:
    - packages/app/src/app.tsx
    - packages/app/src/pages/session.tsx
    - packages/app/src/pages/session/composer/session-composer-region.tsx
    - packages/app/src/components/session/session-sortable-tab.tsx

key-decisions:
  - "Used createEffect with checked flag instead of createRoot/dispose pattern — simpler, avoids manual memory management"
  - "No-provider banner placed above SessionComposerRegion (not replacing it) — allows composer to remain accessible"
  - "Inline SVG spinner used instead of Spinner component — avoids unknown UI library dependency"
  - "Drag handle opacity-0/group-hover:opacity-40 pattern — unobtrusive but discoverable on hover"

patterns-established:
  - "Reactive gate pattern: createEffect + boolean flag for one-shot side effects after sync data loads"
  - "group + group-hover on sortable wrappers for progressive affordance disclosure"

requirements-completed: [UX-04, UX-05, UX-06, UX-09]

duration: 18min
completed: 2026-03-26
---

# Phase 3 Plan 03: UX Polish — Reactive Onboarding, No-Provider Guard, Composer Spinner, Tab Drag Handles

**Eliminated 800ms onboarding setTimeout race with a reactive createEffect gate; added no-provider session banner, composer loading spinner, and sortable tab drag handle affordance**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-03-26T00:00:00Z
- **Completed:** 2026-03-26T00:18:00Z
- **Tasks:** 2 of 2
- **Files modified:** 4

## Accomplishments

- UX-04: `onMount` + `setTimeout(800)` in `OnboardingCheck` replaced with `createEffect` + `checked` flag — provider data evaluated reactively on first sync population, not after an arbitrary delay
- UX-05: Inline no-provider banner added above `SessionComposerRegion` in session.tsx — shows when `connected.length === 0 && messagesReady()`, offers "Connect a provider" button that opens `DialogSelectProvider`
- UX-06: Composer loading fallback enhanced with `animate-spin` SVG spinner alongside the handoff/loading text
- UX-09: `SortableTab` gains a `group` class and a 6-dot grip SVG that appears on hover (`opacity-0 group-hover:opacity-40`) with `cursor-grab` affordance

## Task Commits

1. **Task 1: Reactive onboarding + no-provider guard** — `ce9b056` (feat)
2. **Task 2: Composer spinner + tab drag handles** — `c702e06` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `packages/app/src/app.tsx` — `createEffect` added to imports; `OnboardingCheck` uses reactive one-shot check
- `packages/app/src/pages/session.tsx` — `DialogSelectProvider` import added; no-provider `<Show>` banner above composer
- `packages/app/src/pages/session/composer/session-composer-region.tsx` — Loading fallback div enhanced with inline SVG spinner
- `packages/app/src/components/session/session-sortable-tab.tsx` — `group` class + 6-dot grip `<span>` with hover opacity added

## Decisions Made

- `createEffect` with a `checked` boolean flag chosen over `createRoot`/`dispose` — the dispose pattern requires tracking a cleanup function and is more error-prone; the flag approach is idiomatic and equally correct
- No-provider banner placed above (not instead of) the composer so the input area remains structurally present even when no provider is connected
- Inline SVG spinner used to avoid coupling to an unknown `@opencode-ai/ui` spinner component path — Tailwind `animate-spin` is already available everywhere in the app

## Deviations from Plan

None — plan executed exactly as written. UX-08 was pre-existing as noted in the plan (onLoadEarlier in message-timeline.tsx). No additional scope was needed.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 4 active UX issues in this plan resolved (UX-04, UX-05, UX-06, UX-09)
- TypeScript typecheck: 13/13 tasks passing, 0 errors
- Branch `feat/phase3-ui-ux-polish` ready for further Phase 3 plans or PR

---
*Phase: 03-ui-ux-polish*
*Completed: 2026-03-26*

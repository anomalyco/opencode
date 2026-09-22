# Execution Header Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the floating Execution shortcut and Review toggle from covering timeline, side-panel, or terminal header controls as badge contents change.

**Architecture:** Keep the control group stationary above panel animations. Observe its actual inline width and share that reservation through the containing session panel with each underlying header; use the original review reservation as a pre-measure fallback. Compact the badge based on available header/panel width rather than viewport alone.

**Tech Stack:** SolidJS, `@solid-primitives/resize-observer`, Playwright component stories, Bun, existing session layout.

**Spec:** `docs/superpowers/specs/2026-09-22-execution-tracking-reliability-design.md`

## Global Constraints

- Stability, simplicity, then performance; record a production benchmark baseline before changing session/timeline code and compare after the change.
- The complete group includes status text, optional Review request action, inter-control gaps, and Review toggle.
- Retain tooltips, accessible names, focus order, and explicit control heights; use logical inline spacing for RTL.
- The UI must not create runs or derive task progress from plan prose.
- No app or server restarts while debugging or verifying.
- Run `bun run check` at repository root; run tests from `packages/app`, not the root.

## Review Focus

1. A pending-input badge adds its secondary action: reservation grows without covering Open in (Task 2 geometry test).
2. A sidebar transition switches the reserved header: controls remain non-overlapping in both states (Task 2 geometry test).
3. Terminal loading and tabs headers use the same group width rather than stale fixed padding (Task 2 geometry test).
4. RTL flips placement: inline reservation and badge remain usable (Task 2 geometry test).
5. An initially unmeasured group or late model/status change: Review fallback then measured width, no permanent overlap (Task 1 geometry test).

---

## File responsibilities

- `packages/app/src/session/screen.tsx`: owns ResizeObserver, compact-available-width state and a CSS custom property on the shared panel container.
- `packages/app/src/session/header/session-header.tsx`: timeline fallback and measured-width spacer.
- `packages/app/src/session/files/session-side-panel.tsx`: side-panel actions reservation.
- `packages/app/src/session/terminal/panel.tsx`: terminal loading and tab-row reservations.
- `packages/app/src/session/header/session-header-actions.tsx` and `packages/app/src/superpowers/status-badge.tsx`: expose a compact mode if active panel width is insufficient, keeping tooltip and accessible name.
- `packages/app/component-tests/superpowers.fixture.tsx` and `superpowers.spec.ts`: production SessionScreen-based geometry fixture and click/focus regressions.

### Task 1: Baseline, failing geometry reproduction, measured reservation

**Files:**
- Modify: `packages/app/src/session/screen.tsx:455-467`
- Modify: `packages/app/src/session/header/session-header.tsx:4-12`
- Test: `packages/app/component-tests/superpowers.fixture.tsx`, `packages/app/component-tests/superpowers.spec.ts`

**Interfaces:**
- Consumes: existing `<SessionReviewToggle execution={execution()} />`, existing `SessionHeaderSpacer.visible`, `screen.panel.ref`.
- Produces: container CSS custom property `--session-header-action-width` measured in pixels, default `28px`; the timeline spacer reads the property. Task 2 reuses the same property.

- [ ] **Step 1: Record the production benchmark baseline before editing session/timeline code.** From `packages/app` run `bun run bench:tabs` and `bun run bench:entry` with their existing production Playwright configuration. Save commands, output, environment, and any pre-existing failures outside product code (in the plan execution ledger or `docs/superpowers/verification/`); do not restart an app/server.
- [ ] **Step 2: Add a failing production-layout regression.** Extend the existing SessionScreen-backed fixture (`ProductionMobileSession` uses `<SessionScreen>` at `superpowers.fixture.tsx:458`) with a desktop scenario and sufficient header actions. After `openExecutionFixture`, capture bounding boxes for the badge group and the Summary button. Assert nonintersection rather than fixed pixel distances:

```ts
const group = await page.locator('[data-slot="session-review-toggle"]').boundingBox()
const summary = await page.getByRole("button", { name: /summary/i }).boundingBox()
expect(group).not.toBeNull()
expect(summary).not.toBeNull()
expect(Math.min(group!.x + group!.width, summary!.x + summary!.width) - Math.max(group!.x, summary!.x))
  .toBeLessThanOrEqual(0)
```

If the real summary button has a different accessible name, identify it from the mounted production component and use the actual role/name; retain the geometric assertion. Run `bunx playwright test --config playwright.components.config.ts component-tests/superpowers.spec.ts -g 'execution header'` from `packages/app`; the new test must fail from the current overlap.
- [ ] **Step 3: Measure the floating group without layout feedback.** Use `createResizeObserver` as in `src/session/screen-layout.ts`; observe the actual `data-slot="session-review-toggle"` element and publish `Math.max(28, width)` to a Solid store or signal. Set `--session-header-action-width` on the shared `screen.panel.ref` container via `style={{ "--session-header-action-width": `${Math.max(28, measuredWidth)}px` }}`. Set the group ref directly in `screen.tsx`; keep the existing ref function for the panel. The absolute group must not acquire width from the reservation, preventing a measurement loop.

```ts
const [headerActions, setHeaderActions] = createStore({ width: 28 })
let headerActionGroup: HTMLDivElement | undefined
createResizeObserver(() => headerActionGroup, ({ width }) => setHeaderActions("width", Math.max(28, width)))
// on the existing panel container: style={{ "--session-header-action-width": `${headerActions.width}px` }}
// on the existing absolute action group: ref={(element) => (headerActionGroup = element)}
```
- [ ] **Step 4: Reserve measured width in the timeline header.** Replace `size-7` in `SessionHeaderSpacer` with a `shrink-0` spacer using `style={{ width: "var(--session-header-action-width, 28px)", height: "28px" }}`; keep its desktop/visible condition. This reserves the whole group while the existing `gap-2` supplies separation from Summary. Use the original 28px fallback before measurement.
- [ ] **Step 5: Run focused tests and commit.** Run the focused component regression and `bun run typecheck` in `packages/app`. `git add` the changed session/header and test files, then `git commit -m "fix(app): reserve measured execution header width"`.

### Task 2: Side/terminal reservations and compact responsive status

**Files:**
- Modify: `packages/app/src/session/files/session-side-panel.tsx:611-622`
- Modify: `packages/app/src/session/terminal/panel.tsx:250-257,340-344`
- Modify: `packages/app/src/session/screen.tsx:455-467`
- Modify: `packages/app/src/session/header/session-header-actions.tsx:14-53`
- Modify: `packages/app/src/superpowers/status-badge.tsx:30-103`
- Test: `packages/app/component-tests/superpowers.fixture.tsx`, `packages/app/component-tests/superpowers.spec.ts`

**Interfaces:**
- Consumes: `--session-header-action-width` from Task 1 and existing `ExecutionModel`.
- Produces: side/terminal measured-width reservations; `SessionReviewToggle`/`SessionHeaderActions`/`ExecutionStatusBadge` receive an optional `compact: boolean` prop, defaulting false when omitted by existing stories.

- [ ] **Step 1: Add failing geometry cases.** Reuse the production SessionScreen fixture from Task 1. Cover side panel open (Open in button), side terminal with both loading and tab header, `needs_input` with Review request action, a narrow split panel, and RTL. For each, compare the group with the adjacent button bounding boxes using the Task 1 intersection expression; after a status/layout transition assert the group and spacer widths update. Click the badge and Review request button to confirm they remain reachable.
- [ ] **Step 2: Show red.** Run `bunx playwright test --config playwright.components.config.ts component-tests/superpowers.spec.ts -g 'execution header'` from `packages/app`; the newly added side/terminal/attention cases should fail on overlap.
- [ ] **Step 3: Apply the shared measured reservation.** Replace the side-panel `size-7` Review spacer with `style={{ width: "var(--session-header-action-width, 28px)", height: "28px" }}`. Replace terminal `w-12` with `style={{ width: "calc(var(--session-header-action-width, 28px) + 20px)" }}` (preserves the former 48px fallback). In the terminal loading header, replace `pe-12` with the equivalent logical inline-end padding conditional on `reserveReviewToggle`, using that same expression. Keep reservations outside the tab scroll viewport.

```tsx
<Show when={reviewVisible()}>
  <div class="shrink-0" style={{ width: "var(--session-header-action-width, 28px)", height: "28px" }} aria-hidden />
</Show>
// terminal tab-row reservation when reserveReviewToggle:
<div class="shrink-0" style={{ width: "calc(var(--session-header-action-width, 28px) + 20px)" }} aria-hidden />
```
- [ ] **Step 4: Compact based on active panel width.** Observe the active right-hand header container (timeline or side/terminal), not only `window.innerWidth`. Pass a boolean `compact` through `SessionReviewToggle -> SessionHeaderActions -> ExecutionStatusBadge`; hide the visible badge label below `560px` of available active-header width, preserving its icon, `aria-label`, tooltip, and Review request action. Compact the secondary action to an icon with the same accessible name and a tooltip at this threshold if the action cannot fit; it must remain clickable. Use the existing mobile label hiding too. Test a split panel crossing `560px` while the viewport stays desktop-sized. Re-measure after compact state changes; keep the 28px minimum and explicit control heights.

```tsx
// Pass `compact` through the existing header components, defaulting to false for standalone fixtures.
<span data-testid="execution-status-label" classList={{ "max-md:hidden": true, hidden: props.compact }}>
  {label()}
</span>
// Keep the existing localized reviewRequest text and aria-label when replacing
// the secondary action's visible text with a compact icon/tooltip.
```
- [ ] **Step 5: Show green and compare benchmarks.** Run the focused component suite and `bun run typecheck` from `packages/app`. Re-run `bun run bench:tabs` and `bun run bench:entry` from `packages/app` under the same conditions as Task 1. Record before/after results and distinguish pre-existing failures from regressions in `docs/superpowers/verification/execution-header-layout.md`.
- [ ] **Step 6: Run wider checks and commit.** Run `bunx playwright test --config playwright.components.config.ts component-tests/superpowers.spec.ts` and `bun run typecheck` from `packages/app`, then `bun run check` from repo root. Inspect the component fixture at wide/narrow widths and RTL without restarting an app/server; document which cases were observed and do not claim that the installed client was verified. Commit with `git add packages/app/src/session packages/app/src/superpowers/status-badge.tsx packages/app/component-tests/superpowers.fixture.tsx packages/app/component-tests/superpowers.spec.ts docs/superpowers/verification/execution-header-layout.md` then `git commit -m "fix(app): adapt execution shortcut to header space"`.

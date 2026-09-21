# Task 17 verification: accessibility, localization, and visual regression coverage

Spec coverage: AC02, AC05, AC14, AC17. Authority: spec §5, §12, §13, §14 (AC17).

## Environment

| Item | Value |
|---|---|
| Bun | 1.4.2 |
| Branch | `execution-ui` |
| Package | `packages/app` |
| Component runner | Playwright + Storybook (`bun run test:components --config playwright.components.config.ts`) |
| Fixture | `component-tests/superpowers.fixture.tsx` (real components, local immutable scenarios) |
| Spec | `component-tests/superpowers.spec.ts` (102 stories) |
| Screenshot output | `packages/app/component-tests/test-results/<playwright test dir>/<name>.png` (gitignored test artifacts) |

## Step 2: RED

First focused invocation, before the story existed:

```text
$ cd packages/app
$ bun run test:components component-tests/superpowers.spec.ts --grep "execution keyboard" --workers=2
$ playwright test --config playwright.components.config.ts component-tests/superpowers.spec.ts --grep "execution keyboard" "--workers=2"
Error: No tests found.
Make sure that arguments are regular expressions matching test files.
error: script "test:components" exited with code 1
```

Recorded behaviour RED: the new story was committed to the spec, the six production/fixture files were
temporarily stashed (spec only, `git stash push -- <source files>`), and the same focused command was run
against the pre-T17 code:

```text
Running 1 test using 1 worker
[1/1] [components] › component-tests/superpowers.spec.ts:987:1 › execution keyboard path reaches tasks and returns to chat
  1) [components] › component-tests/superpowers.spec.ts:987:1 › execution keyboard path reaches tasks and returns to chat
    Test timeout of 60000ms exceeded.
    Error: locator.focus: Test timeout of 60000ms exceeded.
    Call log:
      - waiting for getByRole('tab', { name: 'Tasks', exact: true })
> 992 |   await page.getByRole('tab', { name: 'Tasks', exact: true }).focus()
```

The failure is the requested invariant being absent (the subview switcher was `role="button"` with
`aria-pressed`, not a tab). The stash was popped; the same command then passed. No intentional product
defect was introduced to obtain the red result.

## Step 3: audit findings and fixes

### Interpretation of the brief's representative story

The brief's story is explicitly representative. It assumed a `role="tab"` named `Execution` and a
`role="tab"` named `Tasks`, and it omitted a viewport. The only production element named `Execution` with
`role="tab"` is the mobile session-view tab, so the equivalent story runs at the 390 px mobile viewport:
focus the session-view `Execution` tab, Enter, focus the panel `Tasks` tab, Enter, focus/activate the
fixture's `Select API task` control, then activate `Return to conversation` and assert the composer is
focused. The keyboard path itself (tab reaches Tasks, activation works, chat is returned to) is unchanged
from the brief.

### Production audit

| Area | Finding | Change |
|---|---|---|
| Subview semantics | Map/Agents/Tasks/Activity were plain buttons with `aria-pressed` inside a `nav`; no tab/tabpanel relationship, no arrow-key model. `getByRole("tab", …)` was impossible. | `panel.tsx`: `role="tablist"` + `role="tab"` + `aria-selected` + `aria-controls`; a roving tab stop tracked separately from selection (`focusedSubview`/`tabStop`, updated on ArrowLeft/ArrowRight/Home/End, click and focus); direction-aware arrows (RTL reverses right/left); and `role="tabpanel"` (`aria-labelledby` the active tab) for the body. Content is unchanged and still renders through the existing `Switch`. |
| Visible focus | Only `.execution-agent` and `.execution-map__viewport` had focus outlines; subview tabs, task rows, map controls, progress info, activity links, expand/collapse, search/filter, diagnostics, evidence links and agent row actions had none. | `execution.css`: one `:focus-visible` rule (`2px solid var(--v2-border-border-focus)`, `-2px` offset) for those controls. |
| RTL | `.execution-agent__assignments` used physical `padding-left: 24px`. | `padding-inline-start: 24px` (resolves to the inline-start side in both directions). |
| Typography | `.execution-map` used a raw `line-height: 1.4`. | `line-height: var(--line-height-compact)` (computed `16px` at the 13 px map font). The map's node-height measurement derives from the element's computed font size, so the accessibility text-size relayout story still passes. |
| Live regions | The status badge's `sr-only` `role="status"` re-announced the changing visible summary (progress counts, active-agent counts) and therefore duplicated/chattered on data updates. `role="status"` regions in `progress.tsx`, `activity-feed.tsx`, `panel.tsx`, `agent-list.tsx` and `expanded.tsx` are static content. | `status-badge.tsx`: the live region now announces only actionable attention transitions (stale / needs input / failed / blocked) and stays empty otherwise. It is addressable as `[data-testid="execution-status-live"]`. |
| Reduced motion | The home execution summary had a 120 ms background/colour transition with no reduced-motion opt-out. | `home-summary.tsx`: `motion-reduce:transition-none`. |
| Status text + icon | Status badge and agent rows already pair a semantic icon with localized text; task rows, gate outcomes, progress run state and map nodes carry localized state text (no colour-only state). | No change needed. |
| i18n | No hardcoded user-visible English found in `packages/app/src/superpowers/**`. Token-count copy used `language.t` with a preformatted count, bypassing the count-sensitive plural API. | `agent-list.tsx` and `activity-feed.tsx` now pass the numeric token total to `language.plural`; `en.ts` gains `.one`/`.other` source entries for `execution.agent.usage.both`, `execution.agent.usage.tokensOnly` and `execution.activity.usage.tokens` (the existing English is preserved verbatim in `.other`). Two tests guard against missing keys and leftover `{{…}}` placeholders in text and in `aria-label`/`title`/`placeholder`/`alt`. |
| Keyboard/list parity | Every graph action (node select, zoom in/out, fit, reset, center, phase filter) exists as a keyboard-operable control; the Tasks view remains the list alternative and now also participates in the tab model. | Verified by existing + new tests. |

### Composer focus on returning to chat

`screen.tsx` `selectMobileView("session")` restores focus through `focusComposerEditor` (new
`session/composer/dock-focus.ts`), which scopes to `[data-component="composer-editor"]` inside
`[data-component="session-composer-dock"]` and falls back to the existing `reviewNativeRequest`
request-dock focus when no composer editor is present. A double `requestAnimationFrame` runs after the
session view has rendered. The previous implementation reused `reviewNativeRequest`'s loose
`button, textarea, input, [tabindex]` selector, which matches the composer's scroll viewport
(`tabindex="-1"`) before the contenteditable editor; the new target is the real editor.

## Keyboard / focus behaviour

| Invariant | Test |
|---|---|
| Tab-reaches Tasks, Enter activates, then returns to chat with the real composer editor focused | `execution keyboard path reaches tasks and returns to chat` |
| Return-to-chat targets the real `[data-component="composer-editor"]`, not the composer scroll viewport | `returning to chat focuses the real composer editor rather than its scroll viewport` |
| Arrow/Home/End move focus; manual activation; `aria-selected`/`aria-labelledby` follow selection | `execution subview toolbar follows the tabs pattern` |
| The tab stop moves with focus on arrows/Home/End and reverses in RTL | `execution subview tabs keep a roving tab stop in both directions` |
| Keyboard-focused controls show a visible outline | `execution controls show focus for keyboard users` |
| The expanded overlay does not trap Tab | `expanded execution never traps keyboard focus` |
| Escape ownership (inner menu keeps Escape; otherwise collapse) | pre-existing `expanded execution closes on escape unless an inner menu owns escape` |
| Tooltip carries full detail | pre-existing `execution shortcut tooltip preserves full detail` |

## Localization coverage

- `execution surfaces render localized copy without missing keys` walks `observer`, `tracked`,
  `tasks-detailed`, `map-large`, `activity` and `permission-pending`, asserting the rendered text and every
  `aria-label` / `title` / `placeholder` / `alt` value never match an unresolved `execution.*` key and
  never contain a `{{…}}` placeholder.
- Token counts render through `language.plural` (`execution.agent.usage.both`,
  `execution.agent.usage.tokensOnly`, `execution.activity.usage.tokens`); the numeric total is passed as
  the count and the localized group-separated string is interpolated as `{{tokens}}`. Other numeric
  execution labels (`execution.status.verified`, `execution.progress.count`, `execution.tasks.planRevision`,
  `execution.task.attempt`, `execution.activity.revision`) are non-inflecting fractions/labels and already
  route through `language.t`; `execution.progress.skipped/failed/blocked/review`,
  `execution.tasks.assignmentCount`, `execution.task.assignments.agentCount` and
  `execution.agent.assignments.show` already used `language.plural`.
- Existing stories already assert English source strings for every subview, state, gate outcome, activity
  type, tooltip and accessible name.

## RTL / reduced motion / text zoom / colour scheme

| Check | Command / story | Observed |
|---|---|---|
| RTL logical indent | `execution agent indentation follows the document direction` | LTR `padding-left: 24px`, `padding-right: 0px`; after `dir="rtl"` `padding-right: 24px`, `padding-left: 0px`, `direction: rtl`. |
| RTL header mirroring | pre-existing `execution shortcut mirrors the icon before the label in rtl` | passes |
| RTL mobile panel | pre-existing `mobile execution keeps one panel and works in rtl` | passes |
| Compact line-height / descenders | `execution compact copy keeps the shared line height` | No 13 px text in the panel computes below a 16 px line box; `.execution-map` computes `font-size: 13px` / `line-height: 16px` exactly. |
| 200 % zoom | pre-existing `mobile execution controls stay reachable at 200% zoom` (195×380 CSS viewport) and new `execution surfaces avoid horizontal overflow at 200 percent zoom` | Panel `scrollWidth - clientWidth ≤ 1`; all four subview tabs visible and Tasks list reachable. |
| Reduced motion | `execution surfaces respect reduced motion` | With `prefers-reduced-motion: reduce`, the home execution summary computes `transition-property: none` and the expanded overlay contains no running animations. |
| Light / dark | `execution panel renders in light and dark color schemes` | The panel background resolves to different `rgb(...)` values under `data-color-scheme="light"` vs `"dark"` (tokens `--v2-grey-50` `#ffffff` / `--v2-grey-1100` `#161616`). |

## Screenshots

Captured by the `execution visual fixture …` stories; each asserts the file is a non-empty PNG
(signature `89504e470d0a1a0a`) and the scenario's state marker. Files live under
`packages/app/component-tests/test-results/<playwright test dir>/` (gitignored).

| Scenario | Story | File | Size | Bytes | sha256 (first 16) |
|---|---|---|---|---|---|
| Observer | `execution visual fixture captures the observer surface` | `observer.png` | 1280×720 | 44835 | `20d564a57a0a38da` |
| Active run | `execution visual fixture captures an active run` | `active-run.png` | 1280×720 | 59281 | `af83731a5a67f993` |
| Error (failed bridge) | `execution visual fixture captures a failed bridge` | `error.png` | 1280×720 | 11944 | `598f78aca1487cc1` |
| Stale snapshot | `execution visual fixture captures a stale snapshot` | `stale.png` | 1280×720 | 72809 | `c15587cc226f2b59` |
| Permission pending | `execution visual fixture captures a pending permission` | `permission-pending.png` | 1280×720 | 54224 | `b864f1071e3f0eb1` |
| Large grouped graph | `execution visual fixture captures the grouped large graph` | `large-graph.png` | 1280×720 | 63222 | `2ddbc085e787d694` |
| Mobile | `execution visual fixture captures the mobile presentation` | `mobile.png` | 390×760 | 56137 | `57046d948ec312c7` |

The mobile story captures the Execution panel, so the real composer rendered in the mobile session view is
not part of that image.

## Step 4: gates

```text
$ cd packages/app
$ bun run test:components component-tests/superpowers.spec.ts --workers=2
  104 passed (6.0m)
```

```text
$ cd packages/app
$ bun run typecheck
$ tsgo -b
(exit 0)
```

```text
$ cd packages/app
$ bun run build
✓ built in 13.34s
PWA v1.3.0
mode      generateSW
precache  917 entries (33506.93 KiB)
files generated
  dist/sw.js
(exit 0)
```

```text
$ bun run lint            # from repo root
$ oxlint
Found 0 warnings and 0 errors.
Finished in 242ms on 4235 files with 1 rules using 12 threads.
(exit 0)
```

### Paired benchmark comparison for the session-layer change

`packages/app/AGENTS.md` requires a recorded baseline and comparison for session-layer changes; the
session change is the `selectMobileView("session")` composer-focus restore. The T01 baseline
(`docs/superpowers/verification/execution-ui/baseline.md`) is the pre-change reference; both scenarios
were re-run on the same machine with the same production build and fixtures.

```text
$ cd packages/app
$ bun run bench:tabs
  100 passed (8.9m)
Tab-switch benchmark: passed
$ bun run bench:entry
  20 passed (6.5m); 40 failed on the pre-existing session-entry-benchmark.spec.ts:47 assertion
```

| Scenario (p95) | T01 baseline | After T17 | Delta |
|---|---|---|---|
| tab switch: cold, review closed — firstCorrect / stable | 530.90 / 583.00 ms | 327.90 / 385.20 ms | −38.2% / −33.9% |
| tab switch: cold, review open — firstCorrect / stable | 657.50 / 759.80 ms | 400.30 / 441.20 ms | −39.1% / −41.9% |
| tab switch: warm, review closed — firstCorrect / stable | 106.60 / 305.50 ms | 76.70 / 193.40 ms | −28.0% / −36.7% |
| tab switch: warm, review open — firstCorrect / stable | 200.70 / 434.70 ms | 135.40 / 251.50 ms | −32.5% / −42.1% |
| tab switch: warm, review resized — firstCorrect / stable | 246.80 / 365.70 ms | 152.90 / 271.40 ms | −38.1% / −25.8% |
| entry: cold session from Home — firstCorrect / stable | 1069.80 / 1227.00 ms | 664.10 / 787.10 ms | −37.9% / −35.9% |

No scenario regressed by more than 10% (all improved). `bench:entry` remains PARTIAL with the same
pre-existing `expect(writes).toEqual([])` failure at `session-entry-benchmark.spec.ts:47` recorded in the
T01 baseline; the two failing scenarios produce no metrics in either run. Raw records:
`packages/app/e2e/test-results/performance/tab-switch-benchmark.jsonl`; logs:
`/tmp/opencode/t17-bench-tabs.log`, `/tmp/opencode/t17-bench-entry.log`.

The brief's commands were run exactly as listed; the focused component command additionally used the
`--workers=2` flag requested for this task (the brief's stricter full-file form is the same command without
it and shares the same result).

## Pre-existing failures (recorded, not passes)

```text
$ bun run typecheck       # from repo root, turbo across 36 tasks
 ERROR  @opencode/posts#typecheck: command .../packages/posts /usr/local/bin/bun run typecheck exited (1)
 @opencode/www:typecheck: [GenerateContentTypesError] `astro sync` ... Tsconfig not found @tsconfig/bun/tsconfig.json
 Tasks: 28 successful, 36 total
 Failed: @opencode/posts#typecheck
```

This is the same pre-existing failure recorded by T11 (unrelated to this task; `packages/app` typecheck
passes on its own). The canonical root `bun run check` therefore does not pass in this environment.

## Upstream defect recorded separately

- `text-13-regular` is used across the app (including `status-badge.tsx`) but produces no CSS rule in the
  built stylesheet (`grep -c 'text-13-regular' packages/app/dist/_assets/*.css` → `0`). Affected elements
  therefore inherit their typography instead of the intended 13 px class. This is pre-existing and
  app-wide, not introduced or masked by T17; the panel's own compact copy is asserted against the shared
  line-height variables instead.

## Unrun gates

- A component test that mounts the production `SessionScreen` and asserts the composer-focus restoration
  in `selectMobileView` is not runnable with the current Storybook component harness (the same
  `screen.tsx` mount limitation recorded by T03/T16). The production helper (`focusComposerEditor`) is
  exercised by the fixture against the real `ComposerEditor` DOM; a production `SessionScreen` mount
  remains for T18 (e2e) / T20.
- `bench:entry` remains PARTIAL: its two failing scenarios fail before recording metrics on the
  pre-existing `session-entry-benchmark.spec.ts:47` assertion (identical to the T01 baseline). The
  measurable scenario is compared above; the failing ones are not a T17 regression.
- Screenshot artefacts are regenerated per run under the gitignored `component-tests/test-results`
  directory; they are not committed baselines, so there is no pixel-diff gate. The captured PNGs listed
  above are the recorded evidence from the run in this document.

## Files changed

- `packages/app/src/superpowers/panel.tsx`
- `packages/app/src/superpowers/execution.css`
- `packages/app/src/superpowers/status-badge.tsx`
- `packages/app/src/superpowers/home-summary.tsx`
- `packages/app/src/superpowers/agent-list.tsx`
- `packages/app/src/superpowers/activity-feed.tsx`
- `packages/app/src/session/screen.tsx`
- `packages/app/src/session/composer/dock-focus.ts` (new)
- `packages/app/src/runtime/i18n/en.ts`
- `packages/app/component-tests/superpowers.fixture.tsx`
- `packages/app/component-tests/superpowers.spec.ts`
- `docs/superpowers/verification/execution-ui/accessibility.md` (this file)

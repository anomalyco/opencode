# Prompt Bar Spatial Gradient Ripple

## TL;DR

> **Summary**: Add a true spatial diagonal ripple background for the prompt bar using per-cell rendering, with configurable speed/intensity/direction, while preserving existing animation triggers and layout.
> **Deliverables**: Spatial ripple plugin, prompt bar render hook for per-cell gradients, tui.json options, regression tests.
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: Config schema → Ripple math/plugin render → Prompt bar render hook + tests

## Context

### Original Request

User wants a true upper-left to bottom-right spatial ripple (web-like gradient) in the prompt bar; prior color cycling is not acceptable. Wants a plan and config knobs.

### Interview Summary

- Keep existing animation trigger behavior; ripple should follow existing plugin gating (idle-only unless plugin already handles non-idle states).
- Palette: theme-derived.
- Intensity: subtle.
- Add tui.json config knobs for speed/intensity/direction.

### Metis Review (gaps addressed)

- Metis consultation timed out; gaps reviewed manually (render pipeline, config schema, test plan).

## Work Objectives

### Core Objective

Implement a true spatial diagonal ripple in the prompt bar background using per-cell rendering, without altering layout spacing or state-trigger behavior.

### Deliverables

- New prompt bar ripple math helper and plugin render path.
- Prompt bar render hook that draws per-cell gradients when the ripple plugin is active.
- `tui.json` options for speed/intensity/direction under `prompt_bar_animation.options.diagonal_ripple`.
- Unit tests for ripple math and config parsing; updated registry tests.

### Definition of Done (verifiable conditions with commands)

- `bun run --cwd packages/opencode test:prompt-bar-regressions`
- `bun run --cwd packages/opencode typecheck`
- `bun run --cwd packages/opencode build`
- New tests validate spatial variation (different cells) and temporal variation (different ticks).

### Must Have

- Spatial gradient ripple renders diagonally across prompt bar background.
- Ripple uses theme-derived colors and subtle intensity by default.
- Config options available in `tui.json` without breaking existing configs.
- No layout/padding/margin changes to the prompt bar.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- No layout changes (padding/margins/heights) or border glyph changes.
- No changes to when animations start/stop (keep existing plugin gating).
- No global theme or unrelated UI changes.

## Verification Strategy

> ZERO HUMAN INTERVENTION — all verification is agent-executed.

- Test decision: tests-after (bun test)
- QA policy: Every task has agent-executed scenarios
- Evidence: .sisyphus/evidence/task-{N}-{slug}.txt

## Execution Strategy

### Parallel Execution Waves

Wave 1: Config schema + ripple math helper/plugin interface
Wave 2: Prompt component render hook + tests

### Dependency Matrix (full, all tasks)

- Task 1 blocks Task 3
- Task 2 blocks Task 3
- Task 3 blocks Task 4

### Agent Dispatch Summary (wave → task count → categories)

- Wave 1 → 2 tasks → unspecified-high
- Wave 2 → 2 tasks → unspecified-high

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Add tui.json schema for ripple options

  **What to do**: Extend `prompt_bar_animation` schema to accept `options.diagonal_ripple` with `speed`, `intensity`, and `direction`; update config loading test to assert values flow through `TuiConfig.get()`.
  **Must NOT do**: Do not change default prompt bar behavior or add new config files; schema change only.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: config + test updates across config layer.
  - Skills: [`coding-style`] — follow repo conventions.
  - Omitted: [`git-master`] — not needed for code changes.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: Task 3 | Blocked By: none

  **References** (executor has NO interview context — be exhaustive):
  - Schema pattern: `packages/opencode/src/config/tui-schema.ts`
  - Config loading tests: `packages/opencode/test/config/tui.test.ts`
  - Config loader: `packages/opencode/src/config/tui.ts`

  **Acceptance Criteria** (agent-executable only):
  - [ ] `TuiInfo` accepts `prompt_bar_animation.options.diagonal_ripple` with valid types.
  - [ ] `packages/opencode/test/config/tui.test.ts` asserts these values are parsed.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: tui.json parses ripple options
    Tool: Bash
    Steps: bun test test/config/tui.test.ts
    Expected: test suite passes
    Evidence: .sisyphus/evidence/task-1-tui-schema.txt
  ```

  **Commit**: YES | Message: `feat(tui): add diagonal ripple config schema` | Files: [`packages/opencode/src/config/tui-schema.ts`, `packages/opencode/test/config/tui.test.ts`]

- [x] 2. Add ripple math helper and unit tests

  **What to do**: Create a pure helper to compute diagonal ripple colors per cell from `theme`, `width/height`, `tick`, and resolved config (speed/intensity/direction). Use this formula:
  - Normalize coords: `u = x / max(1, width - 1)`, `v = y / max(1, height - 1)`.
  - Direction vectors: `down-right=(1,1)`, `down-left=(-1,1)`, `up-right=(1,-1)`, `up-left=(-1,-1)`.
  - Diagonal value: `d = (u * dirX + v * dirY + 1) / 2` (0..1).
  - Phase: `phase = (d * 2 * Math.PI * 2.25) + (tick * speed)` (2.25 waves across diagonal).
  - Ripple: `ripple = (Math.sin(phase) + 1) / 2`.
  - Base blend: `base = mix(theme.primary, theme.accent, ripple)`.
  - Sheen blend: `color = mix(base, theme.secondary, ripple * intensity)`.
  - Use alpha from blended colors (RGBA.fromValues). Clamp `speed` (default 0.18, min 0.02, max 1), `intensity` (default 0.35, min 0, max 1).
    Expose `resolvePromptBarRippleConfig` with defaults; add unit tests for spatial and temporal variation.
    **Must NOT do**: Do not hook into prompt component or registry here; keep helper pure.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: new utility + tests.
  - Skills: [`coding-style`] — follow repo conventions.
  - Omitted: [`git-master`] — not needed for code changes.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: Task 3 | Blocked By: none

  **References** (executor has NO interview context — be exhaustive):
  - RGBA helpers: `packages/opencode/node_modules/@opentui/core/lib/styled-text.d.ts`
  - OptimizedBuffer API (for future render usage): `packages/opencode/node_modules/@opentui/core/buffer.d.ts`
  - Theme palette shape: `packages/opencode/src/cli/cmd/tui/util/prompt-bar-visual.ts`

  **Acceptance Criteria** (agent-executable only):
  - [ ] New helper returns different colors for different (x,y) at same tick (spatial variation).
  - [ ] New helper returns different colors for same (x,y) at different ticks (temporal variation).

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: ripple math unit test
    Tool: Bash
    Steps: bun test test/cli/tui/prompt-bar-ripple.test.ts
    Expected: test suite passes
    Evidence: .sisyphus/evidence/task-2-ripple-math.txt
  ```

  **Commit**: YES | Message: `feat(tui): add spatial ripple math helper` | Files: [`packages/opencode/src/cli/cmd/tui/util/prompt-bar-ripple.ts`, `packages/opencode/test/cli/tui/prompt-bar-ripple.test.ts`]

- [x] 3. Extend plugin interface + registry for spatial render

  **What to do**: Extend `PromptBarAnimationPlugin` to optionally provide a `render` function that receives an `OptimizedBuffer`, animation state, and resolved ripple config; implement `diagonal-ripple` plugin to render per-cell gradients using the helper; keep non-idle behavior aligned with legacy overlay (no trigger changes).
  **Must NOT do**: Do not change how idle-cycle enabling is computed; no layout/padding changes.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: core animation interfaces and registry.
  - Skills: [`coding-style`] — follow repo conventions.
  - Omitted: [`git-master`] — not needed for code changes.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Task 4 | Blocked By: Tasks 1-2

  **References** (executor has NO interview context — be exhaustive):
  - Plugin interface: `packages/opencode/src/cli/cmd/tui/util/prompt-bar-animation-plugin.ts`
  - Registry patterns: `packages/opencode/src/cli/cmd/tui/util/prompt-bar-animation-registry.ts`
  - Legacy overlay logic: `packages/opencode/src/cli/cmd/tui/util/prompt-bar-visual.ts`
  - OptimizedBuffer: `packages/opencode/node_modules/@opentui/core/buffer.d.ts`

  **Acceptance Criteria** (agent-executable only):
  - [ ] `diagonal-ripple` plugin exposes `render` and draws per-cell background colors.
  - [ ] Non-idle states still resolve to legacy overlay colors.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: registry exposes diagonal-ripple plugin
    Tool: Bash
    Steps: bun test test/cli/tui/prompt-bar-animation-registry.test.ts
    Expected: test suite passes
    Evidence: .sisyphus/evidence/task-3-plugin-registry.txt
  ```

  **Commit**: YES | Message: `feat(tui): add spatial ripple renderer` | Files: [`packages/opencode/src/cli/cmd/tui/util/prompt-bar-animation-plugin.ts`, `packages/opencode/src/cli/cmd/tui/util/prompt-bar-animation-registry.ts`, `packages/opencode/test/cli/tui/prompt-bar-animation-registry.test.ts`]

- [ ] 4. Render spatial ripple in prompt bar

  **What to do**: Expose animation state (idleCycleIndex/idleCycleEnabled) from `usePromptBarColorEffect`; read `tuiConfig.prompt_bar_animation?.options?.diagonal_ripple` and resolve defaults; in the prompt component, detect spatial ripple support and add `renderBefore` on the outer prompt box to draw gradients using the resolved config; set `shouldFill`/backgrounds to transparent when spatial ripple is active so the gradient shows through; keep layout spec unchanged; add a source-level harness test to assert render hook wiring.
  **Must NOT do**: Do not change layout constants or border glyphs; do not alter idle-cycle gating logic.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: prompt UI integration + test updates.
  - Skills: [`coding-style`] — follow repo conventions.
  - Omitted: [`git-master`] — not needed for code changes.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: none | Blocked By: Task 3

  **References** (executor has NO interview context — be exhaustive):
  - Prompt component: `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
  - Color effect hook: `packages/opencode/src/cli/cmd/tui/component/prompt/color-effect.ts`
  - Layout policy: `packages/opencode/src/cli/cmd/tui/util/prompt-bar-layout-policy.ts`
  - RenderBefore usage example: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
  - Layout harness tests: `packages/opencode/test/cli/tui/prompt-layout-harness.test.ts`

  **Acceptance Criteria** (agent-executable only):
  - [ ] Spatial ripple draws per-cell gradient when plugin is `diagonal-ripple` and theme is non-transparent.
  - [ ] Prompt layout dimensions remain unchanged (layout spec tests still pass).
  - [ ] `prompt-layout-harness.test.ts` asserts render hook wiring.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: prompt bar regressions
    Tool: Bash
    Steps: bun run --cwd packages/opencode test:prompt-bar-regressions
    Expected: 0 failures
    Evidence: .sisyphus/evidence/task-4-prompt-regressions.txt

  Scenario: runtime ripple evidence
    Tool: Bash
    Steps: bash scripts/run-sandbox-tui.sh --theme lucent-orng --prompt-plugin diagonal-ripple --prompt-enabled true --use-real-auth idle
    Expected: Evidence captured; ANSI output includes varying background codes across columns
    Evidence: .sisyphus/evidence/task-4-ripple-runtime.txt
  ```

  **Commit**: YES | Message: `feat(tui): render spatial ripple in prompt bar` | Files: [`packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`, `packages/opencode/src/cli/cmd/tui/component/prompt/color-effect.ts`, `packages/opencode/src/cli/cmd/tui/util/prompt-bar-layout-policy.ts`, `packages/opencode/test/cli/tui/prompt-layout-harness.test.ts`]

## Final Verification Wave (4 parallel agents, ALL must APPROVE)

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy

- Commit 1: `feat(tui): add diagonal ripple config schema` — schema + config test
- Commit 2: `feat(tui): add spatial ripple renderer` — ripple math helper + plugin interface + registry tests
- Commit 3: `feat(tui): render spatial ripple in prompt bar` — prompt component/hook + integration tests

## Success Criteria

- Spatial ripple visible across the prompt bar with diagonal gradient variation.
- Config knobs (speed/intensity/direction) function as documented defaults.
- Regression suite passes and no layout regressions introduced.

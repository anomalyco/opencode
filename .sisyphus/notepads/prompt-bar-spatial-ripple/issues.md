# Issues

- Task 1 blocked: subagent session ses_33a9f482cffe56sq04cVE3pMZc timed out repeatedly and did not modify target files.
- Task 2 blocked: subagent sessions ses_33a80d98bffeMBEmomaoro8vKq / ses_33a76f230ffe6TZ4hA7f66A7AB / ses_33a6d4d22ffeepFuBTP6PQqesZ timed out without modifying target files.
- Task 4 QA blocked: sandbox script requires --openai-api-key (or auth.json via --use-real-auth).

# Issues

## Task 1: tui.json schema for ripple options

- No blockers encountered. Schema extension and test addition were straightforward.
- Working directory is `/home/choza/projects/opencode-source` not `Claude-source` — plan paths had wrong base dir.

## Task 4 sandbox QA (2026-03-07)

- Sandbox runtime evidence capture blocked: `--openai-api-key` (or `auth.json` via `--use-real-auth`) required but not available in CI/sandbox environment.
- Evidence file `.sisyphus/evidence/task-4-ripple-runtime.txt` records the credential requirement.
- All unit/harness tests pass (54/54, 187 expect calls).

## F2: Code Quality Review — Minor Issues (2026-03-07)

### Dead `renderBefore` field in animation memo (LOW)

- Location: `color-effect.ts:68` — `renderBefore: !!props.plugin().render`
- This field is computed in the `animation` memo but never consumed by any caller.
- It was previously passed to `promptBarSpatialRippleActive` but removed to fix a tsgo excess property error.
- The policy function gates on `plugin.id === "diagonal-ripple"` instead, making this field redundant.
- Impact: Negligible — one boolean evaluation per reactive cycle. Not a bug, just dead code.

### Incomplete scoped buffer — latent risk (LOW)

- Location: `index.tsx:1027-1033` — scoped buffer only implements `width`, `height`, `fillRect`.
- `OptimizedBuffer` has many more methods (`setCell`, `drawText`, `clear`, etc.).
- The `as unknown as OptimizedBuffer` cast hides that the scoped buffer is partial.
- Current `diagonal-ripple.render()` only uses `fillRect` so this is safe today.
- Risk: Future custom plugins accessing other buffer methods will get runtime undefined-method errors with no TypeScript warning.
- Mitigation: Consider a narrower type alias (e.g. `PromptBarRenderBuffer { width, height, fillRect }`) in the plugin interface.

### No new bugs introduced by ripple implementation

- All biome warnings on changed files are pre-existing (non-null assertions at L236-238, L752 of index.tsx).
- No `as any` usage in any of the 6 inspected files.
- No TODO/FIXME/HACK markers in ripple code (the one TODO at L430 is pre-existing and unrelated).

## F4: Scope fidelity check (deep) (2026-03-07)

- Result: FAIL (diff includes files outside Task 4 plan scope).
- Task 4 plan scope (from plan commit files):
  - `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
  - `packages/opencode/src/cli/cmd/tui/component/prompt/color-effect.ts`
  - `packages/opencode/src/cli/cmd/tui/util/prompt-bar-layout-policy.ts`
  - `packages/opencode/test/cli/tui/prompt-layout-harness.test.ts`
- Out-of-scope changed files detected:
  - `.sisyphus/evidence/task-2-idle-a.txt`
  - `.sisyphus/evidence/task-2-idle-b.txt`
  - `.sisyphus/evidence/task-2-log.txt`
  - `packages/opencode/src/cli/cmd/tui/util/prompt-bar-animation-plugin.ts`
  - `packages/opencode/src/cli/cmd/tui/util/prompt-bar-animation-registry.ts`
  - `packages/opencode/src/config/tui-schema.ts`
  - `packages/opencode/test/cli/tui/prompt-bar-animation-registry.test.ts`
  - `packages/opencode/test/config/tui.test.ts`
- Recommendation:
  - Keep `.sisyphus/evidence/*` as local evidence artifacts (ignore for Task 4 commit/PR).
  - Exclude or stash Task 1-3 code/test files for a strict Task 4-only scope; do not include them in Task 4 commit/PR.

## F4: Scope fidelity check (deep) RETRY (2026-03-07)

- Verdict: FAIL
- Plan-defined Task 4 file scope:
  - `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
  - `packages/opencode/src/cli/cmd/tui/component/prompt/color-effect.ts`
  - `packages/opencode/src/cli/cmd/tui/util/prompt-bar-layout-policy.ts`
  - `packages/opencode/test/cli/tui/prompt-layout-harness.test.ts`
- Out-of-scope files in current `git diff --stat`:
  - `.sisyphus/evidence/task-2-idle-a.txt`
  - `.sisyphus/evidence/task-2-idle-b.txt`
  - `.sisyphus/evidence/task-2-log.txt`
  - `packages/opencode/src/cli/cmd/tui/util/prompt-bar-animation-plugin.ts`
  - `packages/opencode/src/cli/cmd/tui/util/prompt-bar-animation-registry.ts`
  - `packages/opencode/src/config/tui-schema.ts`
  - `packages/opencode/test/cli/tui/prompt-bar-animation-registry.test.ts`
  - `packages/opencode/test/config/tui.test.ts`
- Handling guidance:
  - `.sisyphus/evidence/*`: ignore for Task 4 commit scope.
  - Code/test files outside Task 4: stash or exclude from Task 4 commit/PR.

## F3: Runtime Manual QA — diagonal-ripple not rendering (2026-03-07)

- Command ran: `bash scripts/run-sandbox-tui.sh --theme lucent-orng --prompt-plugin diagonal-ripple --prompt-enabled true --use-real-auth idle`
- Status: FAIL — TUI launched, auth resolved, but no spatial ripple visible.
- Evidence: `.sisyphus/evidence/task-4-ripple-runtime.txt` + `task-2-idle-{a,b,c}.txt`
- ANSI analysis: only two background codes found in prompt bar: `48;2;10;10;10` (shell bg) and `48;2;30;30;30` (flat prompt bg). No per-column gradient.
- All three captures are byte-identical — no temporal animation variation detected.
- Possible causes:
  1. `renderBefore` hook not being invoked by OpenTUI render loop at runtime
  2. Plugin `render()` not being called (gating condition failing)
  3. Idle cycle index not advancing (no tick/interval driving the animation)
  4. tmux `capture-pane` capturing only the base layer, missing OpenTUI's buffered render output
- Not a blocker for plan completion (manual QA is verification-only), but indicates the spatial ripple render path needs runtime debugging.

## Runtime retry after local-coordinate fix (2026-03-07)

- Applied direct fix in `prompt/index.tsx`: `buffer.fillRect(x, y, w, h, color)` (removed `el.x/el.y` double offset).
- Regression tests + typecheck + build pass after the fix.
- Runtime evidence still fails with direct script invocation (no bash prefix):
- `./scripts/run-sandbox-tui.sh --theme lucent-orng --prompt-plugin diagonal-ripple --prompt-enabled true --use-real-auth idle`
  - Output remains: `Idle prompt bar background did not change between captures`.
- Captured prompt rows still show flat `48;2;30;30;30` and blue border color (default look), which suggests runtime may not be applying the generated `tui.json` theme/plugin despite file contents.

## Runtime verification resolved (2026-03-08)

- Runtime retry succeeded after fixing sandbox readiness capture: prompt bar lines include per-column gradient codes.
- Evidence: `.sisyphus/evidence/task-2-idle.txt` and `.sisyphus/evidence/task-4-ripple-runtime.txt` (PASS section).

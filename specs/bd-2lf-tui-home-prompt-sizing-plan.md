# bd-2lf - TUI Home Prompt Sizing + UX (Single PR)

## Status

| Scope                                            | Status    | Owner | Notes                                                            |
| ------------------------------------------------ | --------- | ----- | ---------------------------------------------------------------- |
| Epic A - Config contract + behavior              | completed | build | Add `tui.initial_prompt` schema, defaults, and resolution rules  |
| Epic B - Home screen layout sizing               | completed | build | Replace fixed width/height on opening screen                     |
| Epic C - UX quality improvements (same PR)       | completed | build | Better context visibility + clearer affordances on home composer |
| Epic D - Validation + docs + generated artifacts | completed | build | Tests, docs, SDK/OpenAPI regeneration                            |
| Epic E - Issue/PR packaging for `dev`            | planned   | build | Single PR with rationale, verification, and UX notes             |

Current branch/worktree for WT flow:

- Branch: `opencode-initial-prompt-sizing`
- Worktree: `../opencode-initial-prompt-sizing`
- Tracking issue: `bd-2lf`

## Problem Statement

The opening (home) prompt area in the TUI is too constrained for longer planning prompts.

Observed hard constraints in code:

- Home prompt container width is fixed to `maxWidth={75}` in `packages/opencode/src/cli/cmd/tui/routes/home.tsx`.
- Opening layout also uses fixed vertical spacing that contributes to the compact feel in `packages/opencode/src/cli/cmd/tui/routes/home.tsx`.
- Prompt textarea max height is fixed to `maxHeight={6}` in `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`.

This causes prompt authoring friction for large planning prompts where users need more visible context while typing.

## Goals

1. Make opening-screen prompt size configurable through user config.
2. Provide presets: `compact`, `medium`, `large`.
3. Keep `compact` behavior equal to current defaults.
4. Allow optional percent overrides for width and height.
5. Include UX improvements in the same PR (not a follow-up PR).
6. Keep scope focused: apply sizing behavior to home/opening screen first.

## Non-Goals (for this PR)

- Do not change session prompt dock sizing behavior in web app.
- Do not redesign the full TUI home page layout.
- Do not add interactive runtime settings UI (command palette toggles can be follow-up).

## Assumptions

1. `compact` must remain visually equivalent to current behavior.
2. Presets should work across small and large terminal sizes with clamped values.
3. Configuration should be stable (under `tui`), not experimental.
4. UX improvements should be low-risk and preserve established TUI visual language.
5. Single PR should include code, tests, docs, and generated SDK/OpenAPI updates.

## OpenCode Observed Standards (from this repo)

1. Config schema is centralized in `packages/opencode/src/config/config.ts`.
2. TUI settings currently live under `tui` (`scroll_speed`, `scroll_acceleration`, `diff_style`).
3. Public config changes require generated artifacts updates:
   - `packages/sdk/openapi.json`
   - `packages/sdk/js/src/v2/gen/*`
   - `packages/sdk/js/src/gen/*`
4. Docs include both config and tui guides:
   - `packages/web/src/content/docs/config.mdx`
   - `packages/web/src/content/docs/tui.mdx`
5. Config parsing/validation coverage is in `packages/opencode/test/config/config.test.ts`.

## Proposed Config Contract

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "tui": {
    "initial_prompt": {
      "size": "medium",
      "width_percent": 80,
      "height_percent": 25,
    },
  },
}
```

### Presets

- `compact` (current): width behaves like current `75` col cap, input max height behaves like current `6` rows.
- `medium`: width `80%` of terminal, input max height `25%` of terminal.
- `large`: width `90%` of terminal, input max height `35%` of terminal.

### Resolution + Clamping Rules

1. Start from preset defaults.
2. Apply `width_percent`/`height_percent` overrides when provided.
3. Clamp final values to safe bounds for small terminals.
4. Preserve readable minimums so UX remains usable in narrow terminals.

## Epic/Task Breakdown

### Epic A - Config Contract + Resolution Logic

Status: completed

Tasks:

- [x] A1. Add `tui.initial_prompt` schema in `packages/opencode/src/config/config.ts`.
- [x] A2. Add enum + numeric bounds + descriptions for all fields.
- [x] A3. Add small helper/resolver for preset + override + clamp logic (kept local to TUI route/component layer unless reused).
- [x] A4. Ensure defaults map exactly to current behavior for `compact`.

Acceptance criteria:

- Config accepts all valid shapes and rejects invalid enum/range values.
- `compact` produces same effective home prompt dimensions as today.

### Epic B - Opening Screen Sizing Implementation

Status: completed

Tasks:

- [x] B1. Update `packages/opencode/src/cli/cmd/tui/routes/home.tsx` to compute opening layout width from resolved size config.
- [x] B2. Replace fixed home `maxWidth={75}` usage with resolved width behavior.
- [x] B3. Update prompt component API (`packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`) to accept optional max input height override.
- [x] B4. Apply height override only when prompt is used on home route.

Acceptance criteria:

- Home prompt width/height responds to presets + overrides.
- Session route prompt behavior is unchanged by default.

### Epic C - UX Improvements in Same PR

Status: completed

Tasks:

- [x] C1. Improve home composer readability for long prompts (vertical breathing room and clearer visibility of active typing area).
- [x] C2. Ensure helper/tips/hint layout remains balanced at compact, medium, and large sizes.
- [x] C3. Add subtle textual cue in home context about active size preset when not compact (if space allows).

Acceptance criteria:

- Users can keep more planning context in view without breaking home layout hierarchy.
- UX remains clean and consistent with current TUI style.

### Epic D - Validation, Docs, and Generated Artifacts

Status: completed

Tasks:

- [x] D1. Add/adjust tests in `packages/opencode/test/config/config.test.ts` for schema validation and parsing.
- [x] D2. Regenerate SDK/OpenAPI via `./packages/sdk/js/script/build.ts`.
- [x] D3. Update docs:
  - `packages/web/src/content/docs/config.mdx`
  - `packages/web/src/content/docs/tui.mdx`
- [x] D4. Validate formatting/lint/test commands from package directories (not repo root).

Acceptance criteria:

- Tests cover new config shape and guardrails.
- Generated files include new config fields.
- Docs describe presets, overrides, defaults, and scope (home screen).

### Epic E - WT Flow E2E Delivery to `dev`

Status: in_progress

Tasks:

- [x] E1. Create dedicated worktree + branch.
- [x] E2. Create and set issue in progress (`bd-2lf`).
- [x] E3. Implement Epics A-D on this worktree.
- [x] E4. Run verification commands and capture outputs.
- [ ] E5. Prepare issue text + PR text aligned with repo template.

Acceptance criteria:

- Single focused PR against `dev` includes implementation, docs, tests, and generated artifacts.
- PR description explains why this improves planning UX and how behavior is preserved for compact users.

## Validation Plan

Run from package directories only:

1. Config tests (targeted):
   - `bun test test/config/config.test.ts` (from `packages/opencode`)
2. TUI package checks:
   - `bun run typecheck` (from `packages/opencode`)
   - `bun run test` (from `packages/opencode`) if change set is broader than config-only
3. SDK/OpenAPI regeneration:
   - `./packages/sdk/js/script/build.ts` (from repo root)
4. Docs build/lint check (if required by maintainers):
   - Run docs validation command used by repo maintainers for `packages/web`.

Manual UX validation:

- Open TUI on multiple terminal sizes.
- Verify `compact`, `medium`, `large` with and without percent overrides.
- Confirm home screen remains usable with tips shown/hidden.
- Confirm regular in-session prompt behavior remains unchanged.

## Definition of Done (Repo-Culture Aligned)

- [x] Behavior is configurable via stable `tui` config keys.
- [x] Compact mode preserves current behavior.
- [x] Medium/large materially improve long planning prompt authoring.
- [x] No regression in non-home prompt flows.
- [x] Tests pass for changed scope.
- [x] Generated SDK/OpenAPI files are updated and committed.
- [x] Docs updated with clear examples and precedence rules.
- [ ] PR targets `dev`, explains why and how, and includes verification notes.

## Risks and Mitigations

- Risk: small terminals produce unusable layout.
  - Mitigation: clamp width/height and preserve minimum readable values.
- Risk: accidental behavior changes in session prompt.
  - Mitigation: pass sizing overrides only from home route.
- Risk: docs and generated artifacts drift.
  - Mitigation: treat regeneration + docs updates as required gates.

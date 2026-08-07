# Tasks: role-placement-policy

Supersedes `role-model-chains` (renamed 2026-08-07). See the proposal for why the ordered
`models:` list was aimed at the wrong thing.

## Phase 1: Schema

- [ ] 1.1 Add optional `placement` to the agent config schema and `Agent.Info`
  - `"inherit" | "local" | string[]`; absent behaves as `inherit`
  - Validation: `bun run typecheck`
- [ ] 1.2 Parse it from markdown frontmatter alongside `model` and `permission`
  - Validation: a persona declaring `placement: local` loads with it set

## Phase 2: Resolution

- [ ] 2.1 Relax the non-local-parent guard in `LocalPlacement.pick` for a declared placement
  - The guard stays the default; a declared placement is the authorization it was missing
  - Validation: unit test — cloud parent + declared local → placement runs; cloud parent +
    no declaration → returns null, unchanged
- [ ] 2.2 Honour an ordered host list, then fall through to any eligible local host
  - Validation: unit tests for first-eligible, first-busy-second-wins, all-unusable
- [ ] 2.3 Keep the precedence: `model` → explicit `provider` arg → `placement` → placement → inherit
  - Validation: unit test for each rung
- [ ] 2.4 An unsatisfiable preference degrades, never fails
  - Unknown provider id, unreachable host, no free slot — all fall through
  - Validation: unit test that the subagent still runs

## Phase 3: The personas

- [ ] 3.1 `coder`, `tester`, `reviewer` declare `placement: local`
  - The three gate roles that do bulk work. For `reviewer` it also buys real model
    diversity: a second opinion from the parent's own model is barely a second opinion.
- [ ] 3.2 `researcher` and `persona-auditor` keep inheriting
  - They answer questions for a human; the parent's model is the right one
  - Validation: extend `test/agent/repo-personas.test.ts`

## Phase 4: Verification

- [ ] 4.1 `bun test test/loop/ test/agent/ test/tool/` and `bun run typecheck` clean
- [ ] 4.2 Live check: a cloud-model session fans out and the subagent lands on a local host
  - The whole point of the change; assert on the subagent's resolved provider, not a claim

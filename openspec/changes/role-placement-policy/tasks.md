# Tasks: role-placement-policy

Supersedes `role-model-chains` (renamed 2026-08-07). See the proposal for why the ordered
`models:` list was aimed at the wrong thing.

## Phase 1: Schema

- [x] 1.1 Add optional `placement` to the agent config schema and `Agent.Info`
  - `"inherit" | "local" | string[]`; absent behaves as `inherit`
  - Validation: `bun run typecheck`
- [x] 1.2 Parse it from markdown frontmatter alongside `model` and `permission`
  - Validation: a persona declaring `placement: local` loads with it set

## Phase 2: Resolution

- [x] 2.1 Relax the non-local-parent guard in `LocalPlacement.pick` for a declared placement
  - Extracted as `shouldAttemptPlacement` — a pure exported function, because the rule is
    the whole change and burying it inside a function that does real HTTP probes would have
    left it untestable.
  - The guard stays the default; a declared placement is the authorization it was missing
  - Validation: unit test — cloud parent + declared local → placement runs; cloud parent +
    no declaration → returns null, unchanged
- [x] 2.2 Honour an ordered host list, then fall through to any eligible local host
  - Validation: unit tests for first-eligible, first-busy-second-wins, all-unusable
- [x] 2.3 Keep the precedence: `model` → explicit `provider` arg → `placement` → placement → inherit
  - Validation: unit test for each rung
- [x] 2.4 An unsatisfiable preference degrades, never fails
  - Preferred hosts RANK candidates (`hostRankFor`), they do not filter them: an unreachable
    or busy named host scores 0 and every other candidate stays eligible.
  - Caught writing the tests: `placement: []` authorized placement from a cloud parent,
    because an empty array is neither `undefined` nor `"inherit"`. A typo would have
    silently downgraded a cloud session. An empty list now authorizes nothing.
  - Unknown provider id, unreachable host, no free slot — all fall through
  - Validation: unit test that the subagent still runs

## Phase 3: The personas

- [x] 3.1 `coder`, `tester`, `reviewer` declare `placement: local`
  - The three gate roles that do bulk work. For `reviewer` it also buys real model
    diversity: a second opinion from the parent's own model is barely a second opinion.
- [x] 3.2 `researcher` and `persona-auditor` keep inheriting
  - They answer questions for a human; the parent's model is the right one
  - Validation: extend `test/agent/repo-personas.test.ts`

## Phase 4: Verification

- [x] 4.1 `bun test test/loop/ test/agent/ test/local/ test/tool/` — 744 pass; typecheck clean
- [ ] 4.2 Live check: a cloud-model session fans out and the subagent lands on a local host
  - The whole point of the change; assert on the subagent's resolved provider, not a claim

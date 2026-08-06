# Tasks: role-model-chains

## Phase 1: Schema

- [ ] 1.1 Add optional `models: string[]` to the agent schema and markdown frontmatter parsing
  - Validation: `bun run typecheck`
- [ ] 1.2 Reject `model` and `models` declared together, at agent load
  - Validation: unit test asserting the error names the conflicting agent

## Phase 2: Resolution

- [ ] 2.1 Resolve a chain to the first reachable entry with capacity
  - Reuse the reachability/capacity signals placement already computes
  - Validation: unit tests for first-wins, first-unreachable-second-wins, all-unreachable
- [ ] 2.2 Insert chain resolution ahead of placement in `task.ts`
  - Order becomes: pinned `model` → chain → placement → inherited
  - Validation: `bun test test/tool/ --timeout 30000`
- [ ] 2.3 An exhausted chain falls through silently to placement, then inherit — never an error
  - Validation: test that an all-unreachable chain still produces a running subagent

## Phase 3: Reporting

- [ ] 3.1 Report the chosen chain entry, or exhaustion plus what was used instead
  - Validation: test asserting both messages appear in the invocation result

## Phase 4: Verification

- [ ] 4.1 `bun test` and `bun run typecheck` clean
- [ ] 4.2 Live check: `reviewer` chained to a different model than `coder` during `/auto`

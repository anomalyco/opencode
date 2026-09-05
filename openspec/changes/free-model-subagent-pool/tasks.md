# Tasks: free-model-subagent-pool

## Slice 1: Discovery

- [ ] 1.1 Locate the catalog/query `/models` already uses; investigate whether "free" is exposed
      as a tag, zero pricing, or must be inferred from provider metadata.
  - Validation: manual — list at least the free-tier providers reachable in this environment
- [ ] 1.2 Add a discovery function returning candidate free-tier providers/models from that
      catalog, with no hardcoded provider list.
  - File: TBD by 1.1 (existing model-catalog module preferred over a new one)
  - Validation: unit test with a mocked catalog response

## Slice 2: Liveness handshake

- [ ] 2.1 Implement the handshake: send a short deterministic prompt, require an exact-match
      response within a bounded timeout, on a per-candidate basis.
  - File: `packages/opencode/src/local/free-provider.ts` (new, or co-located per 1.1)
  - Validation: unit test — matching response passes, non-matching/timeout fails
- [ ] 2.2 Cache handshake results with a short TTL; re-probe on expiry, not on every placement
      decision.
  - Validation: unit test — a cached pass is reused within TTL; expired entries are re-probed

## Slice 3: Placement integration

- [ ] 3.1 Extend `LocalPlacement.pick` with a lower-priority free-tier pool, offered only when no
      local/peer candidate is eligible.
  - File: `packages/opencode/src/local/placement.ts`
  - Validation: unit test — a free-tier candidate is never selected while a local candidate is
    eligible
- [ ] 3.2 Hard-gate selection on a currently-passed handshake (within TTL); no fallback selection
      of an unverified or stale-probe candidate.
  - File: `packages/opencode/src/local/placement.ts`
  - Validation: unit test — an unverified candidate is never selected, even as last resort
- [ ] 3.3 Wire the pool into `task.ts` candidate resolution alongside existing local/peer sources.
  - File: `packages/opencode/src/tool/task.ts`
  - Validation: `bun run typecheck`

## Slice 4: Verification

- [ ] 4.1 `bun run typecheck` and `bun test test/local/ test/tool/` green.
  - Validation: `bun run typecheck && bun test test/local/ test/tool/`
- [ ] 4.2 Live check: with local fleet saturated (or simulated as such), a subagent placed on a
      free-tier candidate completes and its result reaches the parent via the
      `subagent-notification-reliability` wake-up path.

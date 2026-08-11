# Tasks: provider-slot-leases

Depends on `provider-capacity-truth` — pre-dispatch verification is only correct with a
trustworthy free-slot reading.

## Phase 1: Lease model

- [ ] 1.1 Define the lease type and store interface
  - `provider`, `slotIndex?`, `holderInstance`, `holderSession`, `acquiredAt`, `expiresAt`
  - Interface: `acquire`, `renew`, `release`, `list` — tier implementations swap behind it
  - Validation: `bun typecheck` — zero errors

- [ ] 1.2 TTL expiry semantics, including renewal
  - Validation: unit tests — expiry without holder action; renewal keeps the slot held

## Phase 2: Same-host tier (exact)

- [ ] 2.1 Lease table in the shared database with a uniqueness constraint on active lease per provider slot
  - Validation: schema migration applies cleanly against an existing database

- [ ] 2.2 Atomic acquisition
  - Validation: concurrency test — four concurrent acquirers for one slot, exactly one wins

- [ ] 2.3 Expired leases do not block acquisition
  - Validation: test — an expired row is superseded, not treated as held

## Phase 3: Cross-host tier (best effort)

- [ ] 3.1 Adapter interface for an external claim registry
  - Keep it swappable; do not hard-depend on skein
  - Validation: `bun typecheck`; adapter is injectable in tests

- [ ] 3.2 skein claim-registry adapter
  - Map provider slot leases onto the registry's host/pid/age model
  - Validation: integration test against a stub registry

- [ ] 3.3 Degrade cleanly when the registry is absent or slow
  - Bounded probe budget; never block placement on it
  - Validation: test — unreachable registry adds no failure and no unbounded delay

## Phase 4: Wire into placement

- [ ] 4.1 Replace the in-memory reservation with a lease acquisition
  - `local/placement.ts` — preserve existing scoring and the 20s recent-placement spread
  - Validation: `bun test test/local/placement.test.ts --timeout 30000` — existing tests pass

- [ ] 4.2 Add pre-dispatch capacity re-verification with fallback to inherit-parent
  - Validation: test — slot filled between lease and dispatch results in fallback, not a queued request

- [ ] 4.3 Confirm no regression for the standalone single-instance path
  - Validation: benchmark placement latency before/after; no added latency with no peers

## Phase 5: Observability

- [ ] 5.1 Expose active leases alongside capacity snapshots
  - Validation: `bun run test:httpapi` passes; leased-but-free slots are distinguishable

- [ ] 5.2 Surface leases in the fleet view from `fleet-instance-presence` if that has landed
  - Validation: manual — a leased slot shows holder and expiry

## Phase 6: Verification

- [ ] 6.1 Multi-process race on one host
  - Four instances, one free slot, simultaneous placement attempts
  - Validation: exactly one dispatch; three clean fallbacks; no request queues behind another

- [ ] 6.2 Full typecheck and test
  - Validation: `bun typecheck` zero errors; `bun test packages/opencode --timeout 60000` green

# Tasks: provider-capacity-truth

## Phase 1: Normalised snapshot type

- [x] 1.1 Define the `CapacitySnapshot` type
  - Fields: `provider`, `baseURL`, `slotsTotal`, `inFlight`, `freeSlots`, `busy`, `loadedModel`, `signal: "exact" | "inferred"`, `probedAt`, `stale`, `reachable`
  - Validation: `bun typecheck` in packages/opencode — zero errors

- [x] 1.2 Build snapshots from the existing probe path
  - Reuse `/api/hardware` probing in `local/mdns.ts` and `freeSlots()` at `local/placement.ts:66`
  - `signal` is `exact` when the host serves an `inference` block, else `inferred`
  - Validation: unit test with fixtures for exact, inferred, and unreachable hosts

- [x] 1.3 Assert the z4 case explicitly — it is the regression that motivates this change
  - Fixture: `gpu_util_pct: 85` with `inference: {busy: false, in_flight: 0, slots_total: 1}`
  - Assert: one free slot, `busy: false`, `signal: "exact"`
  - Validation: test fails if GPU utilisation is ever allowed to override queue depth

- [x] 1.4 Multi-slot and staleness tests
  - `slots_total: 4, in_flight: 1` → three free slots
  - Probe older than the freshness bound → `stale: true`, age preserved
  - Unreachable host → `reachable: false`, not `inFlight: 0`
  - Validation: `bun test test/local/ --timeout 30000` — all pass

## Phase 2: Expose it

- [x] 2.1 Add a capacity endpoint to the instance HTTP API
  - Follow the existing group/handler pattern under `server/routes/instance/httpapi/`
  - Returns snapshots for all known providers
  - Validation: `bun run test:httpapi` passes; endpoint appears in the generated API surface

- [x] 2.2 Confirm no placement behaviour changed
  - The same inputs must yield the same provider choice as before this change
  - Validation: `bun test test/local/placement.test.ts --timeout 30000` — all pass unmodified

## Phase 3: Verification

- [ ] 3.1 Live fleet check against the real hosts
  - Probe m3, m5, proxmox, rocky, z4; compare each snapshot against that host's raw `/api/hardware`
  - Assert z4 reports free while its GPU utilisation is high
  - Validation: recorded output shows exact/inferred labelling per host and no idle host reported busy

- [ ] 3.2 Full typecheck and test
  - Validation: `bun typecheck` zero errors; `bun test packages/opencode --timeout 60000` green

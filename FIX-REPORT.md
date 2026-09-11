# SQLite Message Diff Event Compaction

## Chosen approach

Chosen: candidate 1, with two safeguards. The first `message.updated.1` event that introduces a user message's diff array remains full. Later updates to that message omit `info.summary.diffs` only when the current message projection already has an array at `$.summary.diffs`. The session projector restores that prior array before replacing the projected message data.

This is the smallest compatible change. It leaves the first durable event as the replay source for the patch, makes the repeated events compact, and keeps the message projection used by the diff endpoint, exports, share sync, and clients populated.

The V1 `User` wire contract still requires `summary.diffs` when a summary exists. Only the `message.updated` event's internal user variant accepts an omitted `diffs` key. Existing event rows with the key decode unchanged; new compact rows decode with it absent. `message.updated.1` remains version 1, so no event migration or protocol generation is required.

### Rejected candidates

1. **Strip every MessageUpdated payload.** Rejected because the first event is the durable source for the per-message diff. Stripping it would make a fresh replay and `SessionSummary.diff()` lose the patch.
2. **Skip summarize when the computed diff is equal.** Rejected because it only prevents another summary calculation. Subsequent unrelated `updateMessage` calls still re-emit the existing large array.
3. **Keep only stats on the message and load patches from `session_diff`.** Rejected because current consumers read per-message `summary.diffs`; `session_diff` is session-scoped legacy/revert storage and `Session.Event.Diff` is live-only. This would require a new per-message durable lookup plus changes to exports, share, and clients.
4. **Strip at generic EventV2 encoding.** Rejected because it changes a cross-domain storage boundary and would make replay comparison diverge for old event rows that retain `diffs`.

## Files changed

- `packages/schema/src/v1/session.ts`: adds a private MessageUpdated user schema variant with optional diffs, while retaining the existing public V1 User shape.
- `packages/opencode/src/session/session.ts`: detects an already-projected user diff array and omits it from later MessageUpdated events.
- `packages/core/src/session/projector.ts`: restores the existing diff array for compact events before writing the message projection.
- `packages/opencode/test/server/session-diff-missing-patch.test.ts`: real database regression coverage for event size reduction and diff endpoint preservation.
- `FIX-REPORT.md`: this report.

## Backward compatibility and replay

Old `message.updated.1` rows retain `info.summary.diffs`; the relaxed event decoder accepts them and the projector writes them normally. New compact events occur only after a full diff-bearing event has projected the message. During a fresh event replay, that full event establishes the projection and the later compact event restores its stored diff. A compact event replayed without a preceding projection falls back to an empty array rather than failing decoding, but this is not a valid complete session history.

No migration was added. Existing data is read as-is. The current V1 message contract, server HttpApi, and generated client surface were not changed, so `bun run generate` was not applicable.

## Failing-before evidence

Implementation files were stashed with `git stash push -- packages/schema/src/v1/session.ts packages/opencode/src/session/session.ts packages/core/src/session/projector.ts`, leaving the new regression test in place, then restored with `git stash pop`.

```text
bun test v1.4.0 (34cbb9a40)

test/server/session-diff-missing-patch.test.ts:
140 |           .all()
141 |           .pipe(Effect.orDie)
142 |
143 |         expect(events).toHaveLength(2)
144 |         expect(events[0]?.bytes).toBeGreaterThan(diff.patch.length)
145 |         expect(events[1]?.bytes).toBeLessThan(1_000)
      ^
error: expect(received).toBeLessThan(expected)

Expected: < 1000
Received: 262515

      at toBeLessThan (unknown:1:1)
      at /home/viprix/opencode-core/packages/opencode/test/server/session-diff-missing-patch.test.ts:145:34
      at ~effect/Effect/successCont (/home/viprix/opencode-core/node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/effect.js:870:26)
      at runLoop (/home/viprix/opencode-core/node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/effect.js:444:98)
      at evaluate (/home/viprix/opencode-core/node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/effect.js:412:23)
      at /home/viprix/opencode-core/node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/effect.js:723:15
      at /home/viprix/opencode-core/node_modules/.bun/@effect+platform-node-shared@4.0.0-beta.83+43902b222b0d7d3e/node_modules/@effect/platform-node-shared/dist/NodeFileSystem.js:269:9
      at guarded (internal:shared:112:26)
      at processTicksAndRejections (native:7:39)
[17:31:28.217] ERROR (#59045): 140 |           .all()
141 |           .pipe(Effect.orDie)
142 |
143 |         expect(events).toHaveLength(2)
144 |         expect(events[0]?.bytes).toBeGreaterThan(diff.patch.length)
145 |         expect(events[1]?.bytes).toBeLessThan(1_000)
      ^
error: expect(received).toBeLessThan(expected)

Expected: < 1000
Received: 262515

      at toBeLessThan (unknown:1:1)
      at /home/viprix/opencode-core/packages/opencode/test/server/session-diff-missing-patch.test.ts:145:34

(fail) session diff with missing patch (#26574) > keeps stored turn diffs while compacting later message update events [1424.89ms]

 2 pass
 1 fail
 7 expect() calls
Ran 3 tests across 1 file. [10.93s]
```

## Passing-after evidence

```text
bun test v1.4.0 (34cbb9a40)

 3 pass
 0 fail
 9 expect() calls
Ran 3 tests across 1 file. [10.79s]
```

## Measured reduction

The regression test uses a real SQLite event table and a 262,144-byte patch. On unmodified `dev`, the second `message.updated.1` row was **262,515 bytes**. With this change it was **284 bytes**, measured from SQLite `length(event.data)`. That is a reduction of **262,231 bytes (99.89%)** for each later update of that summarized message.

The first diff-bearing event remains 262,493 bytes in this fixture. This is intentional: it establishes the durable replay and projection source. The defect is the repeated full rows, not the one required diff write.

## Verification

- `bun test test/server/session-diff-missing-patch.test.ts` from `packages/opencode`: passed, 3 tests.
- `bun typecheck` from `packages/schema`: passed.
- `bun typecheck` from `packages/core`: passed.
- `bun typecheck` from `packages/opencode`: passed.
- LSP diagnostics were clean for the Core projector and the regression test. The OpenCode service had no errors and three pre-existing unused-import hints. Fresh diagnostics for the large Schema file timed out after 3 seconds; its package typecheck was clean.

## Residual risk and limits

- The MessageTable projection still stores the full patch once and rewrites that JSON when another message field changes. This fix removes the dominant append-only EventTable duplication, measured as 98% of event bytes in the production analysis, but does not redesign message projection storage.
- The projector reads the existing projected message only for a compact user update. This is an additional read, but it avoids the multi-hundred-KB append-only event write and remains inside the existing transaction/replay ordering.
- This change was verified with a focused real SQLite integration test. The full package test suites were not run.

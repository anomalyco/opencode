---
council: council-cross-machine-forking-review-357e48b939d036e8
question: Dispatch the full council with delegation to review this work, including the replay() path.
date: 2026-04-07
members: [Claude, GPT, Gemini]
session_ids: [bg_5bdb88f6, bg_92ea9896, bg_55615bb5]
cross_check_ids: [bg_815bf2eb, bg_0f73532d, bg_5cb814ab]
mode: Delegation
intent: AUDIT
responded: 3/3
---

# Council Audit: Cross-Machine Safe Conversation Forking

## Cross-Check Results

5 solo findings were cross-checked by all 3 council members. Here's how confidence changed:

| #   | Finding                     | Original      | Cross-Check Votes                                       | Updated Confidence                      |
| --- | --------------------------- | ------------- | ------------------------------------------------------- | --------------------------------------- |
| 2   | Child session shard routing | Solo (GPT)    | Claude: AGREE, GPT: DISAGREE\*, Gemini: AGREE           | **Majority (2/3)** — promoted           |
| 3   | replayBus() partial update  | Solo (Claude) | Claude: DISAGREE\*\*, GPT: DISAGREE, Gemini: AGREE      | **Minority (1/3)** — demoted            |
| 4   | Shard refresh race          | Solo (Claude) | Claude: AGREE (lower sev), GPT: DISAGREE, Gemini: AGREE | **Majority (2/3)** — promoted           |
| 5   | Hostname brittleness        | Solo (Claude) | Claude: AGREE (lower sev), GPT: AGREE, Gemini: AGREE    | **Unanimous (3/3)** — promoted          |
| 7   | Test spy coverage gap       | Solo (Claude) | Claude: DISAGREE, GPT: AGREE, Gemini: AGREE             | **Majority (2/3)** — unchanged severity |

\* GPT couldn't access the sibling repo source, only saw the vendored dist.
\*\* Claude found that `convertEvent` in `server/projectors.ts` enriches the bus event to a full row before it reaches the plugin, invalidating the partial-data premise.

---

## Findings (Updated After Cross-Check)

---

#### #1: replay() column/value count mismatch — active production bug

- **Severity**: Critical
- **Confidence**: Unanimous (3 members, original round)
- **Members Reported**: [Claude, GPT, Gemini]
- **Issue**: The `INSERT INTO event` in `replay()` specifies 6 columns but supplies 7 values. The last `${data.raw}` is duplicated.
- **Evidence**: `opencode-postgres-sync/src/projectors.ts:564-572` — 6 columns, 7 value expressions.
- **Impact**: `replay()` is called from `consumer.js` and `backfill.js`. Every event replay would fail with a Postgres syntax error. The main plugin path uses `replayBus()` and is unaffected.
- **Fix Direction**: Remove the duplicate `${data.raw}` line.

---

#### #2: Pulled child sessions route to the wrong local database

- **Severity**: High
- **Confidence**: Majority (2/3) — promoted from Solo after cross-check
- **Members Reported**: [GPT (original), Claude (cross-check), Gemini (cross-check)]
- **Issue**: `pullSession()` writes an entire session tree into the root shard (`${root}.db`), but `Database.sessionRoot(childID)` only checks if `${childID}.db` exists — it never walks parent links. Child session data is invisible from core reads after cross-machine pull.
- **Evidence**: `pullSession()` → `path.join(sessionDir(), ${root}.db)`. `sessionRoot()` → `if (!hasSession(id)) return; return id;`. No parent-chain resolution.
- **Impact**: Cross-machine pulled child/fork sessions can't be read or written correctly.
- **Fix Direction**: Either teach `sessionRoot()` to walk the parent chain, or have `pullSession()` write child data into the global DB instead of the root shard.

**Cross-check note**: GPT disagreed during cross-check because it couldn't access the sibling repo source. Claude and Gemini independently verified the routing gap from the vendored dist.

---

#### #3: ~~replayBus() passes partial updates to replaySession()~~ — FALSE POSITIVE

- **Severity**: ~~High~~ → Dismissed
- **Confidence**: Minority (1/3) — demoted from Solo after cross-check
- **Members Reported**: [Claude (original), Gemini (cross-check AGREE)]
- **Cross-Check Result**: Claude (the original reporter) **reversed their own finding** after deeper investigation. The `convertEvent` hook in `server/projectors.ts` reads back the FULL session row from SQLite after the local projector applies the partial update, then enriches the bus event with complete data. `replayBus()` therefore receives full session info, not partial data. GPT also disagreed.
- **Dismissed because**: The original reporter withdrew the finding with high-confidence evidence.

---

#### #4: Shard refresh DELETE+re-INSERT race window

- **Severity**: Medium → Low-Medium
- **Confidence**: Majority (2/3) — promoted from Solo after cross-check
- **Members Reported**: [Claude (original + cross-check), Gemini (cross-check)]
- **Issue**: `pullSession()` DELETEs all shard rows then re-INSERTs from remote. The race window exists but is narrow.
- **Evidence**: `local.ts` shard transaction: `DELETE FROM message` → re-INSERT. SQLite transaction holds exclusive write lock; `pullSession` only runs from `session.ensure.before`.
- **Impact**: If two sessions in the same shard tree are active simultaneously, one's recent writes could be overwritten.
- **Fix Direction**: Use `INSERT OR REPLACE` row-by-row instead of bulk DELETE, or document that `pullSession` is designed for pre-operation hydration only.

**Cross-check note**: Claude downgraded severity (mitigating factors: SQLite write lock, hook timing). GPT couldn't verify without sibling source. Gemini agreed with original severity.

---

#### #5: Hostname-based foreign detection is brittle in containers

- **Severity**: Medium → Low-Medium
- **Confidence**: Unanimous (3/3) — promoted from Solo after cross-check
- **Members Reported**: [Claude (original + cross-check), GPT (cross-check), Gemini (cross-check)]
- **Issue**: `foreign()` uses `os.hostname()` which can change in containers/devboxes. No persistent machine ID exists.
- **Evidence**: `revert.ts:19-22`, `session/index.ts:402`. No `machine-id` file in the data directory.
- **Impact**: After hostname change, all existing sessions lose file-revert (conversation still works). Safe but surprising.
- **Fix Direction**: Store a persistent UUID in `~/.local/share/opencode/machine-id` on first run.

**Cross-check note**: All three members agreed. Claude and GPT downgraded to Low because the failure mode is graceful degradation on developer workstations.

---

#### #6: Silent error swallowing in runtime backfill

- **Severity**: Low
- **Confidence**: Solo (1 member, not cross-checked)
- **Members Reported**: [Claude]
- **Issue**: Empty `catch {}` around the backfill SQL.
- **Fix Direction**: Add `log.warn` in the catch block.

---

#### #7: Test coverage gap — no spy verification for conversation-only mode

- **Severity**: Low → Dismissed
- **Confidence**: Split (2 AGREE, 1 DISAGREE with strong evidence)
- **Members Reported**: [Claude (original), GPT (cross-check AGREE), Gemini (cross-check AGREE)]
- **Cross-Check Result**: Claude (original reporter) **reversed their own finding** during cross-check, arguing that outcome-based testing is sufficient: if `snap.track()` had been called, `rev.snapshot` would have a value, so `expect(body.revert?.snapshot).toBeUndefined()` is adequate proof.
- **Dismissed because**: The original reporter provided a convincing code-trace argument that the outcome assertion is equivalent to a spy assertion in this case. GPT and Gemini agreed the test could be stronger but acknowledged the point.

---

## Summary Table (Final)

| #   | Finding                        | Severity   | Final Confidence | Status             |
| --- | ------------------------------ | ---------- | ---------------- | ------------------ |
| 1   | replay() SQL mismatch          | Critical   | Unanimous        | **Active**         |
| 2   | Child session shard routing    | High       | Majority (2/3)   | **Active**         |
| 3   | replayBus() partial update     | ~~High~~   | Dismissed        | **False positive** |
| 4   | Shard refresh race window      | Low-Medium | Majority (2/3)   | **Active**         |
| 5   | Hostname detection brittleness | Low-Medium | Unanimous (3/3)  | **Active**         |
| 6   | Silent backfill error catch    | Low        | Solo             | **Active**         |
| 7   | Test spy coverage gap          | ~~Low~~    | Dismissed        | **False positive** |

## Priority Recommendations

**Fix now (before shipping):**

- **#1** — replay() SQL mismatch. Unanimous critical. One-line fix.

**Fix before upstream PR:**

- **#2** — Child session shard routing. Majority-confirmed High. Core routing needs parent-chain resolution.

**Track / document / follow-up:**

- **#4** — Shard refresh race. Narrow window, mitigated by hook timing. Document the constraint.
- **#5** — Hostname brittleness. Unanimous agreement but low real-world impact. Persistent machine-id is a good follow-up.
- **#6** — Silent catch. Trivial log.warn addition.

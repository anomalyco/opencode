# fix(session): anchor the compaction summary to the marker message

## Summary

`SessionCompaction` creates the compaction summary with `parentID: lastUser.id`. It should use the **marker** message — the user message that carries the `compaction` part and that the summary is answering. When a prompt arrives inside the marker→summary window, `lastUser` is that new prompt instead of the marker, and two things break at once:

1. The summary is **orphaned** — its parent is not the marker, so `completedCompactions()` cannot see it and compaction can fire again.
2. The **model pin is discarded** — the summary is generated with the new prompt's model rather than the model the caller requested for compaction.

Both symptoms come from the same line. This fixes the parent and removes the race.

## The bug

`packages/opencode/src/session/prompt.ts`

```diff
- parentID: lastUser.id,
+ parentID: task.messageID,   // the marker, not whatever prompt arrived last
```

`task.messageID` is the message that owns the `compaction` part — the one the summarizer is answering. `lastUser` is resolved from the message list and is only *usually* the same thing.

### Why the window exists

Compaction is a two-step handshake:

```
T0  marker created (user message + `compaction` part)
T1  summarizer runs          ← a prompt arriving here is the race
T2  summary written with parentID = ?
```

At `T2` the code asked "who is the last user message?" rather than "which message am I answering?". If the user typed anything during `T1`, those differ.

## Evidence — reproduced from production

Four compactions of the same session on `1.18.32`, read from `opencode.db`:

| time (UTC) | `auto` | marker model | summary anchored to marker? |
|---|---|---|---|
| 2026-09-24 11:48:56 | true | `zai-coding-plan/glm-5.3-flash` | yes |
| 2026-09-24 11:56:57 | true | `zai-coding-plan/glm-5.3-flash` | yes |
| **2026-09-24 12:06:11** | true | — | **NO — no summary has `parentID` = marker** |
| **2026-09-25 11:39:22** | false | `opencode-go/deepseek-v4.1-flash` | **yes** (post-patch) |

The 09-24 12:06 row is the bug: the summary was written, but not as a child of its marker, so it was invisible to the completion check.

A rule-level replay against the real database confirms it: with the upstream rule, the recorded parent matched `lastUser` in **9/9** cases; with the marker rule, the selected parent was the marker in **9/9**.

## The fix

The commit touches one line in `prompt.ts` and the logic around it in `compaction.ts`:

- **Pass the marker id** (`task.messageID`) as the summary's `parentID`.
- **Hard-reject a spent marker** — one that already carries a completed summary is not re-processed. This is what makes the loop impossible rather than merely unlikely.
- **Cut history at the marker index**, so a prompt that arrived after the marker stays live instead of being summarized and replayed.
- **Split the resume user id from the marker identity.**
- **Suppress the synthetic autocontinue** while a real prompt is waiting. Without this the resumed turn could swallow the prompt that caused the race.
- **Drop the forced tail** — a missing `tail_start_id` is a valid full compaction, not a signal to force one.
- **Label the model source in logs** (`configured-compaction-agent` vs `request-marker`), so a working pin is distinguishable from a dead one.

A forced-tail fallback that appeared in an earlier revision was **removed** — review established its premise was false: `message-v2.ts:534` (`if (!part.tail_start_id) break`) already treats a marker without `tail_start_id` as a valid full compaction, so the fallback was both unnecessary and wrong.

## The gap that let it run for 37 hours

Worth fixing separately, and the reason this went unnoticed so long: **there is no circuit breaker on repeated compaction.** The orphaned summary is invisible to the completion check, so the marker looks unprocessed forever and compaction re-fires indefinitely. One observed instance ran for **37 hours**.

A summary that is written but not counted as completing its marker is a contradiction. Either the write should fail loudly, or the completion check should be anchored the same way the write is. A guard that counts *attempts per marker* and refuses after N would make this class of bug self-limiting regardless of cause.

## Tests

`packages/opencode/test/session/compaction.test.ts`, +156 lines. **59 pass / 1 skip / 0 fail**; typecheck clean across 30 packages. Three of the four new guards were confirmed red-green (they fail against the unfixed code).

The tests deliberately cover the race, not just the happy path: a marker with a follow-up prompt already present, a marker whose summary already exists, and a marker with no `tail_start_id`.

## Risk

Low, and the reasoning is that the change makes the parent *more* specific, never less:

- In the common case — no prompt during the window — `lastUser` **is** the marker, so behaviour is unchanged. The 2026-09-25 11:39 row above is exactly this case, and it is the reason the model choice there is unaffected by this patch.
- In the race case the patch changes behaviour, and that is the point: the summary becomes a child of the marker it answers.

The model-resolution expression itself is **byte-identical to upstream** — only the local variable name and a log label changed. This patch does not alter which model a given compaction uses; it alters which *message's* model is consulted, and only when they differ.

## Reproduction

```
1. Start a session, let context approach the compaction threshold.
2. Trigger compaction.
3. Send any message while the summarizer is running.
4. Inspect: the summary's parentID will be the new prompt, not the marker.
   `completedCompactions()` will not count it, and compaction can re-fire.
```

Against the patched build the same sequence anchors to the marker and terminates.

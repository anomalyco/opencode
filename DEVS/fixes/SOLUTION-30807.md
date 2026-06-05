# Solution: Prune clears read results causing instruction re-attachment; prune early-exit skips older prunable tools (#30807)

## Issue
- URL: https://github.com/anomalyco/opencode/issues/30807
- Created: 2026-06-04
- Status: Fixed by PR #30979
- Labels: None
- Complexity: small (two single-condition fixes, no architecture change)

## Root cause

The issue bundles two unrelated bugs in the prune / instruction-attach pipeline. Both are confirmed against `dev` HEAD (commit `50b4ad89b`).

### Bug 1 — `extract()` skips read parts whose `loaded` paths are still valid

`packages/opencode/src/session/instruction.ts:15-30`:

```ts
function extract(messages: SessionLegacy.WithParts[]) {
  const paths = new Set<string>()
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool === "read" && part.state.status === "completed") {
        if (part.state.time.compacted) continue                       // ← LINE 20
        const loaded = part.state.metadata?.loaded
        if (!loaded || !Array.isArray(loaded)) continue
        for (const p of loaded) {
          if (typeof p === "string") paths.add(p)
        }
      }
    }
  }
  return paths
}
```

`extract()` is the source-of-truth for "which instruction file paths has the AI already loaded?". It scans every read tool part and pulls `state.metadata.loaded` — the list of nearby `AGENTS.md` / `CLAUDE.md` / `CONTEXT.md` paths that were inlined as `<system-reminder>` content when the read happened (set in `read.ts:329`).

The skip on `part.state.time.compacted` is wrong for read parts. The `loaded` field is **metadata**, not tool output, and `prune()` does not clear it. `prune()` only sets `state.time.compacted = Date.now()` (`compaction.ts:336`) and persists the part. The `loaded` array, the `preview`, the `title`, the `input`, the `output` — all preserved. The skip therefore hides a fully valid "already loaded" record from `extract()`.

The downstream effect lives in `resolve()` (`instruction.ts:177-219`). The relevant line is `instruction.ts:194`:

```ts
if (!found || found === target || sys.has(found) || already.has(found)) {
  current = path.dirname(current)
  continue
}
```

When `already.has(found)` is false (because `extract()` returned the wrong set), the found instruction file is re-attached:

```ts
set.add(found)
const content = yield* read(found)
if (content) {
  results.push({ filepath: found, content: `Instructions from: ${found}\n${content}` })
}
```

`results` is then inlined into the read tool's output as another `<system-reminder>` block (`read.ts:319-321`). The AI receives the same `AGENTS.md` content a second time, wasting context window and (because the second copy is now also in conversation history) re-attaching it yet again on subsequent reads — a slow feedback loop.

**Reproduction (concrete):**
1. Open a project where `AGENTS.md` lives at the project root.
2. Read any file in the project — `read.ts:264` calls `instruction.resolve(...)` which walks up the dir tree, finds `AGENTS.md` (not in `sys`), checks `already` (empty), attaches it. The read part is persisted with `metadata.loaded = ["/path/to/AGENTS.md"]` and `time.compacted = undefined`.
3. After enough turns, `prune()` runs (`prompt.ts:1497` forks it after every loop). The part's `time.compacted` is now set, but `metadata.loaded` is unchanged.
4. Read another file. `resolve()` calls `extract()`. The earlier read part is skipped due to `time.compacted`. `already` no longer contains `/path/to/AGENTS.md`. The walk re-finds it, re-attaches the content, and the AI now has two copies of `AGENTS.md` in context.

### Bug 2 — `prune()` `break loop` exits the entire message scan

`packages/opencode/src/session/compaction.ts:298-342`:

```ts
const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
  const cfg = yield* config.get()
  if (!cfg.compaction?.prune) return
  log.info("pruning")

  const msgs = yield* session
    .messages({ sessionID: input.sessionID })
    .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
  if (!msgs) return

  let total = 0
  let pruned = 0
  const toPrune: SessionLegacy.ToolPart[] = []
  let turns = 0

  loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {   // ← OUTER (labeled "loop")
    const msg = msgs[msgIndex]
    if (msg.info.role === "user") turns++
    if (turns < 2) continue
    if (msg.info.role === "assistant" && msg.info.summary) break loop
    for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {  // ← INNER
      const part = msg.parts[partIndex]
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
      if (part.state.time.compacted) break loop                              // ← LINE 323
      const estimate = Token.estimate(part.state.output)
      total += estimate
      if (total <= PRUNE_PROTECT) continue
      pruned += estimate
      toPrune.push(part)
    }
  }
  ...
})
```

The outer message loop is labeled `loop:`. `break loop` on line 323 exits the **outer** loop, not the inner part loop. The intent appears to be "stop when we hit a part that's already been pruned" (a fast-path shortcut), but prune doesn't run in message-order or part-order — it runs oldest-to-newest until `total > PRUNE_PROTECT`, so an already-pruned part can sit next to (and across) unpruned ones.

Concrete failure mode: after the first `prune()` cleared some old tool outputs in a long session, a second `prune()` runs. The new outer-loop iteration starts from the newest message. Within the first message that contains both pruned and unpruned parts, hitting a pruned part at line 323 fires `break loop` and the entire remaining scan — every older message, every older prunable tool — is silently skipped. The session's context keeps growing because subsequent prunes become near no-ops.

## Fix

Both changes are one line each, with no schema or behavior change outside the affected functions. Total: two `Edit` calls, two new tests.

### Fix 1 — `instruction.ts:20` — drop the incorrect `continue`

**File:** `packages/opencode/src/session/instruction.ts:15-30`

```diff
 function extract(messages: SessionLegacy.WithParts[]) {
   const paths = new Set<string>()
   for (const msg of messages) {
     for (const part of msg.parts) {
       if (part.type === "tool" && part.tool === "read" && part.state.status === "completed") {
-        if (part.state.time.compacted) continue
+        // Read parts are not pruned in their metadata; `state.metadata.loaded` survives
+        // compaction and is still a valid "already loaded" record. Skipping on
+        // `time.compacted` would cause AGENTS.md / CLAUDE.md / CONTEXT.md to be
+        // re-attached on every subsequent read after prune, wasting context.
         const loaded = part.state.metadata?.loaded
         if (!loaded || !Array.isArray(loaded)) continue
         for (const p of loaded) {
           if (typeof p === "string") paths.add(p)
         }
       }
     }
   }
   return paths
 }
```

(Per the project's `STYLE.md` "default to writing no comments" — the comment is justified here because the *reason* the line is missing is non-obvious; without it, a future maintainer will likely re-add the skip on the theory that "pruned parts shouldn't be re-considered".)

**Why the fix works:**
- `loaded` is a metadata array (`message-v2.ts` ToolPart metadata) and prune never clears it. Verified by reading `compaction.ts:333-341` — only `state.time.compacted` is set, then `session.updatePart(part)` is called.
- `extract()` is the only consumer of this skip; removing it makes every other read part contribute to the `already` set, exactly as before prune.
- The downstream `resolve()` already has the right structure — `already.has(found)` was just receiving a false negative.

### Fix 2 — `compaction.ts:323` — `break loop` → `continue`

**File:** `packages/opencode/src/session/compaction.ts:318-329`

```diff
       for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
         const part = msg.parts[partIndex]
         if (part.type !== "tool") continue
         if (part.state.status !== "completed") continue
         if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
-        if (part.state.time.compacted) break loop
+        if (part.state.time.compacted) continue
         const estimate = Token.estimate(part.state.output)
         total += estimate
         if (total <= PRUNE_PROTECT) continue
         pruned += estimate
         toPrune.push(part)
       }
```

**Why the fix works:**
- `continue` (unlabeled) jumps to the next iteration of the **inner** part loop. The inner loop walks from newest to oldest part in the current message, so the next iteration considers an older part in the same message — which is the correct scan order.
- `total` is only incremented for un-pruned parts, so the `PRUNE_PROTECT` budget is not double-counted.
- The outer message loop is no longer short-circuited; older messages with prunable tools are still considered.
- The final `if (pruned > PRUNE_MINIMUM)` guard at `compaction.ts:333` is unchanged and still prevents committing a no-op prune.

**Risk:** Low. The only behavior change is that prune now considers a strictly larger set of candidates; the existing `total`/`pruned` accounting and the `PRUNE_MINIMUM` threshold still bound the actual write. No DB schema or wire-format change.

## Test case

### Test 1 — Bug 1 regression: pruned read parts still contribute `loaded` paths to `extract()`

Add to `packages/opencode/test/session/instruction.test.ts` (the file already has the right imports and a `loaded()` helper that builds a `WithParts[]` from a filepath):

```ts
it.live(
  "treats read parts as already-loaded even after their output is pruned (time.compacted set)",
  withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
    Effect.gen(function* () {
      const svc = yield* Instruction.Service
      const agents = path.join(dir, "subdir", "AGENTS.md")
      const filepath = path.join(dir, "subdir", "nested", "file.ts")

      // Build a read part whose output has been pruned, but whose
      // metadata.loaded still references the AGENTS.md that was attached.
      const sessionID = SessionID.make("session-pruned-1")
      const messageID = MessageID.make("msg_message-pruned-1")
      const messages: SessionLegacy.WithParts[] = [
        {
          info: {
            id: messageID,
            sessionID,
            role: "user",
            time: { created: 0 },
            agent: "build",
            model: {
              providerID: ProviderV2.ID.make("anthropic"),
              modelID: ProviderV2.ModelID.make("claude-sonnet-4-20250514"),
            },
          },
          parts: [
            {
              id: PartID.make("prt_part-pruned-1"),
              messageID,
              sessionID,
              type: "tool",
              callID: "call-pruned-1",
              tool: "read",
              state: {
                status: "completed",
                input: {},
                output: "<pruned>",
                title: "Read",
                metadata: { loaded: [agents] },
                time: { start: 0, end: 1, compacted: 12345 },
              },
            },
          ],
        },
      ]

      const results = yield* svc.resolve(messages, filepath, MessageID.make("msg_message-pruned-2"))
      expect(results).toEqual([])
    }),
  ),
)
```

This test fails before the fix (because `extract()` skips the pruned read part and `resolve()` re-attaches `AGENTS.md`) and passes after.

### Test 2 — Bug 2 regression: prune continues past already-pruned parts and clears older prunable tools

Add to `packages/opencode/test/session/compaction.test.ts` (the file already has a `session.compaction.prune` describe block at line 628 with the right config fixture and pattern):

```ts
it.live(
  "continues past an already-pruned part and prunes older prunable tools",
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})

        // Layout (oldest → newest):
        //   u1, a1[UNPRUNED bash, very old]   ← this one MUST get pruned
        //   u2, a2[ALREADY-PRUNED bash]       ← the "trap"
        //   u3                                ← pushes a2 into scan zone
        //   u4                                ← newest user turn (triggers prune)
        //
        // The scan walks newest → oldest. u4 and u3 are the "skip 2" zone
        // (turns < 2). a2 is the first non-user message in the scan zone.
        // Before the fix, hitting a2's pruned bash fired `break loop` and
        // the scan never reached a1, leaving the oldest bash un-pruned.
        // After the fix, `continue` skips a2 and the scan reaches a1.

        // turn 1
        const u1 = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: u1.id,
          sessionID: info.id,
          type: "text",
          text: "first",
        })
        const a1: SessionV1.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: info.id,
          mode: "build",
          agent: "build",
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ref.modelID,
          providerID: ref.providerID,
          parentID: u1.id,
          time: { created: Date.now() },
          finish: "end_turn",
        }
        yield* ssn.updateMessage(a1)
        const a1Bash = yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: a1.id,
          sessionID: info.id,
          type: "tool",
          callID: crypto.randomUUID(),
          tool: "bash",
          state: {
            status: "completed",
            input: {},
            output: "x".repeat(200_000),
            title: "done",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        })

        // turn 2
        const u2 = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: u2.id,
          sessionID: info.id,
          type: "text",
          text: "second",
        })
        const a2: SessionV1.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: info.id,
          mode: "build",
          agent: "build",
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ref.modelID,
          providerID: ref.providerID,
          parentID: u2.id,
          time: { created: Date.now() },
          finish: "end_turn",
        }
        yield* ssn.updateMessage(a2)
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: a2.id,
          sessionID: info.id,
          type: "tool",
          callID: crypto.randomUUID(),
          tool: "bash",
          state: {
            status: "completed",
            input: {},
            output: "y".repeat(200_000),
            title: "done",
            metadata: {},
            time: { start: Date.now(), end: Date.now(), compacted: Date.now() },
          },
        })

        // turns 3 + 4 — the "skip 2 most recent" zone for prune
        const u3 = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: u3.id,
          sessionID: info.id,
          type: "text",
          text: "third",
        })
        const u4 = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: u4.id,
          sessionID: info.id,
          type: "text",
          text: "fourth",
        })

        yield* compact.prune({ sessionID: info.id })

        const msgs = yield* ssn.messages({ sessionID: info.id })
        const a1After = msgs
          .flatMap((msg) => msg.parts)
          .find((p) => p.type === "tool" && p.id === a1Bash.id)
        expect(a1After?.type).toBe("tool")
        if (a1After?.type === "tool" && a1After.state.status === "completed") {
          expect(typeof a1After.state.time.compacted).toBe("number")
        }
      }),
    {
      config: {
        compaction: { prune: true },
      },
    },
  ),
)
```

**Why 4 user turns, not 3:** the original draft had 3 user turns and 2 assistant turns, but the scan walks newest → oldest and skips the most-recent-2-user-turns. With only 3 user turns, the only unpruned bash sat in the skip-2 zone and was never reached regardless of the fix. The correct setup needs the unpruned bash to live in the scan zone (older than the 2 most recent user turns) AND have an already-pruned bash between it and the protected zone, so the buggy `break loop` short-circuits the scan before the unpruned one is reached.

**Test walkthrough:**
- Walk order (newest → oldest): u4, u3, a2, u2, a1, u1.
- u4 increments turns to 1 → skipped (turns < 2).
- u3 increments turns to 2, but its only part is text → no tools considered.
- a2's parts: bash with `time.compacted` set. **With fix:** `continue` skips it. **Without fix:** `break loop` exits the entire outer scan.
- a1's parts: bash WITHOUT `time.compacted`. **With fix:** reached, added to `toPrune`, `time.compacted` persisted. **Without fix:** never reached, `time.compacted` stays `undefined`.

Test asserts `typeof a1After.state.time.compacted === "number"` — passes with the fix, fails without.

## Verification

```bash
# from packages/opencode
bun typecheck

bun test test/session/instruction.test.ts -t "treats read parts as already-loaded"
bun test test/session/compaction.test.ts -t "continues past an already-pruned part"

# full suite to confirm no regression in adjacent tests:
bun test test/session/instruction.test.ts
bun test test/session/compaction.test.ts
```

## Notes

- **Single PR or two?** Both fixes touch the same prune/instruction area and both are 1-line changes. They can land in one PR cleanly with both tests; the issue body lumps them together. Suggest one PR with two commits (or one commit with both hunks and two test cases).
- **StarpTech is already assigned** to this issue per the bot comment. If a PR is already open from StarpTech, coordinate before opening a competing PR.
- **Adjacent, but out of scope:** `prune()` sets `state.time.compacted` but does not clear `state.output` — so the LLM still receives the "pruned" output in subsequent turns. This is a separate bug (`prune` doesn't actually reduce context); fixing it requires deciding where the empty-output convention lives. Not in scope for this PR.
- **Adjacent, but out of scope:** the v2-core "no runtime enforcement of read-before-edit" issues (`#30853`, `#30864`) are a different mechanism and should not be conflated with this fix.

## Issue Response

**Fixed by PR #30979.**

**Bug 1** was in `instruction.ts:extract()` — it skipped read parts with `time.compacted` set, but `metadata.loaded` (the list of instruction files already attached) survives compaction unchanged. This caused `resolve()` to re-attach `AGENTS.md`/`CLAUDE.md`/`CONTEXT.md` on every read after prune.

**Bug 2** was in `compaction.ts:prune()` — `break loop` when encountering an already-compacted part exited the outer message scan, so older prunable tools were silently skipped on all subsequent prune runs.

Both are 1-line fixes. Regression tests added for each.

export * as ACPReviewStaging from "./review-staging"

import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { ReviewOverlay } from "@opencode-ai/core/review-overlay"
import { isActive } from "./review-mode"

type Connection = Partial<Pick<AgentSideConnection, "writeTextFile">>

// The per-tool flush (from the ACP event loop) and the end-of-turn flush (from
// the prompt handler) run on independent async contexts but share the overlay.
// Serialize them so each drain -> send -> markFlushed cycle is atomic: without
// this, a slow writeTextFile still in flight when the end-of-turn flush drains
// would re-send the same not-yet-flushed edit and produce a duplicate write.
let flushChain: Promise<void> = Promise.resolve()

export function flushPendingWrites(connection: Connection | undefined, sessionID?: string) {
  const next = flushChain.then(() => flushOnce(connection, sessionID))
  // Keep the chain going even when a flush rejects, so one failed flush does not
  // poison later flushes; callers still observe the rejection via `next`.
  flushChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

async function flushOnce(connection: Connection | undefined, sessionID?: string) {
  if (!isActive()) return
  if (!connection?.writeTextFile) return
  if (sessionID) {
    ReviewOverlay.setActiveSession(sessionID)
    ReviewOverlay.enqueueUnflushed(sessionID)
  }

  const pending = ReviewOverlay.drainPendingWrites()

  // Only mark a write flushed once the client accepts it. If the client rejects
  // a write we must not treat it as delivered: the edit never reached the review
  // UI, and in review mode opencode never writes it to disk either, so silently
  // dropping it would surface a failed edit as a success. Unflushed entries stay
  // eligible for the end-of-turn retry, and a rejection fails the flush so the
  // turn can report the failure instead of pretending it worked.
  const failed: { path: string; error: unknown }[] = []
  for (const item of pending) {
    const error = await connection
      .writeTextFile({
        sessionId: item.sessionID,
        path: item.path,
        content: item.content,
      })
      .then(() => undefined)
      .catch((cause: unknown) => cause ?? new Error("writeTextFile rejected"))
    if (error !== undefined) {
      failed.push({ path: item.path, error })
      continue
    }
    ReviewOverlay.markFlushed(item.path, item.content)
  }

  if (failed.length === 0) return
  await Effect.runPromise(Effect.logError("client rejected staged edits", { failed }))
  throw new Error(`client rejected ${failed.length} staged edit(s): ${failed.map((item) => item.path).join(", ")}`)
}

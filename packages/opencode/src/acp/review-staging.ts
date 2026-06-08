export * as ACPReviewStaging from "./review-staging"

import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { ReviewOverlay } from "@opencode-ai/core/review-overlay"
import { isActive } from "./review-mode"

type Connection = Partial<Pick<AgentSideConnection, "writeTextFile">>

export async function flushPendingWrites(connection: Connection | undefined, sessionID?: string) {
  if (!isActive()) return
  if (!connection?.writeTextFile) return
  if (sessionID) {
    ReviewOverlay.setActiveSession(sessionID)
    ReviewOverlay.enqueueUnflushed(sessionID)
  }

  const pending = ReviewOverlay.drainPendingWrites()

  for (const item of pending) {
    await connection
      .writeTextFile({
        sessionId: item.sessionID,
        path: item.path,
        content: item.content,
      })
      .catch((error: unknown) =>
        Effect.runPromise(
          Effect.logError("failed to write staged edit through ACP", {
            error,
            path: item.path,
            sessionID: item.sessionID,
          }),
        ),
      )
  }
}

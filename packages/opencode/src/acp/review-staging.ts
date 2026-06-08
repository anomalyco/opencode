export * as ACPReviewStaging from "./review-staging"

import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import * as Log from "@opencode-ai/core/util/log"
import { ReviewOverlay } from "@opencode-ai/core/review-overlay"
import { isActive } from "./review-mode"

const log = Log.create({ service: "acp-review-staging" })

type Connection = Partial<Pick<AgentSideConnection, "writeTextFile">>

export async function flushPendingWrites(connection: Connection | undefined, sessionID?: string) {
  if (!isActive()) return
  if (!connection?.writeTextFile) return
  if (sessionID) {
    ReviewOverlay.setActiveSession(sessionID)
    ReviewOverlay.enqueueUnflushed(sessionID)
  }

  const pending = ReviewOverlay.drainPendingWrites()
  if (pending.length > 0) {
    log.info("flushing staged writes", { count: pending.length })
  }

  for (const item of pending) {
    await connection
      .writeTextFile({
        sessionId: item.sessionID,
        path: item.path,
        content: item.content,
      })
      .catch((error: unknown) => {
        log.error("failed to write staged edit through ACP", {
          error,
          path: item.path,
          sessionID: item.sessionID,
        })
      })
  }
}

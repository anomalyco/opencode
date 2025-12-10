import type { SessionNotification } from "@agentclientprotocol/sdk"
import { Plan } from "../../session/plan"
import { Log } from "../../util/log"

const log = Log.create({ service: "acp-plan-translator" })

/**
 * Handle plan notification from ACP agent.
 *
 * Per ACP spec, plan updates contain a complete replacement of all entries.
 * Clients MUST replace the entire plan (not merge).
 */
export async function handlePlan(sessionID: string, notification: SessionNotification): Promise<void> {
  if (notification.update.sessionUpdate !== "plan") {
    log.warn("handlePlan called with non-plan notification", {
      sessionID,
      actualType: notification.update.sessionUpdate,
    })
    return
  }

  // Extract entries from notification
  const rawEntries = notification.update.entries || []

  // Validate entries match our schema
  const validatedEntries: Plan.Entry[] = []
  for (const entry of rawEntries) {
    const result = Plan.Entry.safeParse(entry)
    if (result.success) {
      validatedEntries.push(result.data)
    } else {
      log.warn("invalid plan entry received, skipping", {
        sessionID,
        entry,
        error: result.error.message,
      })
    }
  }

  // Store with complete replacement semantics
  await Plan.update({ sessionID, entries: validatedEntries })

  log.info("translated plan", {
    sessionID,
    entryCount: validatedEntries.length,
    priorities: {
      high: validatedEntries.filter((e) => e.priority === "high").length,
      medium: validatedEntries.filter((e) => e.priority === "medium").length,
      low: validatedEntries.filter((e) => e.priority === "low").length,
    },
    statuses: {
      pending: validatedEntries.filter((e) => e.status === "pending").length,
      in_progress: validatedEntries.filter((e) => e.status === "in_progress").length,
      completed: validatedEntries.filter((e) => e.status === "completed").length,
    },
  })
}

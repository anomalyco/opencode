import { Session } from "../../session"
import type { SessionID } from "../../session/schema"
import { Knowledge } from "../index"
import { Log } from "../../util/log"

const log = Log.create({ service: "knowledge.extractors.patterns" })

export namespace PatternExtractor {
  export async function extract(sessionID: SessionID): Promise<void> {
    try {
      const session = await Session.get(sessionID)
      if (!session) return

      // Analyze message history for patterns
      // Look for: tool failures followed by success, retries, workarounds
      const messages = await Session.messages({ sessionID })

      // Simple heuristic: if there are error messages followed by success, it's a pattern
      let hasError = false
      let hasRecovery = false
      let errorContext: Record<string, string> = {}

      for (const msg of messages) {
        // Extract text content from message parts
        const textParts = msg.parts.filter((p) => p.type === "text")
        const content = textParts
          .map((p) => p.text)
          .join(" ")
          .toLowerCase()

        // Detect errors
        if (content.includes("error") || content.includes("failed")) {
          hasError = true
          // Try to extract error type
          const match = content.match(/error[:\s]+([a-z0-9_]+)/i)
          if (match) {
            errorContext.errorType = match[1]
          }
        }

        // Detect recovery/success after error
        if (hasError && (content.includes("success") || content.includes("fixed") || content.includes("resolved"))) {
          hasRecovery = true
        }
      }

      // Write pattern if we detected error -> recovery
      if (hasError && hasRecovery) {
        await Knowledge.writePattern({
          sessionID,
          agent: "session-auto",
          title: `Recovery Pattern: ${errorContext.errorType || "Error"} Resolution`,
          description: "Session demonstrated recovery from error condition",
          context: errorContext,
          tags: ["recovery", "auto-detected"],
          confidence: 0.7, // Lower confidence for auto-detected
          firstAttemptFailed: true,
          attempts: 2, // At least one retry
        })

        log.info("pattern extracted", { sessionID, errorType: errorContext.errorType })
      }
    } catch (err) {
      log.error("pattern extraction failed", { error: err, sessionID })
    }
  }
}

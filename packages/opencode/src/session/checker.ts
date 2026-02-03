import { Session } from "."
import { Agent } from "../agent/agent"
import { MessageV2 } from "./message-v2"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { generateObject } from "ai"
import { Provider } from "../provider/provider"
import { Config } from "../config/config"
import { SessionCompaction } from "./compaction"
import z from "zod"

export namespace SessionChecker {
  const log = Log.create({ service: "session.checker" })

  const FEEDBACK_PREFIX = "[Checker Agent Feedback]: "

  const CheckResultSchema = z.object({
    hasHallucination: z.boolean(),
    severity: z.enum(["critical", "major", "minor", "trivial"]).optional(),
    type: z
      .enum([
        "fabricated_information",
        "contradictory_information",
        "logical_inconsistency",
        "false_confidence",
        "tool_output_mismatch",
        "unverified_claim",
      ])
      .optional(),
    issue: z.string().optional(),
    evidence: z.string().optional(),
    suggestion: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  })

  type CheckResult = z.infer<typeof CheckResultSchema>

  function isFeedbackMessage(msg: MessageV2.WithParts): boolean {
    return msg.parts.some((p) => {
      if (p.type !== "text") return false
      const textPart = p as MessageV2.TextPart
      return typeof textPart.text === "string" && textPart.text.startsWith(FEEDBACK_PREFIX)
    })
  }

  interface CheckState {
    checkCount: number
    lastCheckTime: number | null
    lastCheckMessages: string[]
  }

  const stateCache = new Map<string, CheckState>()

  function getState(sessionID: string): CheckState {
    if (!stateCache.has(sessionID)) {
      stateCache.set(sessionID, { checkCount: 0, lastCheckTime: null, lastCheckMessages: [] })
    }
    return stateCache.get(sessionID)!
  }

  function cleanupState(sessionID: string): void {
    const state = stateCache.get(sessionID)
    if (state && Date.now() - (state.lastCheckTime ?? 0) > 3600000) {
      stateCache.delete(sessionID)
    }
  }

  function canCheck(sessionID: string, config: Config.Info): boolean {
    cleanupState(sessionID)
    const state = getState(sessionID)
    const maxChecks = config.checker?.max_checks ?? 10
    if (state.checkCount >= maxChecks) {
      log.debug("max checks reached", { sessionID, checkCount: state.checkCount, maxChecks })
      return false
    }
    const freq = config.checker?.frequency ?? "once_per_session"
    if (freq === "never") {
      log.debug("checker disabled by frequency config", { sessionID })
      return false
    }
    if (freq === "once_per_session" && state.checkCount > 0) {
      log.debug("already checked once in this session", { sessionID })
      return false
    }
    return true
  }

  async function getCheckerModel(input: { model: Provider.Model }): Promise<Provider.Model> {
    const config = await Config.get()
    const modelString = config.checker?.model
    if (!modelString) {
      return input.model
    }
    const [providerID, modelID] = modelString.split("/")
    return Provider.getModel(providerID, modelID)
  }

  export async function check(input: {
    sessionID: string
    messages: MessageV2.WithParts[]
    model: Provider.Model
    abort: AbortSignal
  }): Promise<boolean> {
    const config = await Config.get()
    if (config.checker?.enabled === false) {
      return false
    }

    if (!canCheck(input.sessionID, config)) {
      return false
    }

    const lastMsg = input.messages[input.messages.length - 1]

    if (
      lastMsg.info.role !== "assistant" ||
      !lastMsg.info.finish ||
      ["tool-calls", "stop", "error", "unknown"].includes(lastMsg.info.finish)
    ) {
      return false
    }

    const hasRecentFeedback = input.messages.some((m, idx) => {
      const recentStart = Math.max(0, input.messages.length - 6)
      return idx >= recentStart && isFeedbackMessage(m)
    })
    if (hasRecentFeedback) {
      return false
    }

    log.info("checking for hallucinations", { sessionID: input.sessionID })

    try {
      const agent = await Agent.get("checker")
      if (!agent) {
        log.warn("checker agent not found, skipping hallucination check")
        return false
      }

      const checkerModel = await getCheckerModel({ model: input.model })
      const language = await Provider.getLanguage(checkerModel)

      const filteredMessages = input.messages.filter((m) => !isFeedbackMessage(m))
      const checkerMessages = MessageV2.toModelMessages(filteredMessages, checkerModel)

      const { object: result } = await generateObject({
        model: language,
        schema: CheckResultSchema,
        system: agent.prompt,
        messages: checkerMessages,
        abortSignal: input.abort,
      })

      if (result.hasHallucination && result.confidence && result.confidence > 0.6) {
        const state = getState(input.sessionID)
        state.checkCount++
        state.lastCheckTime = Date.now()
        state.lastCheckMessages.push(lastMsg.info.id)

        log.info("hallucination detected", {
          sessionID: input.sessionID,
          type: result.type,
          severity: result.severity,
          confidence: result.confidence,
        })

        const feedbackContent = formatFeedback(result)
        const feedbackMsg: MessageV2.User = {
          id: Identifier.ascending("message"),
          sessionID: input.sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: lastMsg.info.agent,
          model: {
            providerID: checkerModel.providerID,
            modelID: checkerModel.id,
          },
        }

        await Session.updateMessage(feedbackMsg)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: feedbackMsg.id,
          sessionID: input.sessionID,
          type: "text",
          text: `${FEEDBACK_PREFIX}${feedbackContent}`,
          synthetic: true,
        } satisfies MessageV2.TextPart)

        return true
      }
    } catch (e) {
      log.error("hallucination check failed", { error: e })
    }

    return false
  }

  function formatFeedback(result: CheckResult): string {
    const parts: string[] = []
    if (result.type) parts.push(`**Type:** ${result.type.replace(/_/g, " ")}`)
    if (result.severity) parts.push(`**Severity:** ${result.severity}`)
    if (result.issue) parts.push(`**Issue:** ${result.issue}`)
    if (result.evidence) parts.push(`**Evidence:** ${result.evidence}`)
    if (result.suggestion) parts.push(`**Suggestion:** ${result.suggestion}`)
    if (result.confidence) parts.push(`**Confidence:** ${Math.round(result.confidence * 100)}%`)
    return parts.join("\n")
  }

  export function resetState(sessionID: string): void {
    stateCache.delete(sessionID)
  }

  export function getCheckState(sessionID: string): CheckState | undefined {
    return stateCache.get(sessionID)
  }
}

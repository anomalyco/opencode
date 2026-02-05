import { Session } from "."
import { Agent } from "../agent/agent"
import { MessageV2 } from "./message-v2"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { generateObject } from "ai"
import { Provider } from "../provider/provider"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import path from "path"
import fs from "fs/promises"
import z from "zod"

export namespace SessionChecker {
  const log = Log.create({ service: "session.checker" })

  const FEEDBACK_PREFIX = "[Checker Feedback]: "
  const EVOLUTION_OUTPUT_FILE = "prompt-evolution.md"
  const MAX_PROMPT_LENGTH = 10000

  const PROMPT_INJECTION_PATTERNS = [
    /ignore\s+(previous|all|above)/i,
    /system\s+(prompt|instruct)/i,
    /override\s+(previous|all)/i,
    /do\s+not\s+follow/i,
    /disregard\s+(previous|all)/i,
    /bypass\s+(restrictions|rules)/i,
    /new\s+system\s+prompt/i,
    /you\s+are\s+now\s+(a|an)/i,
  ]

  function isValidOptimizedPrompt(prompt: string): { valid: boolean; reason?: string } {
    if (!prompt.trim()) {
      return { valid: false, reason: "prompt is empty" }
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return { valid: false, reason: `prompt exceeds ${MAX_PROMPT_LENGTH} characters` }
    }
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(prompt)) {
        return { valid: false, reason: `suspicious pattern detected: ${pattern}` }
      }
    }
    return { valid: true }
  }

  const EvolutionResultSchema = z.object({
    shouldEvolve: z.boolean(),
    evolutionType: z.enum(["none", "minor", "major", "complete"]),
    reasoning: z.string(),
    optimizedPrompt: z.string().optional(),
    changes: z.array(z.string()),
  })

  type EvolutionResult = z.infer<typeof EvolutionResultSchema>

  interface EvolutionEntry {
    timestamp: number
    round: number
    userInput: string
    originalPrompt: string
    optimizedPrompt: string
    reasoning: string
    changes: string[]
  }

  function isFeedbackMessage(msg: MessageV2.WithParts): boolean {
    return msg.parts.some((p) => {
      if (p.type !== "text") return false
      const textPart = p as MessageV2.TextPart
      return typeof textPart.text === "string" && textPart.text.startsWith(FEEDBACK_PREFIX)
    })
  }

  interface CheckState {
    checkCount: number
    evolutionCount: number
    lastCheckTime: number | null
    evolutionHistory: EvolutionEntry[]
  }

  const stateCache = new Map<string, CheckState>()
  const effectivePromptCache = new Map<string, string>()

  function truncateText(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value
    return value.slice(0, maxChars) + "\n...[truncated]"
  }

  function getState(sessionID: string): CheckState {
    if (!stateCache.has(sessionID)) {
      stateCache.set(sessionID, {
        checkCount: 0,
        evolutionCount: 0,
        lastCheckTime: null,
        evolutionHistory: [],
      })
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

    // Check if evolution is explicitly enabled in config
    if (config.evolution?.enabled === false) {
      return false
    }

    const maxEvolutions = config.evolution?.max_evolutions ?? 5
    if (state.evolutionCount >= maxEvolutions) {
      log.info("max evolutions reached", { sessionID, count: state.evolutionCount })
      return false
    }

    const freq = config.evolution?.frequency ?? "on_failure"
    if (freq === "never") return false
    if (freq === "per_session" && state.evolutionCount > 0) return false

    // For "on_failure" or "always", we allow checking as long as we haven't hit max_evolutions
    return true
  }

  async function getEvolutionModel(input: { model: Provider.Model }): Promise<Provider.Model> {
    const config = await Config.get()
    const modelString = config.evolution?.model || config.checker?.model
    if (!modelString) return input.model
    const [providerID, modelID] = modelString.split("/")
    return Provider.getModel(providerID, modelID)
  }

  function computeDeltaPrompt(original: string, optimized: string): string {
    const a = original.split("\n")
    const b = optimized.split("\n")
    const m = a.length
    const n = b.length
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
    const added: string[] = []
    let i = m
    let j = n
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        i--
        j--
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        added.push(b[j - 1])
        j--
      } else if (i > 0) {
        i--
      } else {
        j--
      }
    }
    added.reverse()
    const filtered: string[] = []
    let inCode = false
    for (const line of added) {
      if (line.startsWith("```")) {
        inCode = !inCode
        continue
      }
      if (inCode) continue
      if (/\[\.\.\. .* \.\.\.]/.test(line)) continue
      if (/^\[?\.\.\. ?existing content ?\.\.\.]?$/i.test(line)) continue
      if (/^graph\s+TD$/i.test(line)) continue
      filtered.push(line)
    }
    const result = filtered.join("\n").trim()
    return result.length > 0 ? result : optimized
  }

  async function writeEvolutionEntry(sessionID: string, entry: EvolutionEntry): Promise<void> {
    const outputPath = path.join(Instance.directory, EVOLUTION_OUTPUT_FILE)
    try {
      await fs.stat(outputPath)
    } catch {
      await fs.writeFile(outputPath, "# Prompt Evolution Log\n\n", "utf-8")
    }
    const deltaPrompt = computeDeltaPrompt(entry.originalPrompt, entry.optimizedPrompt)

    const content = [
      `## Round ${entry.round} - ${new Date(entry.timestamp).toLocaleString()}`,
      `**Session ID:** ${sessionID}`,
      "",
      "### User Input",
      "```",
      entry.userInput,
      "```",
      "",
      "### Reasoning",
      entry.reasoning,
      "",
      "### Changes",
      ...entry.changes.map((c) => `- ${c}`),
      "",
      "### Original Prompt",
      "```",
      entry.originalPrompt,
      "```",
      "",
      "### Optimized Prompt",
      "```",
      deltaPrompt,
      "```",
      "",
      "---",
      "",
    ].join("\n")
    await fs.appendFile(outputPath, content, "utf-8")
    log.info("evolution written to file", { sessionID, filePath: outputPath, round: entry.round })
  }

  export async function check(input: {
    sessionID: string
    agent: string
    messages: MessageV2.WithParts[]
    model: Provider.Model
    currentPrompt: string
    agentPrompt?: string
    abort: AbortSignal
  }): Promise<boolean> {
    const config = await Config.get()

    // Use the specific canCheck logic for evolution
    if (!canCheck(input.sessionID, config)) {
      return false
    }

    const messages = input.messages.filter((m) => !isFeedbackMessage(m))
    if (messages.length < 2) {
      log.info("not enough messages for check", { count: messages.length })
      return false
    }

    const lastAssistantIndex = messages.findLastIndex((m) => m.info.role === "assistant")
    if (lastAssistantIndex < 0) {
      log.info("could not find last assistant message", { sessionID: input.sessionID })
      return false
    }

    const lastAssistantMsg = messages[lastAssistantIndex]
    const lastUserMsg = messages
      .slice(0, lastAssistantIndex)
      .findLast((m) => m.info.role === "user")

    if (!lastUserMsg || !lastAssistantMsg) {
      log.info("could not find user/assistant pair", {
        sessionID: input.sessionID,
        hasAssistant: !!lastAssistantMsg,
        hasUser: !!lastUserMsg
      })
      return false
    }

    const startIndex = Math.max(0, lastAssistantIndex - 7)
    const historyMessages = messages.slice(startIndex, lastAssistantIndex + 1)

    const formatMessage = (m: MessageV2.WithParts): string => {
      const role = m.info.role
      const agent = m.info.agent
      const content = m.parts
        .filter((p) => {
          if (p.type === "text") return true
          if (p.type === "tool") return true
          return false
        })
        .map((p) => {
          if (p.type === "text") {
            const text = (p as any).text
            return typeof text === "string" ? text : ""
          }
          if (p.type === "tool") {
            const tool = (p as any).tool
            const state = (p as any).state
            const status = state?.status
            const title = typeof state?.title === "string" ? state.title : ""
            const output = typeof state?.output === "string" ? truncateText(state.output, 2000) : ""
            const err = typeof state?.error === "string" ? truncateText(state.error, 1000) : ""
            const header = `[tool:${tool}] status=${status}${title ? " title=" + title : ""}`
            if (status === "completed" && output) return header + "\n" + output
            if (status === "error" && err) return header + "\n" + err
            return header
          }
          return ""
        })
        .filter((x) => x.trim().length > 0)
        .join("\n")
      return `[${role.toUpperCase()} - Agent: ${agent ?? ""}]\n${content}`
    }

    const conversationHistory = historyMessages.map(formatMessage).join("\n\n---\n\n")

    const userInput = lastUserMsg.parts
      .filter((p) => p.type === "text" && !(p as any).synthetic)
      .map((p) => (p as any).text)
      .join("\n")

    if (!userInput.trim()) return false

    log.info("checking prompt evolution", { sessionID: input.sessionID, agent: input.agent })

    try {
      const agent = await Agent.get("checker")
      if (!agent) {
        log.warn("checker agent not found")
        return false
      }

      const evolutionModel = await getEvolutionModel({ model: input.model })
      const language = await Provider.getLanguage(evolutionModel)

      const state = getState(input.sessionID)
      const recentEvolutions = state.evolutionHistory
        .slice(-3)
        .map((e) => `Round ${e.round}: ${e.changes.join("; ")}`)
        .join("\n")

      const userSystemOverride = (lastUserMsg.info as any).system

      const analysisPrompt = `
## Prompt Reflection
Agent: ${input.agent}

System Prompt:
\`\`\`
${input.currentPrompt}
\`\`\`

Last User Input (rules and preferences may be embedded here):
\`\`\`
${userInput}
\`\`\`

User System Override (if any):
\`\`\`
${typeof userSystemOverride === "string" && userSystemOverride.trim().length > 0 ? userSystemOverride : "(none)"}
\`\`\`

Recent Evolutions (if any):
\`\`\`
${recentEvolutions || "(none)"}
\`\`\`

Last Interaction:
${conversationHistory}

Task:
Decide if the system prompt should be optimized to better satisfy the user's intent.
Pay special attention to any explicit coding rules, style guides, or preferences mentioned by the user (for example naming conventions, async/await usage, error handling patterns, comment and TODO format, or response language requirements). If these rules are not clearly present in the current system prompt, incorporate them into the optimizedPrompt in a concise and structured way.
Return JSON with: shouldEvolve, evolutionType ("none"|"minor"|"major"|"complete"), reasoning, optimizedPrompt?, changes[].
`

      const { object: result } = await generateObject({
        model: language,
        schema: EvolutionResultSchema,
        system: agent.prompt,
        messages: [{ role: "user", content: analysisPrompt }],
        abortSignal: input.abort,
      })

      log.info("checker result", {
        sessionID: input.sessionID,
        agent: input.agent,
        shouldEvolve: result.shouldEvolve,
        evolutionType: result.evolutionType,
      })

      if (result.shouldEvolve && result.optimizedPrompt) {
        const validation = isValidOptimizedPrompt(result.optimizedPrompt)
        if (!validation.valid) {
          log.warn("optimized prompt validation failed", { sessionID: input.sessionID, reason: validation.reason })
        } else {
          const state = getState(input.sessionID)
          state.evolutionCount++
          state.lastCheckTime = Date.now()
          const round = state.evolutionHistory.length + 1

          const originalPrompt = input.agentPrompt && input.agentPrompt.trim().length > 0
            ? input.agentPrompt
            : input.currentPrompt

          const entry: EvolutionEntry = {
            timestamp: Date.now(),
            round,
            userInput,
            originalPrompt,
            optimizedPrompt: result.optimizedPrompt,
            reasoning: result.reasoning,
            changes: result.changes,
          }

          state.evolutionHistory.push(entry)
          await writeEvolutionEntry(input.sessionID, entry)

          await Session.update(input.sessionID, (draft) => {
            if (!draft.prompts) draft.prompts = {}
            draft.prompts[input.agent] = result.optimizedPrompt!
          })

          effectivePromptCache.set(`${input.sessionID}:${lastUserMsg.info.agent}`, result.optimizedPrompt)

          log.info("prompt evolved", { sessionID: input.sessionID, round, evolutionType: result.evolutionType })

          const feedbackContent = `## Prompt Optimized (Round ${round})

**Reasoning:** ${result.reasoning}

**Key Changes:**
${result.changes.map((c) => `- ${c}`).join("\n")}

*Detailed changes have been logged to ${EVOLUTION_OUTPUT_FILE}*`

          const feedbackMsg: MessageV2.User = {
            id: Identifier.ascending("message"),
            sessionID: input.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: input.agent,
            model: {
              providerID: evolutionModel.providerID,
              modelID: evolutionModel.id,
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

          log.info("feedback posted", { sessionID: input.sessionID, round })
          return true
        }
      }
    } catch (e) {
      log.error("evolution check failed", { error: e })
    }

    log.info("no evolution", { sessionID: input.sessionID, agent: input.agent })
    return false
  }

  export function getEffectivePrompt(sessionID: string, agentName: string): string | undefined {
    return effectivePromptCache.get(`${sessionID}:${agentName}`)
  }

  export function resetState(sessionID: string): void {
    stateCache.delete(sessionID)
    for (const key of effectivePromptCache.keys()) {
      if (key.startsWith(sessionID + ":")) {
        effectivePromptCache.delete(key)
      }
    }
  }

  export function getCheckState(sessionID: string): CheckState | undefined {
    return stateCache.get(sessionID)
  }
}

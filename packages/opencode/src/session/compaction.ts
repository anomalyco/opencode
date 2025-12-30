import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { SessionPrompt } from "./prompt"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionProcessor } from "./processor"
import { fn } from "@/util/fn"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { Global } from "@/global"
import path from "path"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  // Default configuration values
  export const DEFAULTS = {
    method: "standard" as const,
    trigger: 0.85, // Trigger at 85% of usable context to leave headroom
    extractRatio: 0.65,
    recentRatio: 0.15,
    summaryMaxTokens: 10000, // Target token count for collapse summary
    previousSummaries: 3, // Number of previous summaries to include in collapse
  }

  // Static portion of collapse prompt template for token estimation
  const COLLAPSE_PROMPT_TEMPLATE = `You are creating a comprehensive context restoration document from a collapsed conversation segment. This document will serve as the foundation for continued work - it must preserve critical knowledge that would otherwise be lost.

## Output Structure

Create a detailed summary with the following sections:

### 1. Current Task State
### 2. Resolved Code & Lessons Learned
### 3. User Directives
### 4. Custom Utilities & Commands
### 5. Design Decisions & Derived Requirements
### 6. Technical Facts

## Critical Rules

- PRESERVE working code verbatim in fenced blocks
- INCLUDE failed approaches with explanations
- Be specific: exact paths, line numbers, function names, config values
- Capture the "why" behind decisions, not just the "what"
- User directives are sacred - never omit explicit user preferences

## Extracted Context (to distill)
## Recent Context (for reference)

Generate the context restoration document now:`

  /**
   * Get the compaction method.
   * Priority: TUI toggle (kv.json) > config file > default
   */
  export async function getMethod(): Promise<"standard" | "collapse"> {
    const config = await Config.get()
    const configMethod = config.compaction?.method

    // Check TUI toggle override
    try {
      const file = Bun.file(path.join(Global.Path.state, "kv.json"))
      if (await file.exists()) {
        const kv = await file.json()
        const toggle = kv["compaction_method"]
        if (toggle === "standard" || toggle === "collapse") {
          return toggle
        }
      }
    } catch {
      // Ignore KV read errors
    }

    return configMethod ?? DEFAULTS.method
  }

  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return false
    const context = input.model.limit.context
    if (context === 0) return false

    const count = input.tokens.input + input.tokens.cache.read + input.tokens.cache.write + input.tokens.output
    const trigger = config.compaction?.trigger ?? DEFAULTS.trigger
    const threshold = context * trigger
    const isOver = count > threshold

    log.debug("overflow check", {
      tokens: input.tokens,
      count,
      context,
      trigger,
      threshold,
      isOver,
    })

    return isOver
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000

  const PRUNE_PROTECTED_TOOLS = ["skill"]

  // goes backwards through parts until there are 40_000 tokens worth of tool
  // calls. then erases output of previous tool calls. idea is to throw away old
  // tool calls that are no longer relevant.
  export async function prune(input: { sessionID: string }) {
    const config = await Config.get()
    if (config.compaction?.prune === false) return
    log.info("pruning")
    const msgs = await Session.messages({ sessionID: input.sessionID })
    let total = 0
    let pruned = 0
    const toPrune = []
    let turns = 0

    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      if (msg.info.role === "user") turns++
      if (turns < 2) continue
      if (msg.info.role === "assistant" && msg.info.summary) break loop
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type === "tool")
          if (part.state.status === "completed") {
            if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue

            if (part.state.time.compacted) break loop
            const estimate = Token.estimate(part.state.output)
            total += estimate
            if (total > PRUNE_PROTECT) {
              pruned += estimate
              toPrune.push(part)
            }
          }
      }
    }
    log.info("found", { pruned, total })
    if (pruned > PRUNE_MINIMUM) {
      for (const part of toPrune) {
        if (part.state.status === "completed") {
          part.state.time.compacted = Date.now()
          await Session.updatePart(part)
        }
      }
      log.info("pruned", { count: toPrune.length })
    }
  }

  /**
   * Process compaction - routes to appropriate method based on config.
   * This is called via the create() -> loop() -> process() flow.
   */
  export async function process(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
  }): Promise<"continue" | "stop"> {
    const method = await getMethod()
    log.info("compacting", { method })

    if (method === "collapse") {
      return processCollapse(input)
    }
    return processStandard(input)
  }

  /**
   * Standard compaction: Summarizes entire conversation at end.
   */
  async function processStandard(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
  }): Promise<"continue" | "stop"> {
    log.debug("standard", { parentID: input.parentID })
    const userMessage = input.messages.findLast((m) => m.info.id === input.parentID)!.info as MessageV2.User
    const agent = await Agent.get("compaction")
    const model = agent.model
      ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
      : await Provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
    const msg = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.parentID,
      sessionID: input.sessionID,
      mode: "compaction",
      agent: "compaction",
      summary: true,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.id,
      providerID: model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant
    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      model,
      abort: input.abort,
    })
    // Allow plugins to inject context or replace compaction prompt
    const compacting = await Plugin.trigger(
      "experimental.session.compacting",
      { sessionID: input.sessionID },
      { context: [], prompt: undefined },
    )
    const defaultPrompt =
      "Provide a detailed prompt for continuing our conversation above. Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next considering new session will not have access to our conversation."
    const promptText = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")
    const result = await processor.process({
      user: userMessage,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools: {},
      system: [],
      messages: [
        ...MessageV2.toModelMessage(input.messages),
        {
          role: "user",
          content: [
            {
              type: "text",
              text: promptText,
            },
          ],
        },
      ],
      model,
    })

    if (result === "continue" && input.auto) {
      const continueMsg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID: input.sessionID,
        time: {
          created: Date.now(),
        },
        agent: userMessage.agent,
        model: userMessage.model,
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: continueMsg.id,
        sessionID: input.sessionID,
        type: "text",
        synthetic: true,
        text: "Continue if you have next steps",
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      })
    }
    if (processor.message.error) return "stop"
    Bus.publish(Event.Compacted, { sessionID: input.sessionID })
    return "continue"
  }

  /**
   * Collapse compaction: Extract oldest messages, distill with AI, insert summary at breakpoint.
   * Messages before the breakpoint are filtered out by filterCompacted().
   */
  async function processCollapse(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
  }): Promise<"continue" | "stop"> {
    const config = await Config.get()
    const extractRatio = config.compaction?.extractRatio ?? DEFAULTS.extractRatio
    const recentRatio = config.compaction?.recentRatio ?? DEFAULTS.recentRatio
    const summaryMaxTokens = config.compaction?.summaryMaxTokens ?? DEFAULTS.summaryMaxTokens
    const previousSummariesLimit = config.compaction?.previousSummaries ?? DEFAULTS.previousSummaries

    // Get the user message to determine which model we'll use
    const originalUserMessage = input.messages.findLast((m) => m.info.id === input.parentID)!.info as MessageV2.User
    const agent = await Agent.get("compaction")
    const model = agent.model
      ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
      : await Provider.getModel(originalUserMessage.model.providerID, originalUserMessage.model.modelID)

    // Calculate token counts for messages first
    const messageTokens: number[] = []
    let totalTokens = 0
    for (const msg of input.messages) {
      const estimate = estimateMessageTokens(msg)
      messageTokens.push(estimate)
      totalTokens += estimate
    }

    // Calculate extraction targets
    const extractTarget = Math.floor(totalTokens * extractRatio)
    const recentTarget = Math.floor(totalTokens * recentRatio)

    // Find split points
    let extractedTokens = 0
    let extractSplitIndex = 0
    for (let i = 0; i < input.messages.length; i++) {
      if (extractedTokens >= extractTarget) break
      extractedTokens += messageTokens[i]
      extractSplitIndex = i + 1
    }

    let recentTokens = 0
    let recentSplitIndex = input.messages.length
    for (let i = input.messages.length - 1; i >= 0; i--) {
      if (recentTokens >= recentTarget) break
      recentTokens += messageTokens[i]
      recentSplitIndex = i
    }

    // Ensure recent split doesn't overlap with extract
    if (recentSplitIndex <= extractSplitIndex) {
      recentSplitIndex = extractSplitIndex
    }

    const extractedMessages = input.messages.slice(0, extractSplitIndex)
    const recentReferenceMessages = input.messages.slice(recentSplitIndex)

    log.debug("collapse split", {
      totalTokens,
      extractTarget,
      extractedTokens,
      extractedMessages: extractedMessages.length,
      recentTarget,
      recentTokens,
      recentMessages: recentReferenceMessages.length,
    })

    if (extractedMessages.length === 0) {
      log.info("collapse skipped", { reason: "no messages to extract" })
      return "continue"
    }

    // Convert extracted messages to markdown for distillation
    const markdownContent = messagesToMarkdown(extractedMessages)
    const recentContext = messagesToMarkdown(recentReferenceMessages)

    // Build base prompt (without previous summaries) to calculate token budget
    const markdownTokens = Token.estimate(markdownContent)
    const recentTokensEstimate = Token.estimate(recentContext)
    const templateTokens = Token.estimate(COLLAPSE_PROMPT_TEMPLATE)
    const basePromptTokens = markdownTokens + recentTokensEstimate + templateTokens
    const contextLimit = model.limit.context
    const outputReserve = SessionPrompt.OUTPUT_TOKEN_MAX
    const previousSummaryBudget = Math.max(0, contextLimit - outputReserve - basePromptTokens)

    // Fetch previous summaries that fit within budget
    const previousSummaries = await getPreviousSummaries(input.sessionID, previousSummariesLimit, previousSummaryBudget)

    // Get the last extracted message to determine breakpoint position
    const lastExtractedMessage = extractedMessages[extractedMessages.length - 1]
    const lastExtractedId = lastExtractedMessage.info.id

    // Extract timestamp from the last extracted message ID
    // Use createLike to handle both 6-byte and 7-byte ID formats
    const breakpointTimestamp = lastExtractedMessage.info.time.created + 1

    log.debug("collapse positioning", {
      lastExtractedId,
      breakpointTimestamp,
    })

    // Create the compaction user message at the breakpoint position
    const compactionUserId = Identifier.createLike(lastExtractedId, "message", false, 1)
    const compactionUserMsg = await Session.updateMessage({
      id: compactionUserId,
      role: "user",
      model: originalUserMessage.model,
      sessionID: input.sessionID,
      agent: originalUserMessage.agent,
      time: {
        created: breakpointTimestamp,
      },
    })
    await Session.updatePart({
      id: Identifier.createLike(lastExtractedId, "part", false, 1),
      messageID: compactionUserMsg.id,
      sessionID: input.sessionID,
      type: "compaction",
      auto: input.auto,
    })

    // Create assistant summary message positioned right after the compaction user message
    // Use compactionUserId as reference (not lastExtractedId) to ensure assistant sorts immediately after user
    // This prevents other messages from being created with IDs that sort between user and assistant
    const compactionAssistantId = Identifier.createLike(compactionUserId, "message", false, 1)
    const msg = (await Session.updateMessage({
      id: compactionAssistantId,
      role: "assistant",
      parentID: compactionUserMsg.id,
      sessionID: input.sessionID,
      mode: "compaction",
      agent: "compaction",
      summary: true,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.id,
      providerID: model.providerID,
      time: {
        created: breakpointTimestamp + 1,
      },
    })) as MessageV2.Assistant

    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      model,
      abort: input.abort,
    })

    // Allow plugins to inject context
    const compacting = await Plugin.trigger(
      "experimental.session.compacting",
      { sessionID: input.sessionID },
      { context: [], prompt: undefined },
    )

    // Build prompt sections - only include what we have
    const sections: string[] = []

    // Instructions
    sections.push(`You are creating a comprehensive context restoration document. This document will serve as the foundation for continued work - it must preserve critical knowledge that would otherwise be lost.

Create a detailed summary (target: approximately ${summaryMaxTokens} tokens) with these sections:
1. Current Task State - what is being worked on, next steps, blockers
2. Resolved Code & Lessons Learned - working code verbatim, failed approaches, insights
3. User Directives - explicit preferences, style rules, things to always/never do
4. Custom Utilities & Commands - scripts, aliases, debugging commands
5. Design Decisions & Derived Requirements - architecture decisions, API contracts, patterns
6. Technical Facts - file paths, function names, config values, environment details

Critical rules:
- PRESERVE working code verbatim in fenced blocks
- INCLUDE failed approaches with explanations
- Be specific with paths, line numbers, function names
- Capture the "why" behind decisions
- User directives are sacred - never omit them`)

    // Previous summaries
    if (previousSummaries.length > 0) {
      sections.push(`<previous_summaries>
IMPORTANT: Merge all information from these previous summaries into your new summary. Do not lose any historical context.

${previousSummaries.map((summary, i) => `--- Summary ${i + 1} ---\n${summary}`).join("\n\n")}
</previous_summaries>`)
    }

    // Extracted content
    sections.push(`<extracted_context>
The following conversation content needs to be distilled into the summary:

${markdownContent}
</extracted_context>`)

    // Recent context
    sections.push(`<recent_context>
The following is recent context for reference (shows current state):

${recentContext}
</recent_context>`)

    // Additional plugin context
    if (compacting.context.length > 0) {
      sections.push(`<additional_context>
${compacting.context.join("\n\n")}
</additional_context>`)
    }

    sections.push("Generate the context restoration document now.")

    const collapsePrompt = sections.join("\n\n")

    const result = await processor.process({
      user: originalUserMessage,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools: {},
      system: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: collapsePrompt }],
        },
      ],
      model,
    })

    // NOTE: We intentionally do NOT add a "Continue if you have next steps" message
    // for collapse mode. The collapse summary is just context restoration - the loop
    // should exit after the summary is generated so the user can continue naturally.

    if (processor.message.error) return "stop"

    // Update token count on the chronologically last assistant message
    // so isOverflow() sees the correct post-collapse state.
    const allMessages = await Session.messages({ sessionID: input.sessionID })
    const lastAssistant = allMessages
      .filter(
        (m): m is MessageV2.WithParts & { info: MessageV2.Assistant } =>
          m.info.role === "assistant" && m.info.id !== msg.id,
      )
      .sort((a, b) => b.info.time.created - a.info.time.created)[0]

    if (lastAssistant) {
      const originalTokens = { ...lastAssistant.info.tokens }
      const collapseSummaryTokens = processor.message.tokens.output

      const currentTotal =
        lastAssistant.info.tokens.input +
        lastAssistant.info.tokens.cache.read +
        lastAssistant.info.tokens.cache.write +
        lastAssistant.info.tokens.output

      const newTotal = Math.max(0, currentTotal - extractedTokens + collapseSummaryTokens)

      lastAssistant.info.tokens = {
        input: 0,
        output: lastAssistant.info.tokens.output,
        reasoning: lastAssistant.info.tokens.reasoning,
        cache: {
          read: Math.max(0, newTotal - lastAssistant.info.tokens.output),
          write: 0,
        },
      }
      await Session.updateMessage(lastAssistant.info)

      log.debug("tokens adjusted", {
        extracted: extractedTokens,
        summary: collapseSummaryTokens,
        total: newTotal,
      })
    }

    log.info("collapsed", {
      messages: extractedMessages.length,
      tokens: extractedTokens,
    })

    // Delete the original trigger message (created by create()) to prevent
    // the loop from picking it up again as a pending compaction task.
    // The trigger is the message at input.parentID - we've created a new
    // compaction user message at the breakpoint position.
    if (input.parentID !== compactionUserMsg.id) {
      log.debug("cleanup trigger", { id: input.parentID })
      // Delete parts first
      const triggerMsg = input.messages.find((m) => m.info.id === input.parentID)
      if (triggerMsg) {
        for (const part of triggerMsg.parts) {
          await Session.removePart({
            sessionID: input.sessionID,
            messageID: input.parentID,
            partID: part.id,
          })
        }
      }
      await Session.removeMessage({
        sessionID: input.sessionID,
        messageID: input.parentID,
      })
    }

    Bus.publish(Event.Compacted, { sessionID: input.sessionID })

    // For auto-compaction: return "continue" so the loop processes the user's
    // original message that triggered the overflow. The trigger message is deleted,
    // so the loop will find the real user message and respond to it.
    // For manual compaction: return "stop" - user explicitly requested compaction only.
    if (input.auto) {
      return "continue"
    }
    return "stop"
  }

  export const create = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      agent: z.string(),
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      auto: z.boolean(),
    }),
    async (input) => {
      const msg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: {
          created: Date.now(),
        },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
      })
    },
  )

  /**
   * Estimate tokens for a message (respects compaction state)
   */
  function estimateMessageTokens(msg: MessageV2.WithParts): number {
    let tokens = 0
    for (const part of msg.parts) {
      if (part.type === "text") {
        tokens += Token.estimate(part.text)
      } else if (part.type === "tool" && part.state.status === "completed") {
        // Skip compacted tool outputs
        if (part.state.time.compacted) continue
        tokens += Token.estimate(JSON.stringify(part.state.input))
        tokens += Token.estimate(part.state.output)
      }
    }
    return tokens
  }

  /**
   * Convert messages to markdown format for distillation
   */
  function messagesToMarkdown(messages: MessageV2.WithParts[]): string {
    const lines: string[] = []

    for (const msg of messages) {
      const role = msg.info.role === "user" ? "User" : "Assistant"
      lines.push(`### ${role}`)
      lines.push("")

      for (const part of msg.parts) {
        if (part.type === "text" && part.text) {
          // Skip synthetic parts like "Continue if you have next steps"
          if (part.synthetic) continue
          lines.push(part.text)
          lines.push("")
        } else if (part.type === "tool" && part.state.status === "completed") {
          // Skip compacted tool outputs
          if (part.state.time.compacted) continue
          lines.push(`**Tool: ${part.tool}**`)
          lines.push("```json")
          lines.push(JSON.stringify(part.state.input, null, 2))
          lines.push("```")
          if (part.state.output) {
            lines.push("Output:")
            lines.push("```")
            lines.push(part.state.output.slice(0, 1000))
            if (part.state.output.length > 1000) lines.push("... (truncated)")
            lines.push("```")
          }
          lines.push("")
        }
      }
    }

    return lines.join("\n")
  }

  /**
   * Extract summary text from a compaction summary message's parts
   */
  function extractSummaryText(msg: MessageV2.WithParts): string {
    return msg.parts
      .filter((p): p is MessageV2.TextPart => p.type === "text" && !p.synthetic)
      .map((p) => p.text)
      .join("\n")
  }

  /**
   * Fetch previous compaction summaries from the session (unfiltered).
   * Respects token budget to avoid overflowing context window.
   */
  async function getPreviousSummaries(sessionID: string, limit: number, tokenBudget: number): Promise<string[]> {
    const allMessages = await Session.messages({ sessionID })

    const summaryMessages = allMessages
      .filter(
        (m): m is MessageV2.WithParts & { info: MessageV2.Assistant } =>
          m.info.role === "assistant" &&
          (m.info as MessageV2.Assistant).summary === true &&
          (m.info as MessageV2.Assistant).finish !== undefined,
      )
      .sort((a, b) => a.info.time.created - b.info.time.created) // oldest first
      .slice(-limit) // take the N most recent

    // Include summaries only if they fit within token budget
    // Start from most recent (end of array) since those are most relevant
    const result: string[] = []
    let tokensUsed = 0

    for (let i = summaryMessages.length - 1; i >= 0; i--) {
      const text = extractSummaryText(summaryMessages[i])
      if (!text.trim()) continue

      const estimate = Token.estimate(text)
      if (tokensUsed + estimate > tokenBudget) break

      result.unshift(text) // prepend to maintain chronological order
      tokensUsed += estimate
    }

    return result
  }
}

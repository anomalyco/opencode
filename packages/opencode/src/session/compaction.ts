import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
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
import { generateObject } from "ai"

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

  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return false
    const context = input.model.limit.context
    if (context === 0) return false
    const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
    const output = Math.min(input.model.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX) || SessionPrompt.OUTPUT_TOKEN_MAX
    const usable = context - output
    return count > usable
  }

  // ============================================================================
  // Tool Categories - Tiered Priority System
  // ============================================================================

  /** Tier 1: Content tools - high informational value, LLM summarization when pruned */
  export const CONTENT_TOOLS = new Set(["read", "webfetch", "codesearch"])

  /** Tier 2: Navigation tools - ephemeral results, tool-specific compression */
  export const NAVIGATION_TOOLS = new Set(["list", "grep", "glob", "bash", "websearch"])

  /** Tier 3: Action tools - never pruned (outputs are small and important) */
  export const ACTION_TOOLS = new Set(["edit", "write", "task", "todowrite", "todoread", "skill"])

  /** Token budgets for each tier */
  export const PRUNE_CONTENT_BUDGET = 60_000
  export const PRUNE_NAVIGATION_BUDGET = 15_000

  /** Minimum tokens to prune (avoid pruning tiny amounts) */
  export const PRUNE_MINIMUM = 20_000

  /** Legacy constant for backwards compatibility */
  export const PRUNE_PROTECT = 40_000

  type ToolTier = "content" | "navigation" | "action"

  interface PruningConfig {
    contentTools: Set<string>
    navigationTools: Set<string>
    protectedTools: Set<string>
    contentBudget: number
    navigationBudget: number
    summarizationEnabled: boolean
    summarizationModel?: string // undefined = use Provider.getSmallModel()
  }

  async function getPruningConfig(): Promise<PruningConfig> {
    const config = await Config.get()
    const pruning = config.pruning

    // Build tool sets from defaults + custom config
    const contentTools = new Set(CONTENT_TOOLS)
    const navigationTools = new Set(NAVIGATION_TOOLS)
    const protectedTools = new Set(ACTION_TOOLS)

    if (pruning?.contentTools) {
      for (const tool of pruning.contentTools) contentTools.add(tool)
    }
    if (pruning?.navigationTools) {
      for (const tool of pruning.navigationTools) navigationTools.add(tool)
    }
    if (pruning?.protectedTools) {
      for (const tool of pruning.protectedTools) protectedTools.add(tool)
    }

    return {
      contentTools,
      navigationTools,
      protectedTools,
      contentBudget: pruning?.budgets?.content ?? PRUNE_CONTENT_BUDGET,
      navigationBudget: pruning?.budgets?.navigation ?? PRUNE_NAVIGATION_BUDGET,
      summarizationEnabled: pruning?.summarization?.enabled ?? true,
      summarizationModel: pruning?.summarization?.model, // undefined = use Provider.getSmallModel()
    }
  }

  function getToolTier(toolName: string, config: PruningConfig): ToolTier {
    if (config.protectedTools.has(toolName)) return "action"
    if (config.contentTools.has(toolName)) return "content"
    if (config.navigationTools.has(toolName)) return "navigation"
    // MCP tools and unknown tools default to navigation tier (conservative approach)
    return "navigation"
  }

  // ============================================================================
  // Tool-Specific Compression Strategies
  // ============================================================================

  function compressNavigationOutput(tool: string, output: string): string {
    switch (tool) {
      case "grep":
        return compressGrep(output)
      case "glob":
        return compressGlob(output)
      case "bash":
        return compressBash(output)
      case "list":
        return "[Directory listing cleared]"
      case "websearch":
        return compressWebsearch(output)
      default:
        return "[Tool output cleared]"
    }
  }

  function compressGrep(output: string): string {
    const lines = output.split("\n")
    if (lines.length <= 5) return output
    const kept = lines.slice(0, 5)
    const remaining = lines.length - 5
    return kept.join("\n") + `\n... (${remaining} more matches)`
  }

  function compressGlob(output: string): string {
    const lines = output.split("\n").filter((l) => l.trim())
    if (lines.length <= 10) return output
    const kept = lines.slice(0, 10)
    const remaining = lines.length - 10
    return kept.join("\n") + `\n... (${remaining} more files)`
  }

  function compressBash(output: string): string {
    const lines = output.split("\n")
    if (lines.length <= 10) return output

    // Try to extract exit code if present
    const exitMatch = output.match(/exit code:?\s*(\d+)/i)
    const exitCode = exitMatch ? `Exit code: ${exitMatch[1]}\n` : ""

    const kept = lines.slice(-10)
    return exitCode + `... (${lines.length - 10} lines truncated)\n` + kept.join("\n")
  }

  function compressWebsearch(output: string): string {
    // Extract just titles and URLs from search results
    const lines = output.split("\n")
    const compressed: string[] = []
    for (const line of lines) {
      if (line.includes("http") || line.match(/^\d+\.\s/) || line.match(/^-\s/)) {
        compressed.push(line)
      }
    }
    if (compressed.length === 0) return "[Search results cleared]"
    return compressed.slice(0, 10).join("\n")
  }

  // ============================================================================
  // LLM Summarization for Content Tools
  // ============================================================================

  const SUMMARIZATION_PROMPT = `You are a code context summarizer. Your job is to create concise summaries of tool outputs that preserve the essential information an AI coding assistant needs to continue working effectively.

For each tool output, create a summary that:
1. States the file path and size (lines/tokens) if applicable
2. Lists key exports, classes, or functions
3. Notes important line number ranges for key sections
4. Preserves any error messages or warnings verbatim
5. Keeps the summary under 100 tokens

Focus on information that would prevent the assistant from needing to re-read the file. Structure matters more than prose.`

  async function summarizeToolOutputs(
    parts: Array<{ id: string; tool: string; output: string; title: string }>,
    providerID: string,
    modelSpec?: string,
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>()
    if (parts.length === 0) return results

    try {
      // Use configured model, or fall back to small model (same as title generation)
      let model: Provider.Model | undefined
      if (modelSpec) {
        const [provider, modelID] = modelSpec.includes("/") ? modelSpec.split("/", 2) : [providerID, modelSpec]
        model = await Provider.getModel(provider, modelID).catch(() => undefined)
      }
      if (!model) {
        model = await Provider.getSmallModel(providerID)
      }
      if (!model) {
        log.warn("summarization model not available, skipping summaries")
        return results
      }

      const language = await Provider.getLanguage(model)

      // Build prompt with all parts to summarize
      const partsPrompt = parts
        .map(
          (p, i) => `
--- Part ${i + 1} (ID: ${p.id}, Tool: ${p.tool}) ---
Title: ${p.title}
Output:
${p.output.slice(0, 8000)}${p.output.length > 8000 ? "\n... (truncated)" : ""}
`,
        )
        .join("\n")

      const response = await generateObject({
        model: language,
        temperature: 0.1,
        schema: z.object({
          summaries: z.array(
            z.object({
              partId: z.string(),
              summary: z.string(),
            }),
          ),
        }),
        messages: [
          { role: "system", content: SUMMARIZATION_PROMPT },
          {
            role: "user",
            content: `Summarize the following ${parts.length} tool output(s). Return a summary for each part ID.\n\n${partsPrompt}`,
          },
        ],
      })

      for (const s of response.object.summaries) {
        results.set(s.partId, s.summary)
      }

      log.info("generated summaries", { count: results.size })
    } catch (err) {
      log.warn("summarization failed", { error: err })
    }

    return results
  }

  // ============================================================================
  // Main Pruning Logic - Tiered Priority System
  // ============================================================================

  interface PartInfo {
    part: MessageV2.ToolPart
    tokens: number
  }

  export async function prune(input: { sessionID: string }) {
    const config = await Config.get()
    if (config.compaction?.prune === false) return
    if (config.pruning?.enabled === false) return
    log.info("pruning")

    const pruningConfig = await getPruningConfig()
    const msgs = await Session.messages({ sessionID: input.sessionID })

    // Get the provider ID from the most recent assistant message for small model lookup
    const lastAssistant = msgs.findLast((m) => m.info.role === "assistant")
    const providerID = lastAssistant?.info.role === "assistant" ? lastAssistant.info.providerID : "openai"

    // Collect all tool parts by tier
    const contentParts: PartInfo[] = []
    const navigationParts: PartInfo[] = []
    let turns = 0

    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      if (msg.info.role === "user") turns++
      if (turns < 2) continue // Skip last 2 turns (recent context always protected)
      if (msg.info.role === "assistant" && msg.info.summary) break loop

      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type !== "tool") continue
        if (part.state.status !== "completed") continue
        if (part.state.time.compacted) break loop // Stop at first compacted part

        const tier = getToolTier(part.tool, pruningConfig)
        if (tier === "action") continue // Never prune action tools

        const tokens = Token.estimate(part.state.output)

        if (tier === "content") {
          contentParts.push({ part, tokens })
        } else {
          navigationParts.push({ part, tokens })
        }
      }
    }

    // Calculate what to prune for each tier using configurable budgets
    const contentToPrune = calculatePruneCandidates(contentParts, pruningConfig.contentBudget)
    const navigationToPrune = calculatePruneCandidates(navigationParts, pruningConfig.navigationBudget)

    const totalToPrune = contentToPrune.tokens + navigationToPrune.tokens
    log.info("found", {
      contentTotal: contentParts.reduce((a, b) => a + b.tokens, 0),
      navigationTotal: navigationParts.reduce((a, b) => a + b.tokens, 0),
      contentToPrune: contentToPrune.tokens,
      navigationToPrune: navigationToPrune.tokens,
    })

    if (totalToPrune < PRUNE_MINIMUM) {
      log.info("skipping prune, below minimum", { totalToPrune, minimum: PRUNE_MINIMUM })
      return
    }

    Bus.publish(TuiEvent.ToastShow, {
      message: "Smart pruning started...",
      variant: "info",
      duration: 2000,
    })

    // Generate summaries for content tools being pruned (if enabled)
    let summaries = new Map<string, string>()
    if (pruningConfig.summarizationEnabled) {
      const partsToSummarize = contentToPrune.parts
        .filter((p) => p.part.state.status === "completed")
        .map((p) => ({
          id: p.part.id,
          tool: p.part.tool,
          output: (p.part.state as MessageV2.ToolStateCompleted).output,
          title: (p.part.state as MessageV2.ToolStateCompleted).title,
        }))

      summaries = await summarizeToolOutputs(partsToSummarize, providerID, pruningConfig.summarizationModel)
    }

    let savedTokens = totalToPrune

    // Apply pruning - content tools get summaries
    for (const { part } of contentToPrune.parts) {
      if (part.state.status === "completed") {
        const summary = summaries.get(part.id)
        if (summary) {
          part.state.summary = summary
          savedTokens -= Token.estimate(summary)
        }
        part.state.time.compacted = Date.now()
        await Session.updatePart(part)
      }
    }

    // Apply pruning - navigation tools get compressed
    for (const { part } of navigationToPrune.parts) {
      if (part.state.status === "completed") {
        const compressed = compressNavigationOutput(part.tool, part.state.output)
        part.state.summary = compressed
        savedTokens -= Token.estimate(compressed)
        part.state.time.compacted = Date.now()
        await Session.updatePart(part)
      }
    }

    Bus.publish(TuiEvent.ToastShow, {
      title: "Smart Pruning",
      message: `Saved ${Math.round(savedTokens)} tokens`,
      variant: "success",
    })

    log.info("pruned", {
      contentCount: contentToPrune.parts.length,
      navigationCount: navigationToPrune.parts.length,
    })
  }

  function calculatePruneCandidates(parts: PartInfo[], budget: number): { parts: PartInfo[]; tokens: number } {
    let total = 0
    for (const p of parts) {
      total += p.tokens
    }

    if (total <= budget) {
      return { parts: [], tokens: 0 }
    }

    // Parts are in reverse chronological order (newest first from the loop).
    // We want to KEEP the newest ones (within budget) and PRUNE the oldest.
    // So we iterate from the START (newest), accumulating tokens until we hit the budget,
    // then everything after that point gets pruned.
    const toPrune: PartInfo[] = []
    let keptTokens = 0
    let budgetExceeded = false

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      if (!budgetExceeded && keptTokens + p.tokens <= budget) {
        // Keep this part (it fits in budget)
        keptTokens += p.tokens
      } else {
        // This part and all remaining (older) parts get pruned
        budgetExceeded = true
        toPrune.push(p)
      }
    }

    const prunedTokens = toPrune.reduce((acc, p) => acc + p.tokens, 0)
    return { parts: toPrune, tokens: prunedTokens }
  }

  export async function process(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
  }) {
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
}

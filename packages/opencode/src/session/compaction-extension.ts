import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionProcessor } from "./processor"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { Global } from "@/global"
import { Bus } from "@/bus"
import { SessionCompaction } from "./compaction"
import { ProviderTransform } from "../provider/transform"
import { KnowledgePack } from "./knowledge-pack"
import path from "path"

/**
 * Compaction Extension Module
 *
 * This module implements extended compaction modes beyond the standard compaction.
 * Currently includes "collapse" and "float" modes.
 *
 * Collapse mode features:
 * - Selective compression: Only compresses OLD messages, keeps recent work intact
 * - Historical summary merging: Merges previous summaries into new ones (no info loss)
 * - Breakpoint insertion: Places summary at correct position in message timeline
 * - splitChain control: When false (default), breakpoints only at chain boundaries
 *
 * Float mode features:
 * - Automatic chain sub-collapse before evaluating context overflow
 * - Preserves high-fidelity summaries of individual chains
 * - Configurable chain threshold before triggering sub-collapse
 *
 * This file is designed to be self-contained for easy rebasing when upstream changes.
 *
 * DEBUG: All debug logging uses "COLLAPSE" tag for easy grep filtering:
 *   tail -f ~/.local/share/opencode/log/dev.log | grep COLLAPSE
 */

export namespace CompactionExtension {
  const log = Log.create({ service: "session.compaction.extension" })

  // Sub-collapse algorithm types
  export type SubCollapseAlgorithm = "full" | "bookend" | "minimal"

  // Default configuration values
  export const DEFAULTS = {
    method: "standard" as const,
    trigger: 0.85, // Trigger at 85% of usable context to leave headroom
    extractRatio: 0.65,
    recentRatio: 0.15,
    summaryMaxTokens: 10000, // Target token count for collapse summary
    previousSummaries: 3, // Number of previous summaries to include in collapse
    splitChain: true, // Allow breakpoints mid-chain by default
    splitChainMinThreshold: 0.75, // Min fraction of extractTarget required when rewinding to chain start; below this, fall back to mid-chain split
    float: {
      chainThreshold: 3, // Number of chains before sub-collapse triggers
      minFloat: 0.6, // Minimum context used fraction required before sub-collapse is evaluated (60%)
      algorithm: "bookend" as SubCollapseAlgorithm,
      subCollapseSummaryMaxTokens: 5000,
    },
  }

  /**
   * Chain information for sub-collapse
   */
  export interface ChainInfo {
    /** Index of the user message that starts the chain */
    userMessageIndex: number
    /** Indices of all assistant messages in the chain */
    assistantMessageIndices: number[]
    /** All message indices in the chain */
    allMessageIndices: number[]
    /** Total estimated tokens in the chain */
    chainTokens: number
    /** User message ID */
    userMessageId: string
  }

  // Build collapse prompt instructions (tokenTarget is optional for estimation)
  function collapseInstructions(tokenTarget?: number, knowledgePacks?: { name: string; text: string }[]): string {
    const targetClause = tokenTarget ? ` (target: approximately ${tokenTarget} tokens)` : ""

    const kpSection =
      knowledgePacks && knowledgePacks.length > 0
        ? `\n\nKnowledge Packs (PERSISTENT -- always injected into every conversation, never compacted away):
${knowledgePacks.map((kp) => `- ${kp.name}`).join("\n")}

These knowledge packs are permanently present in every conversation. Do NOT summarize or repeat content that is already covered by a knowledge pack -- it wastes tokens and will always be there anyway.

EXCEPTION: If the conversation explicitly overrides, disables, or modifies instructions from a knowledge pack, you MUST capture that override precisely -- reference the knowledge pack by name and state exactly what was changed or overridden. For example: "User overrode coder-mcp-tools: do not use coder snapshot tool for this project, use direct file reads instead."`
        : ""

    return `You are creating a comprehensive context restoration document. This document will serve as the foundation for continued work - it must preserve critical knowledge that would otherwise be lost.

Create a detailed summary${targetClause} with these sections:
1. Current Task State - what is being worked on, next steps, blockers
2. Resolved Code & Lessons Learned - working code verbatim, failed approaches, insights
3. User Directives - explicit preferences, style rules, things to always/never do
4. Custom Utilities & Commands - scripts, aliases, debugging commands
5. Design Decisions & Derived Requirements - architecture decisions, API contracts, patterns
6. Technical Facts - file paths, function names, config values, environment details${kpSection}

Critical rules:
- PRESERVE working code verbatim in fenced blocks
- INCLUDE failed approaches with explanations
- Be specific with paths, line numbers, function names
- Capture the "why" behind decisions
- User directives are sacred - never omit them`
  }

  /**
   * Get the compaction method.
   * Priority: TUI toggle (kv.json) > config file > default
   */
  export async function getMethod(): Promise<"standard" | "collapse" | "float"> {
    const config = await Config.get()
    const configMethod = config.compaction?.method

    // Check TUI toggle override
    try {
      const file = Bun.file(path.join(Global.Path.state, "kv.json"))
      if (await file.exists()) {
        const kv = await file.json()
        const toggle = kv["compaction_method"]
        if (toggle === "standard" || toggle === "collapse" || toggle === "float") {
          log.info("COLLAPSE getMethod kv override", { method: toggle })
          return toggle
        }
      }
    } catch {
      // Ignore KV read errors
    }

    log.info("COLLAPSE getMethod", { method: configMethod ?? DEFAULTS.method })
    return configMethod ?? DEFAULTS.method
  }

  /**
   * Check if context is overflowing based on collapse trigger threshold.
   * Uses configurable trigger ratio instead of fixed context-output calculation.
   */
  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    if (config.compaction?.auto === false) {
      log.debug("COLLAPSE isOverflow auto=false, skipping")
      return false
    }
    const context = input.model.limit.context
    if (context === 0) {
      log.debug("COLLAPSE isOverflow context=0, skipping")
      return false
    }

    const count = input.tokens.input + input.tokens.cache.read + input.tokens.cache.write + input.tokens.output
    const trigger = config.compaction?.trigger ?? DEFAULTS.trigger
    const threshold = context * trigger
    const isOver = count > threshold

    log.info("COLLAPSE isOverflow", {
      tokenCount: count,
      contextLimit: context,
      trigger,
      threshold: Math.floor(threshold),
      isOver,
      input: input.tokens.input,
      cacheRead: input.tokens.cache.read,
      cacheWrite: input.tokens.cache.write,
      output: input.tokens.output,
    })

    return isOver
  }

  /**
   * Collapse compaction: Extract oldest messages, distill with AI, insert summary at breakpoint.
   * Messages before the breakpoint are filtered out by filterCompacted().
   */
  export async function process(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
    compactionModel?: { providerID: string; modelID: string }
    overflow?: boolean
  }): Promise<"continue" | "stop"> {
    const config = await Config.get()
    const extractRatio = config.compaction?.extractRatio ?? DEFAULTS.extractRatio
    const recentRatio = config.compaction?.recentRatio ?? DEFAULTS.recentRatio
    const summaryMaxTokens = config.compaction?.summaryMaxTokens ?? DEFAULTS.summaryMaxTokens
    const previousSummariesLimit = config.compaction?.previousSummaries ?? DEFAULTS.previousSummaries
    const splitChain = config.compaction?.splitChain ?? DEFAULTS.splitChain
    const splitChainMinThreshold = config.compaction?.splitChainMinThreshold ?? DEFAULTS.splitChainMinThreshold

    const method = await getMethod()
    log.info("COLLAPSE begin", {
      sessionID: input.sessionID,
      method,
      auto: input.auto,
      splitChain,
      messages: input.messages.length,
      parentID: input.parentID,
    })

    // Get the user message to determine which model we'll use
    const originalUserMessage = input.messages.findLast((m) => m.info.id === input.parentID)!.info as MessageV2.User
    const agent = await Agent.get("compaction")
    // Model resolution priority: TUI compactionModel override > agent.compaction.model config > session model
    const model = input.compactionModel
      ? await Provider.getModel(input.compactionModel.providerID, input.compactionModel.modelID)
      : agent.model
        ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
        : await Provider.getModel(originalUserMessage.model.providerID, originalUserMessage.model.modelID)

    // Calculate token counts and role counts
    let messageTokens: number[] = []
    let totalTokens = 0
    let userCount = 0
    let assistantCount = 0
    // Track tokens saved by inline sub-collapse so the final token adjustment
    // accounts for BOTH the sub-collapse savings AND the main collapse extract.
    // Without this, extractedTokens only covers the (tiny) post-sub-collapse
    // extract range, and isOverflow still sees high token counts on the next loop.
    let subCollapseSavedTokens = 0
    for (const msg of input.messages) {
      const estimate = estimateMessageTokens(msg)
      messageTokens.push(estimate)
      totalTokens += estimate
      if (msg.info.role === "user") userCount++
      else if (msg.info.role === "assistant") assistantCount++
    }

    // Check if first message is a breakpoint (existing compaction) or new conversation
    const firstMessage = input.messages[0]
    const isBreakpoint =
      firstMessage?.info.role === "assistant" && (firstMessage.info as MessageV2.Assistant).mode === "compaction"

    log.info("COLLAPSE context analysis", {
      sessionID: input.sessionID,
      messages: input.messages.length,
      tokens: totalTokens,
      user: userCount,
      assistant: assistantCount,
      firstMessageId: firstMessage?.info.id,
      chainType: isBreakpoint ? "breakpoint" : "new",
      splitChain,
    })

    // Calculate extraction targets
    let extractTarget = Math.floor(totalTokens * extractRatio)
    let recentTarget = Math.floor(totalTokens * recentRatio)

    log.debug("COLLAPSE extraction targets", {
      sessionID: input.sessionID,
      extractRatio,
      extractTarget,
      recentRatio,
      recentTarget,
      totalTokens,
    })

    /**
     * Helper: if message at index has a parentID pointing to an earlier message,
     * return the parent's index. Always checks regardless of splitChain — the
     * caller decides what to do with the result based on splitChain and threshold.
     */
    function findChainStart(index: number): number | undefined {
      if (index <= 0 || index >= input.messages.length) return undefined
      const msg = input.messages[index]
      if (msg.info.role !== "assistant") return undefined
      const parentID = (msg.info as MessageV2.Assistant).parentID
      if (!parentID) return undefined
      const parentIndex = input.messages.findIndex((m) => m.info.id === parentID)
      if (parentIndex >= 0 && parentIndex < index) return parentIndex
      return undefined
    }

    /**
     * Helper: if message at index has a parentID, return the parent's index.
     * Respects splitChain: returns undefined when splitChain=true (allowing mid-chain splits).
     * Used for the recent split boundary which does NOT have a min-threshold fallback.
     */
    function findChainStartRespectingSplit(index: number): number | undefined {
      if (splitChain) return undefined
      return findChainStart(index)
    }

    // Find split points
    let extractedTokens = 0
    let extractSplitIndex = 0
    for (let i = 0; i < input.messages.length; i++) {
      if (extractedTokens >= extractTarget) break
      extractedTokens += messageTokens[i]
      extractSplitIndex = i + 1
    }

    log.debug("COLLAPSE initial extract split", {
      sessionID: input.sessionID,
      extractSplitIndex,
      extractedTokens,
      extractTarget,
      splitAtMessageId: input.messages[extractSplitIndex]?.info.id,
      splitAtRole: input.messages[extractSplitIndex]?.info.role,
      splitAtParentID:
        input.messages[extractSplitIndex]?.info.role === "assistant"
          ? (input.messages[extractSplitIndex].info as MessageV2.Assistant).parentID
          : undefined,
    })

    // Ensure extract split is not in the middle of a chain (unless splitChain=true
    // AND the rewind would not meet the min threshold).
    //
    // Algorithm:
    // 1. Always check for a blocking chain at the extract boundary
    // 2. If blocking: compute how many tokens the rewind would yield
    // 3. If rewound tokens >= splitChainMinThreshold * extractTarget: accept the rewind
    // 4. If rewound tokens < threshold AND splitChain=true: keep mid-chain split (Fix 2)
    // 5. If rewound tokens < threshold AND splitChain=false: attempt sub-collapse
    const originalExtractSplitIndex = extractSplitIndex
    const extractChainStart = findChainStart(extractSplitIndex)

    // Run chain detection here so we can log the full chain landscape regardless
    // of whether splitChain is true or false. This helps diagnose mid-chain splits.
    const allChains = detectChains(input.messages)
    log.debug("COLLAPSE chain landscape at extract boundary", {
      sessionID: input.sessionID,
      splitChain,
      splitChainMinThreshold,
      extractSplitIndex,
      extractChainStart: extractChainStart ?? "(none - no chain at boundary)",
      totalChains: allChains.length,
      chains: allChains.map((c) => ({
        userIndex: c.userMessageIndex,
        userId: c.userMessageId,
        assistantCount: c.assistantMessageIndices.length,
        firstAssistantIdx: c.assistantMessageIndices[0],
        lastAssistantIdx: c.assistantMessageIndices[c.assistantMessageIndices.length - 1],
        tokens: c.chainTokens,
        containsExtractBoundary:
          c.userMessageIndex <= extractSplitIndex &&
          (c.assistantMessageIndices[c.assistantMessageIndices.length - 1] ?? c.userMessageIndex) >= extractSplitIndex,
      })),
    })
    if (extractChainStart !== undefined) {
      // Compute tokens that the rewind-to-chain-start would yield
      let rewoundTokens = 0
      for (let i = 0; i < extractChainStart; i++) rewoundTokens += messageTokens[i]
      const minRequired = splitChainMinThreshold * extractTarget
      const rewindMeetsThreshold = rewoundTokens >= minRequired

      log.info("COLLAPSE extract split lands in chain, evaluating options", {
        sessionID: input.sessionID,
        originalIndex: extractSplitIndex,
        chainStart: extractChainStart,
        extractedTokens,
        rewoundTokens,
        minRequired,
        rewindMeetsThreshold,
        splitChain,
      })

      if (rewindMeetsThreshold) {
        // Rewind is good enough — accept chain boundary, behave like splitChain=false
        log.info("COLLAPSE rewinding to chain boundary (meets threshold)", {
          sessionID: input.sessionID,
          extractSplitIndex,
          chainStart: extractChainStart,
          rewoundTokens,
          minRequired,
        })
        for (let i = extractChainStart; i < extractSplitIndex; i++) {
          extractedTokens -= messageTokens[i]
        }
        extractSplitIndex = extractChainStart
      } else if (!splitChain) {
        // Rewind doesn't meet threshold AND splitChain=false: attempt sub-collapse
        const chains = detectChains(input.messages)
        const blockingChain = chains.find(
          (c) => c.userMessageIndex === extractChainStart || c.allMessageIndices.includes(extractChainStart),
        )

        if (blockingChain && blockingChain.assistantMessageIndices.length >= 2) {
          log.info("COLLAPSE sub-collapsing blocking chain before extract", {
            sessionID: input.sessionID,
            chainUserIndex: blockingChain.userMessageIndex,
            chainUserMessageId: blockingChain.userMessageId,
            assistantCount: blockingChain.assistantMessageIndices.length,
            chainTokens: blockingChain.chainTokens,
          })

          const subResult = await executeSubCollapse({
            sessionID: input.sessionID,
            messages: input.messages,
            chain: blockingChain,
            abort: input.abort,
          })

          if (subResult.status === "success") {
            log.info("COLLAPSE blocking chain sub-collapsed, reloading and fixing extract range", {
              sessionID: input.sessionID,
              summaryMessageId: subResult.summaryMessageId,
              chainUserMessageId: subResult.chainUserMessageId,
              summaryTokens: subResult.summaryTokens,
            })

            subCollapseSavedTokens = blockingChain.chainTokens - (subResult.summaryTokens ?? 0)
            log.info("COLLAPSE sub-collapse saved tokens", {
              sessionID: input.sessionID,
              chainTokens: blockingChain.chainTokens,
              summaryTokens: subResult.summaryTokens,
              savedTokens: subCollapseSavedTokens,
            })

            const filteredMessages = await MessageV2.filterCompacted(MessageV2.stream(input.sessionID))
            const summaryIdx = filteredMessages.findIndex(
              (m: MessageV2.WithParts) => m.info.id === subResult.summaryMessageId,
            )

            if (summaryIdx >= 0) {
              input.messages = filteredMessages
              extractSplitIndex = summaryIdx + 1
              messageTokens = input.messages.map((m) => estimateMessageTokens(m))
              totalTokens = messageTokens.reduce((a, b) => a + b, 0)
              extractedTokens = 0
              for (let i = 0; i < extractSplitIndex; i++) extractedTokens += messageTokens[i]
              extractTarget = Math.floor(totalTokens * extractRatio)
              recentTarget = Math.floor(totalTokens * recentRatio)
              log.info("COLLAPSE extract range fixed after sub-collapse", {
                sessionID: input.sessionID,
                extractSplitIndex,
                extractedTokens,
                totalMessages: input.messages.length,
                totalTokens,
              })
            } else {
              log.warn("COLLAPSE could not find sub-collapse summary in reloaded messages, returning continue", {
                sessionID: input.sessionID,
                summaryMessageId: subResult.summaryMessageId,
              })
              return "continue"
            }
          } else {
            log.error("COLLAPSE blocking chain sub-collapse failed, falling back to rewind", {
              sessionID: input.sessionID,
            })
            for (let i = extractChainStart; i < extractSplitIndex; i++) extractedTokens -= messageTokens[i]
            extractSplitIndex = extractChainStart
          }
        } else {
          // No suitable chain for sub-collapse, rewind anyway
          for (let i = extractChainStart; i < extractSplitIndex; i++) extractedTokens -= messageTokens[i]
          extractSplitIndex = extractChainStart
        }
      } else {
        // splitChain=true and rewind doesn't meet threshold: keep mid-chain split (Fix 2)
        log.info("COLLAPSE keeping mid-chain split (rewind below threshold, splitChain=true)", {
          sessionID: input.sessionID,
          extractSplitIndex,
          chainStart: extractChainStart,
          rewoundTokens,
          minRequired,
        })
        // splitChain mid-chain split: beforeId will be set below in the splitChain block
      }
    }

    let recentTokens = 0
    let recentSplitIndex = input.messages.length
    for (let i = input.messages.length - 1; i >= 0; i--) {
      if (recentTokens >= recentTarget) break
      recentTokens += messageTokens[i]
      recentSplitIndex = i
    }

    log.debug("COLLAPSE initial recent split", {
      sessionID: input.sessionID,
      recentSplitIndex,
      recentTokens,
      recentTarget,
    })

    // Ensure recent split is not in the middle of a chain (unless splitChain=true)
    const recentChainStart = findChainStartRespectingSplit(recentSplitIndex)
    if (recentChainStart !== undefined) {
      log.info("COLLAPSE adjusting recent split for chain boundary", {
        sessionID: input.sessionID,
        originalIndex: recentSplitIndex,
        adjustedIndex: recentChainStart,
      })
      for (let i = recentChainStart; i < recentSplitIndex; i++) {
        recentTokens += messageTokens[i]
      }
      recentSplitIndex = recentChainStart
    }

    // Ensure recent split doesn't overlap with extract
    if (recentSplitIndex <= extractSplitIndex) {
      log.debug("COLLAPSE recent/extract overlap, adjusting", {
        sessionID: input.sessionID,
        recentSplitIndex,
        extractSplitIndex,
      })
      recentSplitIndex = extractSplitIndex
    }

    const extractedMessages = input.messages.slice(0, extractSplitIndex)
    const middleMessages = input.messages.slice(extractSplitIndex, recentSplitIndex)
    const recentReferenceMessages = input.messages.slice(recentSplitIndex)

    // Calculate middle section tokens
    let middleTokens = 0
    for (let i = extractSplitIndex; i < recentSplitIndex; i++) {
      middleTokens += messageTokens[i]
    }

    log.info("COLLAPSE split result", {
      sessionID: input.sessionID,
      total: { messages: input.messages.length, tokens: totalTokens },
      extract: {
        messages: extractedMessages.length,
        tokens: extractedTokens,
        range: `[0..${extractSplitIndex - 1}]`,
        lastMsgId: extractedMessages[extractedMessages.length - 1]?.info.id,
        lastMsgRole: extractedMessages[extractedMessages.length - 1]?.info.role,
      },
      middle: {
        messages: middleMessages.length,
        tokens: middleTokens,
        range: `[${extractSplitIndex}..${recentSplitIndex - 1}]`,
      },
      recent: {
        messages: recentReferenceMessages.length,
        tokens: recentTokens,
        range: `[${recentSplitIndex}..${input.messages.length - 1}]`,
      },
      splitChain,
      midChainSplit:
        extractedMessages.length > 0 &&
        extractedMessages[extractedMessages.length - 1].info.role === "assistant" &&
        middleMessages.length > 0 &&
        middleMessages[0].info.role === "assistant" &&
        (middleMessages[0].info as MessageV2.Assistant).parentID ===
          (extractedMessages[extractedMessages.length - 1].info as MessageV2.Assistant).parentID,
    })

    if (extractedMessages.length === 0) {
      // Chain rewind eliminated the entire extract range and sub-collapse either
      // was not applicable or already failed above. Stop to prevent infinite loop.
      log.info("COLLAPSE skipped - no messages to extract after chain handling", {
        sessionID: input.sessionID,
      })
      return "stop"
    }

    // Convert extracted messages to markdown for distillation
    const markdownContent = messagesToMarkdown(extractedMessages)
    const recentContext = messagesToMarkdown(recentReferenceMessages)

    // Build base prompt (without previous summaries) to calculate token budget
    const markdownTokens = Token.estimate(markdownContent)
    const recentTokensEstimate = Token.estimate(recentContext)
    const templateTokens = Token.estimate(collapseInstructions())
    const basePromptTokens = markdownTokens + recentTokensEstimate + templateTokens
    const contextLimit = model.limit.context
    const outputReserve = ProviderTransform.maxOutputTokens(model)
    const previousSummaryBudget = Math.max(0, contextLimit - outputReserve - basePromptTokens)

    // Fetch previous summaries that fit within budget
    const previousSummaries = await getPreviousSummaries(input.sessionID, previousSummariesLimit, previousSummaryBudget)

    // Get the last extracted message to determine breakpoint position
    const lastExtractedMessage = extractedMessages[extractedMessages.length - 1]
    let afterId = lastExtractedMessage.info.id
    let beforeId: string | undefined
    let breakpointTimestamp = lastExtractedMessage.info.time.created + 1

    log.debug("COLLAPSE breakpoint initial position", {
      sessionID: input.sessionID,
      lastExtractedId: lastExtractedMessage.info.id,
      afterId,
      breakpointTimestamp,
    })

    // When splitChain is false, check if any message after the split has a parentID
    // (is part of a chain). If so, the compaction must sort BEFORE that parent to
    // keep the chain together.
    //
    // When splitChain is true, the breakpoint stays where the token walk placed it
    // (mid-chain). The next message after the split becomes the beforeId anchor so
    // Identifier.insert produces an ID that sorts correctly between the two messages.
    if (splitChain) {
      // Mid-chain split: anchor the breakpoint between lastExtractedMessage and
      // the first message remaining in context
      const firstRemaining = input.messages[extractSplitIndex]
      if (firstRemaining) {
        beforeId = firstRemaining.info.id
      }
      log.info("COLLAPSE splitChain=true, breakpoint stays mid-chain", {
        sessionID: input.sessionID,
        afterId,
        beforeId: beforeId ?? "(none)",
        breakpointTimestamp,
      })
    } else {
      const messagesAfterSplit = input.messages.slice(extractSplitIndex)
      for (const msg of messagesAfterSplit) {
        if (msg.info.role === "assistant") {
          const parentID = (msg.info as MessageV2.Assistant).parentID
          if (parentID) {
            // Find the message that sorts just before the parent
            // Use direct string comparison (not localeCompare) for consistent case-sensitive ordering
            const sortedMessages = [...input.messages].sort((a, b) =>
              a.info.id < b.info.id ? -1 : a.info.id > b.info.id ? 1 : 0,
            )
            const parentIndex = sortedMessages.findIndex((m) => m.info.id === parentID)

            if (parentIndex > 0) {
              afterId = sortedMessages[parentIndex - 1].info.id
              beforeId = parentID

              const parent = input.messages.find((m) => m.info.id === parentID)
              if (parent) {
                breakpointTimestamp = parent.info.time.created - 1
              }

              log.info("COLLAPSE breakpoint adjusted for chain protection", {
                sessionID: input.sessionID,
                chainMessageId: msg.info.id,
                parentID,
                afterId,
                beforeId,
                newTimestamp: breakpointTimestamp,
              })
            }
            break
          }
        }
      }
    }

    // Create compaction user message - sorts after afterId, and before beforeId if possible
    const compactionUserId = Identifier.insert(afterId, beforeId, "message")
    const compactionUserTimestamp = breakpointTimestamp

    log.info("COLLAPSE inserting breakpoint", {
      sessionID: input.sessionID,
      splitChain,
      afterId,
      afterIdRole: input.messages.find((m) => m.info.id === afterId)?.info.role,
      afterIdIndex: input.messages.findIndex((m) => m.info.id === afterId),
      beforeId: beforeId ?? "(none)",
      beforeIdRole: beforeId ? input.messages.find((m) => m.info.id === beforeId)?.info.role : undefined,
      beforeIdIndex: beforeId ? input.messages.findIndex((m) => m.info.id === beforeId) : undefined,
      breakpointId: compactionUserId,
      breakpointTimestamp: compactionUserTimestamp,
      extractSplitIndex,
      extractedTokens,
      totalMessages: input.messages.length,
    })

    const compactionUserMsg = await Session.updateMessage({
      id: compactionUserId,
      role: "user",
      model: originalUserMessage.model,
      sessionID: input.sessionID,
      agent: originalUserMessage.agent,
      time: {
        created: compactionUserTimestamp,
      },
    })
    await Session.updatePart({
      id: Identifier.insert(compactionUserId, undefined, "part"),
      messageID: compactionUserMsg.id,
      sessionID: input.sessionID,
      type: "compaction",
      auto: input.auto,
    })

    // Create assistant summary message - sorts after compaction user, before beforeId if possible
    const compactionAssistantId = Identifier.insert(compactionUserId, beforeId, "message")
    const compactionAssistantTimestamp = compactionUserTimestamp + 1

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
        created: compactionAssistantTimestamp,
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

    // Load knowledge packs from session for compaction context
    const knowledgePacks = await KnowledgePack.loadFromSession(input.sessionID)

    // Instructions
    sections.push(collapseInstructions(summaryMaxTokens, knowledgePacks))

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

    if (processor.message.error) {
      log.error("COLLAPSE processor error", { sessionID: input.sessionID, error: processor.message.error })
      return "stop"
    }

    log.info("COLLAPSE summary generated", {
      sessionID: input.sessionID,
      summaryTokens: processor.message.tokens.output,
      summaryInputTokens: processor.message.tokens.input,
    })

    // Fix 1: When splitChain=true and the extract boundary landed mid-chain,
    // assistant messages after the split still have parentID pointing to the
    // original chain's user message (now behind the compaction wall).
    // detectChains cannot find them as a chain because their user parent is gone.
    //
    // Solution: insert a duplicate of the original chain's user message just
    // before the orphaned tail (between compactionAssistantId and firstRemaining),
    // then re-parent all orphaned assistants to this new duplicate user message.
    // detectChains will then start from the duplicate user message and walk the
    // full orphaned tail as a proper chain, making it eligible for float sub-collapse.
    if (splitChain && extractSplitIndex < input.messages.length) {
      const firstRemaining = input.messages[extractSplitIndex]
      if (firstRemaining && firstRemaining.info.role === "assistant") {
        const firstRemainingInfo = firstRemaining.info as MessageV2.Assistant
        // Only act if the orphaned tail's parent is in the extracted range
        const originalUserMsg = extractedMessages.find((m) => m.info.id === firstRemainingInfo.parentID)
        if (originalUserMsg && originalUserMsg.info.role === "user") {
          // Insert duplicate user message between compaction summary and first orphaned assistant
          const duplicateUserMsgId = await Session.copyUserMessage({
            sessionID: input.sessionID,
            source: originalUserMsg,
            afterId: compactionAssistantId,
            beforeId: firstRemaining.info.id,
          })
          // Re-parent all orphaned assistants (those after the compaction breakpoint
          // that still point to the original chain user message) to the new duplicate
          const breakpointTimestamp = input.messages[extractSplitIndex - 1]?.info.time.created ?? 0
          await Session.reparentChain({
            sessionID: input.sessionID,
            oldParentID: originalUserMsg.info.id,
            newParentID: duplicateUserMsgId,
            afterTimestamp: breakpointTimestamp,
          })
          log.info("COLLAPSE mid-chain split: inserted duplicate user anchor and re-parented orphaned tail", {
            sessionID: input.sessionID,
            originalUserMsgId: originalUserMsg.info.id,
            duplicateUserMsgId,
            firstRemainingId: firstRemaining.info.id,
            breakpointTimestamp,
          })
        }
      }
    }

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
      const collapseSummaryTokens = processor.message.tokens.output

      const currentTotal =
        lastAssistant.info.tokens.input +
        lastAssistant.info.tokens.cache.read +
        lastAssistant.info.tokens.cache.write +
        lastAssistant.info.tokens.output

      // extractedTokens covers the main collapse extract range. When a sub-collapse
      // ran inline before the main collapse, subCollapseSavedTokens captures the
      // additional tokens removed by deleting the chain's assistant messages.
      // Both must be subtracted from currentTotal so isOverflow sees the true
      // post-compaction token count on the next loop iteration.
      const totalExtracted = extractedTokens + subCollapseSavedTokens
      const newTotal = Math.max(0, currentTotal - totalExtracted + collapseSummaryTokens)

      log.info("COLLAPSE token adjustment", {
        sessionID: input.sessionID,
        lastAssistantId: lastAssistant.info.id,
        extractedTokens,
        subCollapseSavedTokens,
        totalExtracted,
        summaryTokens: collapseSummaryTokens,
        previousTotal: currentTotal,
        newTotal,
        reduction: currentTotal - newTotal,
      })

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
    }

    // Count messages in the compacted chain (after compaction)
    const remainingMessages = input.messages.length - extractedMessages.length + 2 // +2 for compaction user/assistant
    const remainingUser = userCount - extractedMessages.filter((m) => m.info.role === "user").length + 1
    const remainingAssistant = assistantCount - extractedMessages.filter((m) => m.info.role === "assistant").length + 1

    log.info("COLLAPSE complete", {
      sessionID: input.sessionID,
      method,
      auto: input.auto,
      splitChain,
      midChainSplit:
        extractSplitIndex > 0 &&
        extractedMessages.length > 0 &&
        extractedMessages[extractedMessages.length - 1].info.role === "assistant" &&
        (input.messages[extractSplitIndex]?.info as MessageV2.Assistant | undefined)?.parentID ===
          (extractedMessages[extractedMessages.length - 1].info as MessageV2.Assistant).parentID,
      extracted: { messages: extractedMessages.length, tokens: extractedTokens },
      summary: { tokens: processor.message.tokens.output },
      subCollapseSavedTokens,
      tokenReduction: extractedTokens + subCollapseSavedTokens - processor.message.tokens.output,
      remaining: { messages: remainingMessages, user: remainingUser, assistant: remainingAssistant },
      breakpointId: compactionUserMsg.id,
      result: input.auto ? "continue" : "stop",
    })

    // Delete the original trigger message (created by create()) to prevent
    // the loop from picking it up again as a pending compaction task.
    // The trigger is the message at input.parentID - we've created a new
    // compaction user message at the breakpoint position.
    // IMPORTANT: Only delete if parentID is actually a compaction trigger (has compaction part)
    // In insertTriggers=false mode (collapse), parentID is the real user message!
    if (input.parentID !== compactionUserMsg.id) {
      const parentMsg = input.messages.find((m) => m.info.id === input.parentID)
      const isCompactionTrigger = parentMsg?.parts.some((p) => p.type === "compaction")

      if (isCompactionTrigger) {
        log.info("COLLAPSE cleanup trigger message", { sessionID: input.sessionID, id: input.parentID })
        // Delete parts first
        if (parentMsg) {
          for (const part of parentMsg.parts) {
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
      } else {
        log.debug("COLLAPSE skipping cleanup - parentID is real user message", {
          sessionID: input.sessionID,
          id: input.parentID,
        })
      }
    }

    // Convergence guard: if the collapse summary is at least as large as what was
    // extracted, compaction made no progress. Returning "continue" would re-trigger
    // the same overflow, creating an infinite loop. Return "stop" instead.
    const collapseSummaryTokens = processor.message.tokens.output
    log.debug("COLLAPSE convergence check", {
      sessionID: input.sessionID,
      collapseSummaryTokens,
      extractedTokens,
      subCollapseSavedTokens,
      totalExtracted: extractedTokens + subCollapseSavedTokens,
      netReduction: extractedTokens - collapseSummaryTokens,
      converging: collapseSummaryTokens < extractedTokens,
      splitChain,
      extractSplitIndex,
      totalMessages: input.messages.length,
    })
    if (collapseSummaryTokens >= extractedTokens) {
      log.warn("COLLAPSE summary larger than extracted content, stopping to prevent loop", {
        sessionID: input.sessionID,
        collapseSummaryTokens,
        extractedTokens,
        splitChain,
      })
      return "stop"
    }

    // For auto-compaction: return "continue" so the loop continues processing.
    // - If parentID was a trigger (insertTriggers=true), it's now deleted and the loop
    //   will find the real user message and respond to it.
    // - If parentID was the real user message (insertTriggers=false), the loop will
    //   continue with the updated context after compaction.
    // For manual compaction: return "stop" - user explicitly requested compaction only.

    if (input.auto) {
      return "continue"
    }
    return "stop"
  }

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
   * Fetch previous compaction summaries from the session.
   * Only returns summaries that are true compaction breakpoint summaries
   * (parent message has a compaction part), not sub-collapse summaries.
   * Respects token budget to avoid overflowing context window.
   */
  async function getPreviousSummaries(sessionID: string, limit: number, tokenBudget: number): Promise<string[]> {
    const allMessages = await Session.messages({ sessionID })

    // Build a set of message IDs that have compaction parts (are breakpoints)
    const breakpointMessageIds = new Set<string>()
    for (const msg of allMessages) {
      if (msg.parts.some((p) => p.type === "compaction")) {
        breakpointMessageIds.add(msg.info.id)
      }
    }

    log.debug("COLLAPSE getPreviousSummaries breakpoints found", {
      sessionID,
      breakpointCount: breakpointMessageIds.size,
      breakpointIds: Array.from(breakpointMessageIds),
    })

    // Filter to assistant summaries whose parent is a compaction breakpoint
    const summaryMessages = allMessages
      .filter(
        (m): m is MessageV2.WithParts & { info: MessageV2.Assistant } =>
          m.info.role === "assistant" &&
          (m.info as MessageV2.Assistant).summary === true &&
          (m.info as MessageV2.Assistant).finish !== undefined &&
          // Parent must be a compaction breakpoint (has compaction part)
          breakpointMessageIds.has((m.info as MessageV2.Assistant).parentID),
      )
      .sort((a, b) => a.info.time.created - b.info.time.created) // oldest first
      .slice(-limit) // take the N most recent

    log.debug("COLLAPSE getPreviousSummaries filtered", {
      sessionID,
      totalMessages: allMessages.length,
      summaryCount: summaryMessages.length,
      summaryIds: summaryMessages.map((m) => m.info.id),
    })

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

  // ===========================================================================
  // FLOAT MODE: Sub-collapse implementation
  // ===========================================================================

  /**
   * Detect all chains in the message list.
   * A chain is a user message followed by 2+ consecutive assistant messages
   * that reference back to the user message via parentID.
   *
   * Single user + single assistant pairs are NOT considered chains (simple Q&A).
   * Only groups with 2+ assistant messages are worth sub-collapsing.
   */
  export function detectChains(messages: MessageV2.WithParts[]): ChainInfo[] {
    const chains: ChainInfo[] = []
    let i = 0

    while (i < messages.length) {
      const msg = messages[i]

      // Look for user messages (start of potential chains)
      if (msg.info.role === "user") {
        // Skip compaction trigger messages
        const isCompactionTrigger = msg.parts.some((p) => p.type === "compaction")
        if (isCompactionTrigger) {
          i++
          continue
        }

        log.info("COLLAPSE detectChains chain start", {
          userIdx: i,
          userId: msg.info.id,
        })

        const chain: ChainInfo = {
          userMessageIndex: i,
          assistantMessageIndices: [],
          allMessageIndices: [i],
          chainTokens: estimateMessageTokens(msg),
          userMessageId: msg.info.id,
        }

        // Walk forward looking for assistant messages that belong to this chain.
        // Track all user message IDs that are part of this chain so assistant messages
        // parented to mid-run user interjections are still recognized as belonging here.
        const chainUserIds = new Set<string>([msg.info.id])

        for (let j = i + 1; j < messages.length; j++) {
          const next = messages[j]
          if (next.info.role === "assistant") {
            const nextInfo = next.info as MessageV2.Assistant

            // Skip messages that are already sub-collapse summaries (summary: true) or
            // already soft-deleted (flux: "compacted"). These must not be included in
            // assistantMessageIndices — the soft-delete loop in executeSubCollapse
            // would otherwise re-mark already-processed summaries as flux="compacted"
            // on every subsequent sub-collapse run.
            if (nextInfo.summary || nextInfo.flux) {
              // Still part of this chain's ID range (same parent) but should not be
              // included in allMessageIndices for the sub-collapse scope — include
              // only in the chain walk so we don't break the chain traversal.
              const parentID = nextInfo.parentID
              if (
                parentID &&
                (chainUserIds.has(parentID) ||
                  chain.assistantMessageIndices.some((idx) => messages[idx].info.id === parentID))
              ) {
                // Part of this chain but already processed — skip adding to indices
                continue
              } else {
                break
              }
            }

            // Check if this assistant message belongs to the chain
            // (has parentID pointing to any user message in the chain or previous assistant)
            const parentID = nextInfo.parentID

            if (
              parentID &&
              (chainUserIds.has(parentID) ||
                chain.assistantMessageIndices.some((idx) => messages[idx].info.id === parentID))
            ) {
              chain.assistantMessageIndices.push(j)
              chain.allMessageIndices.push(j)
              chain.chainTokens += estimateMessageTokens(next)
            } else {
              // Assistant message with different parent, not part of this chain
              break
            }
          } else if (next.info.role === "user") {
            // A compaction trigger user message ends the chain
            if (next.parts.some((p) => p.type === "compaction")) break

            // Only treat as a mid-run user interjection if the immediately preceding
            // message is an assistant still in a tool-calls sequence. If the prior
            // message is a stop/end-turn assistant, a summary, or another user message,
            // this is a new independent turn — end the chain.
            const prev = messages[j - 1]
            const prevInfo = prev?.info.role === "assistant" ? (prev.info as MessageV2.Assistant) : null
            const isInterjection = !!prevInfo && prevInfo.finish === "tool-calls"
            log.info("COLLAPSE detectChains user boundary", {
              userIdx: j,
              userId: next.info.id,
              prevRole: prev?.info.role,
              prevFinish: prevInfo?.finish,
              isInterjection,
            })
            if (!isInterjection) break

            chainUserIds.add(next.info.id)
            chain.allMessageIndices.push(j)
            chain.chainTokens += estimateMessageTokens(next)
          }
        }

        // Only count as a chain if there are 2+ assistant responses
        // Single user + single assistant is just a simple Q&A, not a chain worth collapsing
        log.info("COLLAPSE detectChains chain end", {
          userIdx: i,
          userId: chain.userMessageId,
          assistants: chain.assistantMessageIndices.length,
          valid: chain.assistantMessageIndices.length >= 2,
        })
        if (chain.assistantMessageIndices.length >= 2) {
          chains.push(chain)
        }

        // Move past the chain (or single Q&A pair)
        const lastIdx =
          chain.assistantMessageIndices.length > 0
            ? chain.allMessageIndices[chain.allMessageIndices.length - 1] + 1
            : i + 1
        i = lastIdx
      } else {
        i++
      }
    }

    return chains
  }

  /**
   * Check if float mode should trigger sub-collapse.
   * Returns the oldest chain that should be sub-collapsed, or null if none.
   */
  export async function shouldFloatSubCollapse(
    messages: MessageV2.WithParts[],
    sessionID: string,
  ): Promise<ChainInfo | null> {
    const config = await Config.get()
    const floatConfig = config.compaction?.float
    const chainThreshold = floatConfig?.chainThreshold ?? DEFAULTS.float.chainThreshold

    const chains = detectChains(messages)

    log.info("COLLAPSE float mode check", {
      sessionID,
      chainCount: chains.length,
      chainThreshold,
      shouldSubCollapse: chains.length > chainThreshold,
      chains: chains.map((c, i) => ({
        index: i,
        userIdx: c.userMessageIndex,
        userId: c.userMessageId,
        assistants: c.assistantMessageIndices.length,
        firstAssistantIdx: c.assistantMessageIndices[0],
        lastAssistantIdx: c.assistantMessageIndices[c.assistantMessageIndices.length - 1],
        tokens: c.chainTokens,
      })),
    })

    if (chains.length > chainThreshold) {
      // Return the oldest chain (first in the list) for sub-collapse
      const oldestChain = chains[0]
      log.info("COLLAPSE float mode triggering sub-collapse on oldest chain", {
        sessionID,
        chainIndex: 0,
        userMessageIndex: oldestChain.userMessageIndex,
        userMessageId: oldestChain.userMessageId,
        assistantCount: oldestChain.assistantMessageIndices.length,
        chainTokens: oldestChain.chainTokens,
      })
      return oldestChain
    }

    return null
  }

  /**
   * Build the sub-collapse prompt for a specific chain.
   * Uses the bookend algorithm approach from FluxCapacitor.
   */
  function buildSubCollapsePrompt(
    messages: MessageV2.WithParts[],
    chain: ChainInfo,
    previousSummaries: string[],
    algorithm: SubCollapseAlgorithm,
    tokenTarget: number,
    knowledgePacks?: { name: string; text: string }[],
  ): string {
    // Get the user message
    const userMsg = messages[chain.userMessageIndex]
    const userContent = messagesToMarkdown([userMsg])

    // Get the final assistant message (contains conclusions)
    const lastAssistantIdx = chain.assistantMessageIndices[chain.assistantMessageIndices.length - 1]
    const lastAssistantMsg = messages[lastAssistantIdx]
    const finalAssistantText = extractTextOnly(lastAssistantMsg)

    // Gather tool outputs with timing
    const toolOutputs = gatherToolOutputsForChain(messages, chain)

    const sections: string[] = []

    // Template based on algorithm
    if (algorithm === "bookend" || algorithm === "full") {
      sections.push(`You are producing a settled, conflict-free record of what was accomplished in a multi-turn assistant work session.

The assistant worked through a request over multiple turns -- reading files, running commands, writing code, debugging, making decisions, and sometimes changing direction when the user gave corrections. Your job is to produce the FINAL SETTLED STATE: what is true NOW, after all corrections and reversals have been applied.

CRITICAL CONTEXT: After this extraction, the conversation will contain:
- The user's original message (preserved as-is, not deleted)
- Any earlier breakpoint summaries (preserved as-is, not deleted)
- YOUR OUTPUT (replaces all the assistant's multi-turn work)

Because the user message and earlier summaries remain in the conversation, your output must NOT repeat or restate their content. That information is already there. Your output captures ONLY what the assistant uniquely produced.

RESOLUTION RULE: If the work contains contradictions or reversals (the user corrected course, an approach was abandoned, a file was replaced), resolve them. Output only the final settled state as positive, direct statements. Do not mention what was tried and rejected. Do not include both sides of a reversal. If the bench script ended up as bench.py, state that -- do not also mention that bench was previously in the gb CLI.

Target length: approximately ${tokenTarget} tokens`)

      if (previousSummaries.length > 0) {
        sections.push(`## Earlier Summaries (REFERENCE ONLY -- this content is already preserved, do NOT repeat it)
${previousSummaries.join("\n\n---\n\n")}`)
      }

      sections.push(`## User Request (REFERENCE ONLY -- this message is already preserved, do NOT repeat it)
${userContent}`)

      sections.push(`## Final Assistant Response
${finalAssistantText}`)

      sections.push(`## Work Timeline
${toolOutputs}`)

      const kpInstructions =
        knowledgePacks && knowledgePacks.length > 0
          ? `\n\nKnowledge Packs (PERSISTENT -- always present in every conversation, never compacted):
${knowledgePacks.map((kp) => `- ${kp.name}`).join("\n")}
Do NOT include content already covered by these knowledge packs -- it will always be injected and wastes summary tokens.
EXCEPTION: If this chain explicitly overrides or contradicts a knowledge pack instruction, capture that override precisely -- name the pack and state what changed.`
          : ""

      sections.push(`## Extraction Instructions

From the work timeline and final response above, produce the final settled state under these headings (omit any heading with no content):

1. **Final artifacts** -- code that was written or modified (verbatim in fenced blocks), files created, configurations applied. Show only the final version -- do not include earlier versions that were replaced.
2. **How things work now** -- the approach that is currently in place, tools and commands to use, standing patterns. State these as direct instructions ("use X", "run Y", "the script lives at Z"), not as a history of decisions.
3. **Non-obvious discoveries** -- error workarounds, environment-specific behaviors, API quirks, gotchas that would be painful to rediscover.
4. **Current state** -- what is complete, what is pending, what is broken. State each item as a direct fact.

DISCARD everything else:
- Anything that was tried and then replaced or corrected -- only show the final result
- Debugging steps and their output (unless the finding is non-obvious and critical)
- File reads and exploration that informed decisions
- Anything already present in the user request or earlier summaries above
- Narration, history, or explanation of how the work evolved
- Any mention of approaches that were abandoned${kpInstructions}

Write the extracted content directly, as factual statements. Not as a summary, not as a narrative, not as a response to the user. Just the settled, conflict-free record of what is true now.`)
    } else {
      // minimal algorithm
      const kpMinimal =
        knowledgePacks && knowledgePacks.length > 0
          ? `\nKnowledge packs always present (do NOT summarize their content): ${knowledgePacks.map((kp) => kp.name).join(", ")}. Exception: capture any explicit overrides to KP instructions.`
          : ""

      sections.push(`Produce the final settled state of this assistant work session.

If the work contains corrections or reversals, resolve them -- output only what is true now, as positive direct statements. Do not include both sides of any reversal.

The user message and any earlier summaries remain in conversation context -- do NOT repeat them.

Target length: approximately ${tokenTarget} tokens

## User Request (REFERENCE ONLY -- already preserved)
${userContent}

## Final Response
${finalAssistantText}

## Extraction Instructions

Extract only the final settled state:
1. **Final artifacts** -- code verbatim in fenced blocks, files created, configurations applied (final version only)
2. **How things work now** -- current approach, tools and commands to use, standing patterns (state as direct facts)
3. **Non-obvious discoveries** -- error workarounds, environment quirks, API behaviors that would be painful to rediscover
4. **Current state** -- what is complete, what is pending, what is broken

DISCARD: anything tried and then replaced, intermediate work, debugging steps, file exploration, anything already in the user request, history of how decisions evolved.${kpMinimal}

Write extracted content directly as factual statements. Settled, conflict-free, positive.`)
    }

    return sections.join("\n\n")
  }

  /**
   * Extract only text content from an assistant message (no tool calls)
   */
  function extractTextOnly(msg: MessageV2.WithParts): string {
    const textParts: string[] = []
    for (const part of msg.parts) {
      if (part.type === "text" && !part.synthetic && part.text) {
        textParts.push(part.text)
      }
    }
    return textParts.join("\n\n")
  }

  /**
   * Gather tool outputs for a chain with timing information
   */
  function gatherToolOutputsForChain(messages: MessageV2.WithParts[], chain: ChainInfo): string {
    const outputLines: string[] = []
    const userMsg = messages[chain.userMessageIndex]
    const chainStartTime = userMsg.info.time.created

    let stepNumber = 0

    for (const idx of chain.assistantMessageIndices) {
      const msg = messages[idx]

      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (part.state.status !== "completed") continue
        if (part.state.time.compacted) continue

        stepNumber++
        const toolName = part.tool
        const toolTime = part.state.time

        // Build timing info
        let timingInfo = ""
        if (toolTime.start) {
          const relTime = formatRelativeTime(toolTime.start, chainStartTime)
          if (toolTime.end) {
            const duration = formatDuration(toolTime.start, toolTime.end)
            timingInfo = ` [${relTime}, ${duration}]`
          } else {
            timingInfo = ` [${relTime}]`
          }
        }

        outputLines.push(`### Step ${stepNumber}: ${toolName}${timingInfo}`)
        outputLines.push("")

        // Tool input
        if (part.state.input) {
          const input = JSON.stringify(part.state.input, null, 2)
          const truncatedInput = input.length > 2000 ? input.slice(0, 2000) + "\n... (truncated)" : input
          outputLines.push("**Parameters:**")
          outputLines.push("```json")
          outputLines.push(truncatedInput)
          outputLines.push("```")
          outputLines.push("")
        }

        // Tool output
        if (part.state.output) {
          const output = part.state.output
          const truncatedOutput = output.length > 3000 ? output.slice(0, 3000) + "\n... (truncated)" : output
          outputLines.push("**Result:**")
          outputLines.push("```")
          outputLines.push(truncatedOutput)
          outputLines.push("```")
          outputLines.push("")
        }
      }
    }

    return outputLines.join("\n")
  }

  function formatRelativeTime(timestamp: number, chainStart: number): string {
    const deltaMs = timestamp - chainStart
    const deltaSec = Math.floor(deltaMs / 1000)
    if (deltaSec < 60) return `+${deltaSec}s`
    const deltaMin = Math.floor(deltaSec / 60)
    const remainSec = deltaSec % 60
    return `+${deltaMin}m${remainSec}s`
  }

  function formatDuration(startMs: number, endMs: number): string {
    const durationMs = endMs - startMs
    if (durationMs < 1000) return `${durationMs}ms`
    const durationSec = (durationMs / 1000).toFixed(1)
    return `${durationSec}s`
  }

  /**
   * Execute sub-collapse on a specific chain.
   * This replaces the chain's assistant messages with a condensed summary.
   */
  export interface SubCollapseResult {
    status: "success" | "error"
    /** The summary message ID that replaced the chain's assistant messages */
    summaryMessageId?: string
    /** The user message ID at the start of the collapsed chain */
    chainUserMessageId?: string
    /** Index of the last assistant message that was in the original chain */
    originalLastAssistantIndex?: number
    /** Output tokens of the generated summary */
    summaryTokens?: number
  }

  export async function executeSubCollapse(input: {
    sessionID: string
    messages: MessageV2.WithParts[]
    chain: ChainInfo
    abort: AbortSignal
  }): Promise<SubCollapseResult> {
    const config = await Config.get()
    const floatConfig = config.compaction?.float
    const algorithm = (floatConfig?.algorithm ?? DEFAULTS.float.algorithm) as SubCollapseAlgorithm
    const summaryMaxTokens = floatConfig?.subCollapseSummaryMaxTokens ?? DEFAULTS.float.subCollapseSummaryMaxTokens
    const previousSummariesLimit = config.compaction?.previousSummaries ?? DEFAULTS.previousSummaries

    log.info("COLLAPSE sub-collapse begin", {
      sessionID: input.sessionID,
      algorithm,
      chain: {
        userMessageIndex: input.chain.userMessageIndex,
        userMessageId: input.chain.userMessageId,
        assistantCount: input.chain.assistantMessageIndices.length,
        firstAssistantIndex: input.chain.assistantMessageIndices[0],
        lastAssistantIndex: input.chain.assistantMessageIndices[input.chain.assistantMessageIndices.length - 1],
        tokens: input.chain.chainTokens,
        range: `[${input.chain.userMessageIndex}..${input.chain.assistantMessageIndices[input.chain.assistantMessageIndices.length - 1]}]`,
      },
    })

    // Get the user message for model info
    const userMsg = input.messages[input.chain.userMessageIndex]
    const userInfo = userMsg.info as MessageV2.User

    // Get compaction agent and model
    const agent = await Agent.get("compaction")
    const model = agent.model
      ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
      : await Provider.getModel(userInfo.model.providerID, userInfo.model.modelID)

    // Get previous summaries
    const allSessionMessages = await Session.messages({ sessionID: input.sessionID })
    const previousSummaries = await getPreviousSummaries(
      input.sessionID,
      previousSummariesLimit,
      model.limit.context - ProviderTransform.maxOutputTokens(model) - 50000, // Leave room for prompt
    )

    log.debug("COLLAPSE sub-collapse context", {
      sessionID: input.sessionID,
      previousSummariesCount: previousSummaries.length,
      modelId: model.id,
    })

    // Load knowledge packs for compaction context
    const knowledgePacks = await KnowledgePack.loadFromSession(input.sessionID)

    // Build the sub-collapse prompt
    const prompt = buildSubCollapsePrompt(
      input.messages,
      input.chain,
      previousSummaries,
      algorithm,
      summaryMaxTokens,
      knowledgePacks,
    )

    log.debug("COLLAPSE sub-collapse prompt built", {
      sessionID: input.sessionID,
      promptLength: prompt.length,
      promptTokensEstimate: Token.estimate(prompt),
    })

    // Create a new assistant message for the sub-collapse summary
    // It should replace the chain's assistant messages
    const lastAssistantIdx = input.chain.assistantMessageIndices[input.chain.assistantMessageIndices.length - 1]
    const lastAssistantMsg = input.messages[lastAssistantIdx]

    // Use Identifier.insert to place the summary message right after the user message
    // and before any subsequent content
    const summaryMessageId = Identifier.insert(input.chain.userMessageId, lastAssistantMsg.info.id, "message")

    log.debug("COLLAPSE sub-collapse summary ID placement", {
      sessionID: input.sessionID,
      afterId: input.chain.userMessageId,
      beforeId: lastAssistantMsg.info.id,
      summaryMessageId,
      lastAssistantIdx,
      lastAssistantMsgId: lastAssistantMsg.info.id,
      chainAssistantCount: input.chain.assistantMessageIndices.length,
      idSortOrder: [input.chain.userMessageId, summaryMessageId, lastAssistantMsg.info.id].join(" < "),
    })

    const summaryMsg = (await Session.updateMessage({
      id: summaryMessageId,
      role: "assistant",
      parentID: input.chain.userMessageId,
      sessionID: input.sessionID,
      mode: "subcompaction", // Mark as sub-collapse (NOT "compaction" which creates breakpoint)
      agent: "compaction",
      // summary: true is required to prevent the prompt loop from re-triggering compaction.
      // prompt.ts:530 checks `lastFinished.summary !== true` before calling isOverflow().
      // Without this flag, the loop sees the sub-collapse result as a normal assistant
      // message, evaluates isOverflow() against its token counts, and immediately
      // re-triggers compaction — causing the looping behavior.
      //
      // This does NOT create a compaction breakpoint. filterCompacted() only breaks on
      // USER messages that have a `compaction` part (message-v2.ts:670). summary: true
      // on an assistant message is purely a prompt-loop guard — it has no effect on
      // filterCompacted's breakpoint detection.
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
        created: userMsg.info.time.created + 1, // Right after user message
      },
    })) as MessageV2.Assistant

    const processor = SessionProcessor.create({
      assistantMessage: summaryMsg,
      sessionID: input.sessionID,
      model,
      abort: input.abort,
    })

    // Process the sub-collapse summary
    await processor.process({
      user: userInfo,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools: {},
      system: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ],
      model,
    })

    if (processor.message.error) {
      log.error("COLLAPSE sub-collapse processor error, cleaning up placeholder", {
        sessionID: input.sessionID,
        error: processor.message.error,
        summaryMessageId,
      })
      // In SQLite, every message in the table is visible to stream() regardless
      // of parent-child relationships. A failed placeholder mid-conversation with
      // summary: true but no finish and zero tokens becomes a zombie that corrupts
      // the session. Delete it so the original chain remains intact.
      await Session.removeMessage({
        sessionID: input.sessionID,
        messageID: summaryMessageId,
      })
      return { status: "error" }
    }

    log.info("COLLAPSE sub-collapse summary generated", {
      sessionID: input.sessionID,
      summaryTokens: processor.message.tokens.output,
      summaryInputTokens: processor.message.tokens.input,
    })

    // Soft-delete the original assistant messages by marking them flux: "compacted".
    // They remain in SQLite (queryable and restorable via fluxcapacitor) but are
    // invisible to the LLM — toModelMessages skips any message with flux set.
    for (const idx of input.chain.assistantMessageIndices) {
      const msg = input.messages[idx]
      const info = msg.info as MessageV2.Assistant
      await Session.updateMessage({
        ...info,
        flux: "compacted",
      })
    }

    // Calculate token savings
    const summaryTokens = processor.message.tokens.output
    const tokensSaved = input.chain.chainTokens - summaryTokens

    log.info("COLLAPSE sub-collapse complete", {
      sessionID: input.sessionID,
      chain: {
        range: `[${input.chain.userMessageIndex}..${input.chain.assistantMessageIndices[input.chain.assistantMessageIndices.length - 1]}]`,
        userMessageId: input.chain.userMessageId,
        assistantsDeleted: input.chain.assistantMessageIndices.length,
        tokensBefore: input.chain.chainTokens,
      },
      summary: { tokens: summaryTokens, messageId: summaryMessageId },
      tokensSaved,
    })

    // Publish event so TUI reloads messages
    Bus.publish(SessionCompaction.Event.Compacted, { sessionID: input.sessionID })

    return {
      status: "success",
      summaryMessageId: summaryMessageId,
      chainUserMessageId: input.chain.userMessageId,
      originalLastAssistantIndex: lastAssistantIdx,
      summaryTokens,
    }
  }

  /**
   * Float mode pre-check: Run before isOverflow to sub-collapse oldest chains.
   * This is called from the main loop before evaluating token counts.
   */
  export async function floatModePreCheck(input: {
    sessionID: string
    messages: MessageV2.WithParts[]
    abort: AbortSignal
    tokens: MessageV2.Assistant["tokens"]
    contextLimit: number
  }): Promise<{ subCollapsed: boolean; messages: MessageV2.WithParts[] }> {
    const method = await getMethod()

    if (method !== "float") return { subCollapsed: false, messages: input.messages }

    const config = await Config.get()
    const floatConfig = config.compaction?.float
    const minFloat = floatConfig?.minFloat ?? DEFAULTS.float.minFloat

    // Log message analysis to debug filterCompacted behavior
    const firstMsg = input.messages[0]
    const lastMsg = input.messages[input.messages.length - 1]

    // Find any breakpoint markers in the messages we received
    const breakpoints = input.messages
      .map((m, idx) => ({
        idx,
        id: m.info.id,
        role: m.info.role,
        hasCompactionPart: m.parts.some((p) => p.type === "compaction"),
      }))
      .filter((m) => m.hasCompactionPart)

    // Find any summary assistant messages
    const summaries = input.messages
      .map((m, idx) => ({
        idx,
        id: m.info.id,
        role: m.info.role,
        summary: m.info.role === "assistant" ? (m.info as MessageV2.Assistant).summary : undefined,
        finish: m.info.role === "assistant" ? (m.info as MessageV2.Assistant).finish : undefined,
      }))
      .filter((m) => m.summary === true)

    // Compute initial context usage fraction from actual token counts
    const initialTokenCount =
      input.tokens.input + input.tokens.cache.read + input.tokens.cache.write + input.tokens.output
    const initialUsedFraction = input.contextLimit > 0 ? initialTokenCount / input.contextLimit : 0

    log.info("COLLAPSE float mode begin", {
      sessionID: input.sessionID,
      messages: input.messages.length,
      breakpoints: breakpoints.length,
      summaries: summaries.length,
      oldestMsgId: firstMsg?.info.id,
      newestMsgId: lastMsg?.info.id,
      minFloat,
      initialTokenCount,
      contextLimit: input.contextLimit,
      initialUsedFraction: initialUsedFraction.toFixed(3),
      minFloatCheck: initialUsedFraction >= minFloat ? "pass" : "skip",
    })

    // If context usage is below minFloat threshold, skip sub-collapse evaluation entirely
    if (initialUsedFraction < minFloat) {
      log.info("COLLAPSE float mode skipped: context usage below minFloat", {
        sessionID: input.sessionID,
        usedFraction: initialUsedFraction.toFixed(3),
        minFloat,
      })
      return { subCollapsed: false, messages: input.messages }
    }

    // Collapse one chain at a time, re-checking minFloat after each.
    // Returns the final message list after all collapses, or null if none occurred.
    async function collapseNext(
      messages: MessageV2.WithParts[],
      tokenCount: number,
    ): Promise<MessageV2.WithParts[] | null> {
      const used = input.contextLimit > 0 ? tokenCount / input.contextLimit : 0
      if (used < minFloat) {
        log.info("COLLAPSE float mode stopping: context usage dropped below minFloat", {
          sessionID: input.sessionID,
          tokenCount,
          contextLimit: input.contextLimit,
          used: used.toFixed(3),
          minFloat,
        })
        return null
      }

      const chain = await shouldFloatSubCollapse(messages, input.sessionID)
      if (!chain) return null

      const result = await executeSubCollapse({
        sessionID: input.sessionID,
        messages,
        chain,
        abort: input.abort,
      })

      if (result.status === "error") {
        log.error("COLLAPSE float mode sub-collapse failed")
        return null
      }

      const summaryTokens = result.summaryTokens ?? 0
      const nextTokenCount = tokenCount - chain.chainTokens + summaryTokens

      // Mirror what process() does at lines 839-888: find the chronologically last
      // real assistant message (excluding the new sub-collapse summary) and patch its
      // stored token counts to reflect the reduction. Without this, lastFinished.tokens
      // in the prompt loop still holds pre-collapse values from the database, so the
      // minFloat gate in the next collapseNext iteration (and isOverflow on the next
      // loop pass) would see stale high token counts and never stop collapsing.
      const allMessages = await Session.messages({ sessionID: input.sessionID })
      const lastReal = allMessages
        .filter(
          (m): m is MessageV2.WithParts & { info: MessageV2.Assistant } =>
            m.info.role === "assistant" &&
            m.info.id !== result.summaryMessageId &&
            (m.info as MessageV2.Assistant).finish !== undefined,
        )
        .sort((a, b) => b.info.time.created - a.info.time.created)[0]

      if (lastReal) {
        const currentTotal =
          lastReal.info.tokens.input +
          lastReal.info.tokens.cache.read +
          lastReal.info.tokens.cache.write +
          lastReal.info.tokens.output
        const newTotal = Math.max(0, currentTotal - chain.chainTokens + summaryTokens)
        lastReal.info.tokens = {
          input: 0,
          output: lastReal.info.tokens.output,
          reasoning: lastReal.info.tokens.reasoning,
          cache: {
            read: Math.max(0, newTotal - lastReal.info.tokens.output),
            write: 0,
          },
        }
        await Session.updateMessage(lastReal.info)
        log.info("COLLAPSE float mode token adjustment", {
          sessionID: input.sessionID,
          lastRealId: lastReal.info.id,
          chainTokensRemoved: chain.chainTokens,
          summaryTokensAdded: summaryTokens,
          previousTotal: currentTotal,
          newTotal,
          nextTokenCount,
          usedFractionAfter: input.contextLimit > 0 ? (nextTokenCount / input.contextLimit).toFixed(3) : "n/a",
          minFloat,
        })
      }

      // Reload messages so chain detection sees the updated conversation state.
      const next = await MessageV2.filterCompacted(MessageV2.stream(input.sessionID))

      return (await collapseNext(next, nextTokenCount)) ?? next
    }

    const final = await collapseNext(input.messages, initialTokenCount)
    if (!final) return { subCollapsed: false, messages: input.messages }

    log.info("COLLAPSE float mode complete", {
      sessionID: input.sessionID,
      subCollapsed: true,
      messages: final.length,
    })

    // Return subCollapsed: true to signal the main loop should reload and re-filter messages
    return { subCollapsed: true, messages: final }
  }
}

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
import {
  HybridCompactionPipeline,
  LLMExtractor,
  QualityScorer,
} from "./compaction/index"
import { BenchmarkMetrics } from "@/benchmark/metrics"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: z.string(),
      }),
    ),
    CompactionMetrics: BenchmarkMetrics.Event.CompactionMetrics,
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

  export async function process(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
  }) {
    const compactionStartTime = Date.now()
    const config = await Config.get()
    const userMessage = input.messages.findLast((m) => m.info.id === input.parentID)!.info as MessageV2.User
    const originalContextTokens = HybridCompactionPipeline.estimateTokens(input.messages)
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

    // Check if hybrid compaction is enabled (default: true)
    const hybridEnabled = config.compaction?.hybrid?.enabled !== false

    if (hybridEnabled) {
      // Run hybrid compaction pipeline
      log.info("running hybrid compaction pipeline")

      // Phase 1: Deterministic extraction
      const deterministicResult = HybridCompactionPipeline.runDeterministicPhase(input.messages)
      log.info("deterministic extraction complete", {
        filesRead: deterministicResult.artifacts.files_read.length,
        filesModified: deterministicResult.artifacts.files_modified.length,
        errors: deterministicResult.errors.length,
        toolCalls: deterministicResult.toolCalls.length,
      })

      // Phase 2: Build LLM prompt with condensed context
      const llmPrompt = HybridCompactionPipeline.buildLLMPrompt(
        deterministicResult.condensedContext,
        input.messages,
      )

      // Phase 3: Run LLM extraction via processor
      const result = await processor.process({
        user: userMessage,
        agent,
        abort: input.abort,
        sessionID: input.sessionID,
        tools: {},
        system: [],
        messages: [
          // Include condensed context instead of full messages
          {
            role: "user",
            content: [{ type: "text", text: llmPrompt }],
          },
        ],
        model,
      })

      // Phase 4: Post-process LLM response and validate quality
      if (config.compaction?.hybrid?.quality_threshold !== undefined) {
        // Get the output text from processor for quality validation
        const outputParts = processor.message.parts.filter((p) => p.type === "text")
        if (outputParts.length > 0) {
          const outputText = (outputParts[0] as MessageV2.TextPart).text || ""
          const llmResult = LLMExtractor.parseResponse(outputText)

          // Extract agent context if enabled
          const agentContext =
            config.compaction?.hybrid?.preserve_agent_context !== false
              ? LLMExtractor.extractAgentContext({
                  name: userMessage.agent,
                  systemPrompt: agent.prompt,
                })
              : undefined

          // Assemble template for quality scoring
          const originalTokens = HybridCompactionPipeline.estimateTokens(input.messages)
          const template = HybridCompactionPipeline.assembleTemplate(
            deterministicResult,
            llmResult,
            { originalTokens, agentContext },
          )

          // Validate quality
          const quality = QualityScorer.scoreCompaction(
            template,
            deterministicResult.artifacts.files_read,
            { threshold: config.compaction.hybrid.quality_threshold },
          )

          log.info("compaction quality", {
            score: quality.score,
            issues: quality.issues,
            threshold: config.compaction.hybrid.quality_threshold,
          })

          if (quality.score < config.compaction.hybrid.quality_threshold) {
            log.warn("compaction quality below threshold", {
              score: quality.score,
              threshold: config.compaction.hybrid.quality_threshold,
              issues: quality.issues,
            })
          }
        }
      }

      // Publish compaction metrics for benchmark collection
      const hybridOutputParts = processor.message.parts.filter((p) => p.type === "text")
      const hybridOutputText = hybridOutputParts.length > 0
        ? (hybridOutputParts[0] as MessageV2.TextPart).text || ""
        : ""
      const compactedContextTokens = Token.estimate(hybridOutputText)
      const compactionMetrics: BenchmarkMetrics.CompactionMetrics = {
        method: "hybrid",
        timestamp: compactionStartTime,
        duration_ms: Date.now() - compactionStartTime,
        tokens: {
          input: processor.message.tokens.input,
          output: processor.message.tokens.output,
          total: processor.message.tokens.input + processor.message.tokens.output,
        },
        original_context_tokens: originalContextTokens,
        compacted_context_tokens: compactedContextTokens,
        compression_ratio: originalContextTokens > 0
          ? 1 - (compactedContextTokens / originalContextTokens)
          : 0,
        output_text: hybridOutputText,
      }
      Bus.publish(Event.CompactionMetrics, {
        sessionID: input.sessionID,
        metrics: compactionMetrics,
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

    // Fallback to legacy compaction if hybrid is disabled
    log.info("running legacy compaction")

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

    // Publish compaction metrics for benchmark collection (legacy)
    const legacyOutputParts = processor.message.parts.filter((p) => p.type === "text")
    const legacyOutputText = legacyOutputParts.length > 0
      ? (legacyOutputParts[0] as MessageV2.TextPart).text || ""
      : ""
    const legacyCompactedContextTokens = Token.estimate(legacyOutputText)
    const legacyCompactionMetrics: BenchmarkMetrics.CompactionMetrics = {
      method: "legacy",
      timestamp: compactionStartTime,
      duration_ms: Date.now() - compactionStartTime,
      tokens: {
        input: processor.message.tokens.input,
        output: processor.message.tokens.output,
        total: processor.message.tokens.input + processor.message.tokens.output,
      },
      original_context_tokens: originalContextTokens,
      compacted_context_tokens: legacyCompactedContextTokens,
      compression_ratio: originalContextTokens > 0
        ? 1 - (legacyCompactedContextTokens / originalContextTokens)
        : 0,
      output_text: legacyOutputText,
    }
    Bus.publish(Event.CompactionMetrics, {
      sessionID: input.sessionID,
      metrics: legacyCompactionMetrics,
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

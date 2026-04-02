import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { SessionID, MessageID, PartID } from "./schema"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionProcessor } from "./processor"
import { fn } from "@/util/fn"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/db"
import { ModelID, ProviderID } from "@/provider/schema"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"
import { InstanceState } from "@/effect/instance-state"
import { isOverflow as overflow } from "./overflow"
import { createMorphProvider, type CompactionMessage } from "./compaction/index"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000
  const PRUNE_PROTECTED_TOOLS = ["skill"]

  export interface Interface {
    readonly isOverflow: (input: {
      tokens: MessageV2.Assistant["tokens"]
      model: Provider.Model
    }) => Effect.Effect<boolean>
    readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
    readonly process: (input: {
      parentID: MessageID
      messages: MessageV2.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
    }) => Effect.Effect<"continue" | "stop">
    readonly create: (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderID; modelID: ModelID }
      auto: boolean
      overflow?: boolean
    }) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/SessionCompaction") {}

  export const layer: Layer.Layer<
    Service,
    never,
    | Bus.Service
    | Config.Service
    | Session.Service
    | Agent.Service
    | Plugin.Service
    | SessionProcessor.Service
    | Provider.Service
  > = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const config = yield* Config.Service
      const session = yield* Session.Service
      const agents = yield* Agent.Service
      const plugin = yield* Plugin.Service
      const processors = yield* SessionProcessor.Service
      const provider = yield* Provider.Service

      const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
        tokens: MessageV2.Assistant["tokens"]
        model: Provider.Model
      }) {
        return overflow({ cfg: yield* config.get(), tokens: input.tokens, model: input.model })
      })

      // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
      // calls, then erases output of older tool calls to free context space
      const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
        const cfg = yield* config.get()
        if (cfg.compaction?.prune === false) return
        log.info("pruning")

        const msgs = yield* session
          .messages({ sessionID: input.sessionID })
          .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
        if (!msgs) return

        let total = 0
        let pruned = 0
        const toPrune: MessageV2.ToolPart[] = []
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
              yield* session.updatePart(part)
            }
          }
          log.info("pruned", { count: toPrune.length })
        }
      })

      // --- Morph compaction provider ---
      const processMorph = Effect.fn("SessionCompaction.processMorph")(function* (params: {
        cfg: Config.Info
        modelMessages: import("ai").ModelMessage[]
        originalMessages: MessageV2.WithParts[]
        userMessage: MessageV2.User
        input: {
          parentID: MessageID
          sessionID: SessionID
          auto: boolean
          overflow?: boolean
        }
        ctx: { directory: string; worktree: string }
        model: Provider.Model
      }) {
        // WARNING: Always defaults to Morph. Assumes MORPH_API_KEY is set.
        // Not production-ready — no graceful fallback if key is missing.
        const morphApiKey = globalThis.process.env.MORPH_API_KEY
        if (!morphApiKey) {
          throw new Error(
            "MORPH_API_KEY environment variable is required when compaction provider is 'morph'. " +
              "Set MORPH_API_KEY or change compaction.provider to 'builtin' in your config.",
          )
        }

        const morph = createMorphProvider(morphApiKey)
        const compressionRatio = params.cfg.compaction?.compressionRatio ?? 0.3

        // Convert ModelMessage[] to simple {role, content} for the Morph API.
        const simpleMessages: CompactionMessage[] = []
        for (const m of params.modelMessages) {
          const text = (() => {
            if (typeof m.content === "string") return m.content
            if (Array.isArray(m.content))
              return m.content
                .map((p: any) => {
                  if (typeof p === "string") return p
                  if (p.type === "text") return p.text
                  if (p.type === "tool-call") return JSON.stringify({ tool: p.toolName, input: p.args })
                  if (p.type === "tool-result") return typeof p.result === "string" ? p.result : JSON.stringify(p.result)
                  return ""
                })
                .filter(Boolean)
                .join("\n")
            return ""
          })()
          if (text) simpleMessages.push({ role: m.role, content: text })
        }

        log.info("morph compaction input", {
          count: simpleMessages.length,
          ratio: compressionRatio,
          messages: JSON.stringify(simpleMessages),
        })

        const result = yield* Effect.promise(() => morph.compact({ messages: simpleMessages, compressionRatio }))

        log.info("morph compaction output", {
          count: result.messages.length,
          messages: JSON.stringify(result.messages),
        })

        // Delete all old messages, then insert the compacted ones.
        log.info("morph compaction deleting old messages", {
          count: params.originalMessages.length,
          ids: params.originalMessages.map((m) => m.info.id),
        })
        for (const msg of params.originalMessages) {
          yield* session.removeMessage({
            sessionID: params.input.sessionID,
            messageID: msg.info.id,
          })
        }

        // Insert compacted messages.
        const insertedIds: string[] = []
        for (const compactedMsg of result.messages) {
          const role = compactedMsg.role
          if (role === "assistant" || role === "system") {
            const assistantMsg: MessageV2.Assistant = {
              id: MessageID.ascending(),
              role: "assistant",
              parentID: params.input.parentID,
              sessionID: params.input.sessionID,
              mode: "compaction",
              agent: "compaction",
              variant: params.userMessage.variant,
              summary: true,
              path: { cwd: params.ctx.directory, root: params.ctx.worktree },
              cost: 0,
              tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: "morph" as any,
              providerID: "morph" as any,
              time: { created: Date.now(), completed: Date.now() },
              finish: "stop",
            }
            yield* session.updateMessage(assistantMsg)
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: assistantMsg.id,
              sessionID: params.input.sessionID,
              type: "text",
              text: compactedMsg.content,
              time: { start: Date.now(), end: Date.now() },
            })
            insertedIds.push(assistantMsg.id)
          } else {
            const userMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user" as const,
              sessionID: params.input.sessionID,
              time: { created: Date.now() },
              agent: params.userMessage.agent,
              model: params.userMessage.model,
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: params.input.sessionID,
              type: "text",
              text: compactedMsg.content,
              time: { start: Date.now(), end: Date.now() },
            })
            insertedIds.push(userMsg.id)
          }
        }

        // Log final state
        const finalMsgs = yield* session
          .messages({ sessionID: params.input.sessionID })
          .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed([] as MessageV2.WithParts[])))
        log.info("morph compaction complete", {
          original: params.originalMessages.length,
          compacted: result.messages.length,
          inserted: insertedIds,
          finalMessageCount: finalMsgs.length,
          finalMessages: finalMsgs.map((m) => ({
            id: m.info.id,
            role: m.info.role,
            mode: m.info.role === "assistant" ? m.info.mode : undefined,
            summary: m.info.role === "assistant" ? m.info.summary : undefined,
            partTypes: m.parts.map((p) => p.type),
          })),
        })

        return "continue" as const
      })

      // --- Builtin compaction provider (existing LLM-based summarization) ---
      const processBuiltin = Effect.fn("SessionCompaction.processBuiltin")(function* (params: {
        modelMessages: import("ai").ModelMessage[]
        userMessage: MessageV2.User
        input: {
          parentID: MessageID
          sessionID: SessionID
          auto: boolean
          overflow?: boolean
        }
        ctx: { directory: string; worktree: string }
        model: Provider.Model
        agent: Agent.Info
        replay?: { info: MessageV2.User; parts: MessageV2.Part[] }
      }) {
        // Allow plugins to inject context or replace compaction prompt.
        const compacting = yield* plugin.trigger(
          "experimental.session.compacting",
          { sessionID: params.input.sessionID },
          { context: [], prompt: undefined },
        )
        const defaultPrompt = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.
Do not call any tools. Respond only with the summary text.

When constructing the summary, try to stick to this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]
---`

        const prompt = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")
        const msg: MessageV2.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          parentID: params.input.parentID,
          sessionID: params.input.sessionID,
          mode: "compaction",
          agent: "compaction",
          variant: params.userMessage.variant,
          summary: true,
          path: { cwd: params.ctx.directory, root: params.ctx.worktree },
          cost: 0,
          tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: params.model.id,
          providerID: params.model.providerID,
          time: { created: Date.now() },
        }
        yield* session.updateMessage(msg)
        const processor = yield* processors.create({
          assistantMessage: msg,
          sessionID: params.input.sessionID,
          model: params.model,
        })
        const result = yield* processor
          .process({
            user: params.userMessage,
            agent: params.agent,
            sessionID: params.input.sessionID,
            tools: {},
            system: [],
            messages: [
              ...params.modelMessages,
              {
                role: "user",
                content: [{ type: "text", text: prompt }],
              },
            ],
            model: params.model,
          })
          .pipe(Effect.onInterrupt(() => processor.abort()))

        if (result === "compact") {
          processor.message.error = new MessageV2.ContextOverflowError({
            message: params.replay
              ? "Conversation history too large to compact - exceeds model context limit"
              : "Session too large to compact - context exceeds model limit even after stripping media",
          }).toObject()
          processor.message.finish = "error"
          yield* session.updateMessage(processor.message)
          return "stop" as const
        }

        if (processor.message.error) return "stop" as const
        return "continue" as const
      })

      const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
        parentID: MessageID
        messages: MessageV2.WithParts[]
        sessionID: SessionID
        auto: boolean
        overflow?: boolean
      }) {
        const parent = input.messages.findLast((m) => m.info.id === input.parentID)
        if (!parent || parent.info.role !== "user") {
          throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
        }
        const userMessage = parent.info

        let messages = input.messages
        let replay:
          | {
              info: MessageV2.User
              parts: MessageV2.Part[]
            }
          | undefined
        if (input.overflow) {
          const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
          for (let i = idx - 1; i >= 0; i--) {
            const msg = input.messages[i]
            if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
              replay = { info: msg.info, parts: msg.parts }
              messages = input.messages.slice(0, i)
              break
            }
          }
          const hasContent =
            replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
          if (!hasContent) {
            replay = undefined
            messages = input.messages
          }
        }

        const cfg = yield* config.get()
        const compactionProvider = cfg.compaction?.provider ?? "morph"

        const agent = yield* agents.get("compaction")
        const model = agent.model
          ? yield* provider.getModel(agent.model.providerID, agent.model.modelID)
          : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
        const ctx = yield* InstanceState.context

        const msgs = structuredClone(messages)
        yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
        const modelMessages = yield* Effect.promise(() => MessageV2.toModelMessages(msgs, model, { stripMedia: true }))

        let compactionResult: "continue" | "stop"

        if (compactionProvider === "morph") {
          compactionResult = yield* processMorph({
            cfg,
            modelMessages,
            originalMessages: msgs,
            userMessage,
            input,
            ctx,
            model,
          })
        } else {
          // --- Builtin provider path (existing LLM-based compaction) ---
          compactionResult = yield* processBuiltin({
            modelMessages,
            userMessage,
            input,
            ctx,
            model,
            agent,
            replay,
          })
        }

        if (compactionResult === "stop") return "stop"

        // --- Shared post-compaction: replay and continue ---
        if (input.auto) {
          if (replay) {
            const original = replay.info
            const replayMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: original.agent,
              model: original.model,
              format: original.format,
              tools: original.tools,
              system: original.system,
              variant: original.variant,
            })
            for (const part of replay.parts) {
              if (part.type === "compaction") continue
              const replayPart =
                part.type === "file" && MessageV2.isMedia(part.mime)
                  ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
                  : part
              yield* session.updatePart({
                ...replayPart,
                id: PartID.ascending(),
                messageID: replayMsg.id,
                sessionID: input.sessionID,
              })
            }
          }

          if (!replay) {
            const continueMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: userMessage.agent,
              model: userMessage.model,
            })
            const text =
              (input.overflow
                ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
                : "") +
              "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: continueMsg.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text,
              time: {
                start: Date.now(),
                end: Date.now(),
              },
            })
          }
        }

        yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
        return "continue" as const
      })

      const create = Effect.fn("SessionCompaction.create")(function* (input: {
        sessionID: SessionID
        agent: string
        model: { providerID: ProviderID; modelID: ModelID }
        auto: boolean
        overflow?: boolean
      }) {
        const msg = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          model: input.model,
          sessionID: input.sessionID,
          agent: input.agent,
          time: { created: Date.now() },
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: msg.sessionID,
          type: "compaction",
          auto: input.auto,
          overflow: input.overflow,
        })
      })

      return Service.of({
        isOverflow,
        prune,
        process: processCompaction,
        create,
      })
    }),
  )

  export const defaultLayer = Layer.unwrap(
    Effect.sync(() =>
      layer.pipe(
        Layer.provide(Provider.defaultLayer),
        Layer.provide(Session.defaultLayer),
        Layer.provide(SessionProcessor.defaultLayer),
        Layer.provide(Agent.defaultLayer),
        Layer.provide(Plugin.defaultLayer),
        Layer.provide(Bus.layer),
        Layer.provide(Config.defaultLayer),
      ),
    ),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    return runPromise((svc) => svc.isOverflow(input))
  }

  export async function prune(input: { sessionID: SessionID }) {
    return runPromise((svc) => svc.prune(input))
  }

  export const process = fn(
    z.object({
      parentID: MessageID.zod,
      messages: z.custom<MessageV2.WithParts[]>(),
      sessionID: SessionID.zod,
      auto: z.boolean(),
      overflow: z.boolean().optional(),
    }),
    (input) => runPromise((svc) => svc.process(input)),
  )

  export const create = fn(
    z.object({
      sessionID: SessionID.zod,
      agent: z.string(),
      model: z.object({ providerID: ProviderID.zod, modelID: ModelID.zod }),
      auto: z.boolean(),
      overflow: z.boolean().optional(),
    }),
    (input) => runPromise((svc) => svc.create(input)),
  )
}

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

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
    ContextThreshold: BusEvent.define(
      "session.context_threshold",
      z.object({
        sessionID: SessionID.zod,
        level: z.enum(["warning", "error", "blocking"]),
        fraction: z.number(),
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
    readonly checkThresholds: (input: {
      sessionID: SessionID
      tokens: MessageV2.Assistant["tokens"]
      model: Provider.Model
    }) => Effect.Effect<void>
    readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
    readonly process: (input: {
      parentID: MessageID
      messages: MessageV2.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
      fromID?: MessageID
      toID?: MessageID
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

      const checkThresholds = Effect.fn("SessionCompaction.checkThresholds")(function* (input: {
        sessionID: SessionID
        tokens: MessageV2.Assistant["tokens"]
        model: Provider.Model
      }) {
        const cfg = yield* config.get()
        const context = input.model.limit.context
        if (context === 0) return
        const count =
          input.tokens.total ??
          input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
        const fraction = count / context
        const t = cfg.compaction?.thresholds
        const blocking = t?.blocking ?? 0.95
        const error = t?.error ?? 0.85
        const warning = t?.warning ?? 0.7
        if (fraction >= blocking)
          yield* bus.publish(Event.ContextThreshold, { sessionID: input.sessionID, level: "blocking", fraction })
        else if (fraction >= error)
          yield* bus.publish(Event.ContextThreshold, { sessionID: input.sessionID, level: "error", fraction })
        else if (fraction >= warning)
          yield* bus.publish(Event.ContextThreshold, { sessionID: input.sessionID, level: "warning", fraction })
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

      // Post-compact file restoration: find the top 5 most-read files and re-inject
      const MAX_RESTORE_FILES = 5
      const MAX_RESTORE_TOKENS = 50_000

      const restoreReadFiles = Effect.fnUntraced(function* (input: {
        sessionID: SessionID
        userMessage: MessageV2.User
      }) {
        const msgs = yield* session
          .messages({ sessionID: input.sessionID })
          .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
        if (!msgs) return

        // Count read tool invocations by path
        const freq = new Map<string, number>()
        for (const msg of msgs) {
          for (const part of msg.parts) {
            if (part.type === "tool" && part.tool === "read" && part.state.status === "completed") {
              const p = part.state.input?.["filePath"] as string | undefined
              if (p) freq.set(p, (freq.get(p) ?? 0) + 1)
            }
          }
        }
        if (freq.size === 0) return

        const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_RESTORE_FILES)
        let totalTokens = 0
        const contents: string[] = []

        for (const [p] of top) {
          const exists = yield* Effect.promise(() => Bun.file(p).exists())
          if (!exists) continue
          const text = yield* Effect.promise(() => Bun.file(p).text())
          const estimate = Token.estimate(text)
          if (totalTokens + estimate > MAX_RESTORE_TOKENS) continue
          totalTokens += estimate
          contents.push(`### ${p}\n\`\`\`\n${text}\n\`\`\``)
        }

        if (contents.length === 0) return
        log.info("restoring read files post-compact", { count: contents.length, tokens: totalTokens })

        const restoreMsg = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: input.sessionID,
          agent: input.userMessage.agent,
          model: input.userMessage.model,
          time: { created: Date.now() },
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: restoreMsg.id,
          sessionID: input.sessionID,
          type: "text",
          synthetic: true,
          text: `[Post-compact file restoration — re-reading top files from session history]\n\n${contents.join("\n\n")}`,
          time: { start: Date.now(), end: Date.now() },
        })
      })

      const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
        parentID: MessageID
        messages: MessageV2.WithParts[]
        sessionID: SessionID
        auto: boolean
        overflow?: boolean
        fromID?: MessageID
        toID?: MessageID
      }) {
        // Circuit breaker: skip auto-compaction after 3 consecutive failures
        const CIRCUIT_THRESHOLD = 3
        const sessionInfo = yield* session
          .get(input.sessionID)
          .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
        if (sessionInfo && sessionInfo.compactFailures >= CIRCUIT_THRESHOLD) {
          log.info("circuit breaker open — skipping compaction", { failures: sessionInfo.compactFailures })
          return "continue"
        }

        const parent = input.messages.findLast((m) => m.info.id === input.parentID)
        if (!parent || parent.info.role !== "user") {
          throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
        }
        const userMessage = parent.info

        // Tier 1: try pruning tool outputs first before full LLM compaction
        if (input.auto && !input.overflow) {
          yield* prune({ sessionID: input.sessionID })
          // Re-fetch messages to get updated token picture — check if we're still overflowing
          const refreshed = yield* session
            .messages({ sessionID: input.sessionID })
            .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
          if (refreshed) {
            const lastAssistant = refreshed.findLast((m) => m.info.role === "assistant" && m.info.finish) as
              | { info: MessageV2.Assistant }
              | undefined
            if (lastAssistant) {
              const model = yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
              const stillOverflowing = overflow({ cfg: yield* config.get(), tokens: lastAssistant.info.tokens, model })
              if (!stillOverflowing) {
                log.info("tier-1 prune resolved overflow — skipping full compaction")
                return "continue"
              }
            }
          }
        }

        let messages = input.messages

        // Partial compaction: slice to the specified from/to range
        if (input.fromID || input.toID) {
          const from = input.fromID ? messages.findIndex((m) => m.info.id === input.fromID) : 0
          const to = input.toID ? messages.findIndex((m) => m.info.id === input.toID) : messages.length - 1
          if (from >= 0 && to >= from) messages = messages.slice(from, to + 1)
        }

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

        const agent = yield* agents.get("compaction")
        const model = agent.model
          ? yield* provider.getModel(agent.model.providerID, agent.model.modelID)
          : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
        // Allow plugins to inject context or replace compaction prompt.
        const compacting = yield* plugin.trigger(
          "experimental.session.compacting",
          { sessionID: input.sessionID },
          { context: [], prompt: undefined },
        )
        const defaultPrompt = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.
Do not call any tools. Respond only with the summary text.
Respond in the same language as the user's messages in the conversation.

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
        const msgs = structuredClone(messages)
        yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
        const modelMessages = yield* MessageV2.toModelMessagesEffect(msgs, model, { stripMedia: true })
        const ctx = yield* InstanceState.context
        const msg: MessageV2.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          parentID: input.parentID,
          sessionID: input.sessionID,
          mode: "compaction",
          agent: "compaction",
          variant: userMessage.variant,
          summary: true,
          path: {
            cwd: ctx.directory,
            root: ctx.worktree,
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
        }
        yield* session.updateMessage(msg)
        const processor = yield* processors.create({
          assistantMessage: msg,
          sessionID: input.sessionID,
          model,
        })
        const result = yield* processor
          .process({
            user: userMessage,
            agent,
            sessionID: input.sessionID,
            tools: {},
            system: [],
            messages: [
              ...modelMessages,
              {
                role: "user",
                content: [{ type: "text", text: prompt }],
              },
            ],
            model,
          })
          .pipe(Effect.onInterrupt(() => processor.abort()))

        if (result === "compact") {
          processor.message.error = new MessageV2.ContextOverflowError({
            message: replay
              ? "Conversation history too large to compact - exceeds model context limit"
              : "Session too large to compact - context exceeds model limit even after stripping media",
          }).toObject()
          processor.message.finish = "error"
          yield* session.updateMessage(processor.message)
          // Increment circuit breaker failure counter
          const info = yield* session
            .get(input.sessionID)
            .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
          if (info)
            yield* session.setCompactFailures({ sessionID: input.sessionID, failures: (info.compactFailures ?? 0) + 1 })
          return "stop"
        }

        if (result === "continue" && input.auto) {
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

        if (processor.message.error) {
          // Increment circuit breaker failure counter
          const info = yield* session
            .get(input.sessionID)
            .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
          if (info)
            yield* session.setCompactFailures({ sessionID: input.sessionID, failures: (info.compactFailures ?? 0) + 1 })
          return "stop"
        }
        if (result === "continue") {
          // Reset circuit breaker on success
          const info = yield* session
            .get(input.sessionID)
            .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
          if (info && info.compactFailures > 0)
            yield* session.setCompactFailures({ sessionID: input.sessionID, failures: 0 })
          yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })

          // Post-compact file restoration: re-inject top 5 most-read files
          yield* restoreReadFiles({ sessionID: input.sessionID, userMessage }).pipe(Effect.ignore)
        }
        return result
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
        checkThresholds,
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

  export const checkThresholds = fn(
    z.object({
      sessionID: SessionID.zod,
      tokens: z.custom<MessageV2.Assistant["tokens"]>(),
      model: z.custom<Provider.Model>(),
    }),
    (input) => runPromise((svc) => svc.checkThresholds(input)),
  )

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
      fromID: MessageID.zod.optional(),
      toID: MessageID.zod.optional(),
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

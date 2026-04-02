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
import { SessionCompactionPolicy } from "./compaction-policy"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  const COMPACTION_MAX_RETRIES = 2
  const PTL_KEEP_RECENT_TURNS = 5
  const COMPACTION_MAX_OUTPUT_TOKENS = 20_000
  const POST_COMPACT_TOKEN_BUDGET = 50_000
  const POST_COMPACT_MAX_ATTACHMENTS = 5
  const POST_COMPACT_MAX_FILE_TOKENS = 5_000

  // Marks all completed tool parts as compacted and strips attachments.
  // Operates on cloned messages — originals are never mutated.
  const compactTools = (msgs: MessageV2.WithParts[]) =>
    msgs.map((msg) => ({
      ...msg,
      parts: msg.parts.map((part) =>
        part.type === "tool" && part.state.status === "completed" && !part.state.time.compacted
          ? {
              ...part,
              state: {
                ...part.state,
                time: { ...part.state.time, compacted: Date.now() },
                attachments: [],
              },
            }
          : part,
      ),
    }))

  // Keeps only the last N user turns worth of messages.
  const keepRecent = (msgs: MessageV2.WithParts[], turns: number) => {
    let seen = 0
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].info.role === "user") seen++
      if (seen >= turns) return msgs.slice(i)
    }
    return msgs
  }

  const collectAttachments = (msgs: MessageV2.WithParts[]): MessageV2.FilePart[] => {
    const result: MessageV2.FilePart[] = []
    for (let i = msgs.length - 1; i >= 0; i--) {
      for (const part of msgs[i].parts) {
        if (part.type !== "tool" || part.state.status !== "completed") continue
        if (part.state.time.compacted) continue
        for (const att of part.state.attachments ?? []) {
          if (MessageV2.isMedia(att.mime)) continue
          if (att.mime !== "application/x-directory" && !att.mime.startsWith("text/")) continue
          if (result.length >= POST_COMPACT_MAX_ATTACHMENTS) return result
          result.push(att)
        }
      }
    }
    return result
  }

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
    | SessionCompactionPolicy.Service
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
      const policy = yield* SessionCompactionPolicy.Service

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
        const ctx = yield* InstanceState.context
        const cfg = yield* config.get()

        const maxRetries = (cfg.compaction?.max_retries as number | undefined) ?? COMPACTION_MAX_RETRIES
        let exhausted = true
        let finalResult: "continue" | "stop" = "stop"
        let processor: SessionProcessor.Handle | undefined
        let strategy: "full" | "compact-tools" | "recent-turns" = "full"

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const attemptMessages =
            attempt === 0 ? messages
            : attempt === 1 ? compactTools(messages)
            : keepRecent(compactTools(messages), PTL_KEEP_RECENT_TURNS)

          strategy = attempt === 0 ? "full" : attempt === 1 ? "compact-tools" : "recent-turns"

          const clonedMsgs = structuredClone(attemptMessages)
          yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: clonedMsgs })
          const modelMessages = yield* Effect.promise(() =>
            MessageV2.toModelMessages(clonedMsgs, model, { stripMedia: true })
          )

          const summary: MessageV2.Assistant = {
            id: MessageID.ascending(),
            role: "assistant",
            parentID: input.parentID,
            sessionID: input.sessionID,
            mode: "compaction",
            agent: "compaction",
            variant: userMessage.variant,
            summary: true,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
          }
          yield* session.updateMessage(summary)

          const handle = yield* processors.create({
            assistantMessage: summary,
            sessionID: input.sessionID,
            model,
          })

          const result = yield* handle
            .process({
              user: userMessage,
              agent,
              sessionID: input.sessionID,
              tools: {},
              system: [],
              messages: [
                ...modelMessages,
                { role: "user", content: [{ type: "text", text: prompt }] },
              ],
              model,
              maxOutputTokens: cfg.compaction?.max_output_tokens ?? COMPACTION_MAX_OUTPUT_TOKENS,
            })
            .pipe(Effect.onInterrupt(() => handle.abort()))

          if (result === "compact") {
            yield* session.removeMessage({ sessionID: input.sessionID, messageID: summary.id })
            log.info("ptl retry", { attempt, strategy })
            continue
          }

          // Success or non-PTL error
          exhausted = false
          processor = handle
          if (handle.message.error) {
            if (input.auto) yield* policy.failAutoCompact(input.sessionID)
            finalResult = "stop"
            break
          }

          finalResult = result === "continue" ? "continue" : "stop"
          break
        }

        // All retries exhausted — create final error summary
        if (exhausted) {
          if (input.auto) yield* policy.failAutoCompact(input.sessionID)
          const errorSummary: MessageV2.Assistant = {
            id: MessageID.ascending(),
            role: "assistant",
            parentID: input.parentID,
            sessionID: input.sessionID,
            mode: "compaction",
            agent: "compaction",
            variant: userMessage.variant,
            summary: true,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            error: new MessageV2.ContextOverflowError({
              message: "Session too large to compact — exhausted all retry strategies",
            }).toObject(),
            finish: "error",
          }
          yield* session.updateMessage(errorSummary)
          return "stop"
        }

        // Post-compact budget accounting: compute remaining room for restored context
        const postBudget = cfg.compaction?.post_budget ?? POST_COMPACT_TOKEN_BUDGET
        const summaryTokens = processor?.message.tokens?.output ?? 0
        const used = summaryTokens
        const left = Math.max(0, postBudget - used)
        log.info("post-compact budget", { postBudget, summaryTokens, left })

        if (finalResult === "continue" && input.auto) {
          let target: { id: MessageID } | undefined

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
            target = replayMsg
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
            target = continueMsg
          }

          if (target && cfg.compaction?.restore_attachments !== false && left > 0) {
            const attachments = collectAttachments(messages)
            let budget = left
            for (const att of attachments) {
              const size = Token.estimate(JSON.stringify(att))
              if (size > budget) break
              budget -= size
              yield* session.updatePart({
                id: PartID.ascending(),
                messageID: target.id,
                sessionID: input.sessionID,
                type: "file",
                mime: att.mime,
                filename: att.filename,
                url: att.url,
                source: att.source,
              })
            }
          }
        }

        if (processor?.message.error) {
          return "stop"
        }
        if (finalResult === "continue") {
          if (input.auto) yield* policy.resetAutoCompact(input.sessionID)
          yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
        }
        return finalResult
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
          retry: { attempt: 0, strategy: "full" },
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
        Layer.provide(SessionCompactionPolicy.defaultLayer),
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

import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/config/config"
import { SessionCompaction } from "./compaction"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { PartID } from "./schema"
import type { SessionID, MessageID } from "./schema"
import { Cause, Effect, Exit } from "effect"
import * as Stream from "effect/Stream"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  interface ProcessorContext {
    assistantMessage: MessageV2.Assistant
    sessionID: SessionID
    model: Provider.Model
    abort: AbortSignal
    toolcalls: Record<string, MessageV2.ToolPart>
    shouldBreak: boolean
    snapshot: string | undefined
    blocked: boolean
    needsCompaction: boolean
    currentText: MessageV2.TextPart | undefined
    reasoningMap: Record<string, MessageV2.ReasoningPart>
  }

  type StreamResult = Awaited<ReturnType<typeof LLM.stream>>
  type StreamEvent = StreamResult["fullStream"] extends AsyncIterable<infer T> ? T : never

  function handleEvent(value: StreamEvent, ctx: ProcessorContext) {
    return Effect.promise(async () => {
      switch (value.type) {
        case "start":
          await SessionStatus.set(ctx.sessionID, { type: "busy" })
          break

        case "reasoning-start":
          if (value.id in ctx.reasoningMap) break
          const reasoningPart = {
            id: PartID.ascending(),
            messageID: ctx.assistantMessage.id,
            sessionID: ctx.assistantMessage.sessionID,
            type: "reasoning" as const,
            text: "",
            time: { start: Date.now() },
            metadata: value.providerMetadata,
          }
          ctx.reasoningMap[value.id] = reasoningPart
          await Session.updatePart(reasoningPart)
          break

        case "reasoning-delta":
          if (value.id in ctx.reasoningMap) {
            const part = ctx.reasoningMap[value.id]
            part.text += value.text
            if (value.providerMetadata) part.metadata = value.providerMetadata
            await Session.updatePartDelta({
              sessionID: part.sessionID,
              messageID: part.messageID,
              partID: part.id,
              field: "text",
              delta: value.text,
            })
          }
          break

        case "reasoning-end":
          if (value.id in ctx.reasoningMap) {
            const part = ctx.reasoningMap[value.id]
            part.text = part.text.trimEnd()
            part.time = { ...part.time, end: Date.now() }
            if (value.providerMetadata) part.metadata = value.providerMetadata
            await Session.updatePart(part)
            delete ctx.reasoningMap[value.id]
          }
          break

        case "tool-input-start": {
          const part = await Session.updatePart({
            id: ctx.toolcalls[value.id]?.id ?? PartID.ascending(),
            messageID: ctx.assistantMessage.id,
            sessionID: ctx.assistantMessage.sessionID,
            type: "tool",
            tool: value.toolName,
            callID: value.id,
            state: { status: "pending", input: {}, raw: "" },
          })
          ctx.toolcalls[value.id] = part as MessageV2.ToolPart
          break
        }

        case "tool-input-delta":
          break

        case "tool-input-end":
          break

        case "tool-call": {
          const match = ctx.toolcalls[value.toolCallId]
          if (match) {
            const part = await Session.updatePart({
              ...match,
              tool: value.toolName,
              state: { status: "running", input: value.input, time: { start: Date.now() } },
              metadata: value.providerMetadata,
            })
            ctx.toolcalls[value.toolCallId] = part as MessageV2.ToolPart

            const parts = await MessageV2.parts(ctx.assistantMessage.id)
            const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)

            if (
              recentParts.length === DOOM_LOOP_THRESHOLD &&
              recentParts.every(
                (p) =>
                  p.type === "tool" &&
                  p.tool === value.toolName &&
                  p.state.status !== "pending" &&
                  JSON.stringify(p.state.input) === JSON.stringify(value.input),
              )
            ) {
              const agent = await Agent.get(ctx.assistantMessage.agent)
              await Permission.ask({
                permission: "doom_loop",
                patterns: [value.toolName],
                sessionID: ctx.assistantMessage.sessionID,
                metadata: { tool: value.toolName, input: value.input },
                always: [value.toolName],
                ruleset: agent.permission,
              })
            }
          }
          break
        }

        case "tool-result": {
          const match = ctx.toolcalls[value.toolCallId]
          if (match && match.state.status === "running") {
            await Session.updatePart({
              ...match,
              state: {
                status: "completed",
                input: value.input ?? match.state.input,
                output: value.output.output,
                metadata: value.output.metadata,
                title: value.output.title,
                time: { start: match.state.time.start, end: Date.now() },
                attachments: value.output.attachments,
              },
            })
            delete ctx.toolcalls[value.toolCallId]
          }
          break
        }

        case "tool-error": {
          const match = ctx.toolcalls[value.toolCallId]
          if (match && match.state.status === "running") {
            await Session.updatePart({
              ...match,
              state: {
                status: "error",
                input: value.input ?? match.state.input,
                error: value.error instanceof Error ? value.error.message : String(value.error),
                time: { start: match.state.time.start, end: Date.now() },
              },
            })
            if (value.error instanceof Permission.RejectedError || value.error instanceof Question.RejectedError) {
              ctx.blocked = ctx.shouldBreak
            }
            delete ctx.toolcalls[value.toolCallId]
          }
          break
        }

        case "error":
          throw value.error

        case "start-step":
          ctx.snapshot = await Snapshot.track()
          await Session.updatePart({
            id: PartID.ascending(),
            messageID: ctx.assistantMessage.id,
            sessionID: ctx.sessionID,
            snapshot: ctx.snapshot,
            type: "step-start",
          })
          break

        case "finish-step": {
          const usage = Session.getUsage({
            model: ctx.model,
            usage: value.usage,
            metadata: value.providerMetadata,
          })
          ctx.assistantMessage.finish = value.finishReason
          ctx.assistantMessage.cost += usage.cost
          ctx.assistantMessage.tokens = usage.tokens
          await Session.updatePart({
            id: PartID.ascending(),
            reason: value.finishReason,
            snapshot: await Snapshot.track(),
            messageID: ctx.assistantMessage.id,
            sessionID: ctx.assistantMessage.sessionID,
            type: "step-finish",
            tokens: usage.tokens,
            cost: usage.cost,
          })
          await Session.updateMessage(ctx.assistantMessage)
          if (ctx.snapshot) {
            const patch = await Snapshot.patch(ctx.snapshot)
            if (patch.files.length) {
              await Session.updatePart({
                id: PartID.ascending(),
                messageID: ctx.assistantMessage.id,
                sessionID: ctx.sessionID,
                type: "patch",
                hash: patch.hash,
                files: patch.files,
              })
            }
            ctx.snapshot = undefined
          }
          SessionSummary.summarize({
            sessionID: ctx.sessionID,
            messageID: ctx.assistantMessage.parentID,
          })
          if (
            !ctx.assistantMessage.summary &&
            (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: ctx.model }))
          ) {
            ctx.needsCompaction = true
          }
          break
        }

        case "text-start":
          ctx.currentText = {
            id: PartID.ascending(),
            messageID: ctx.assistantMessage.id,
            sessionID: ctx.assistantMessage.sessionID,
            type: "text",
            text: "",
            time: { start: Date.now() },
            metadata: value.providerMetadata,
          }
          await Session.updatePart(ctx.currentText)
          break

        case "text-delta":
          if (ctx.currentText) {
            ctx.currentText.text += value.text
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            await Session.updatePartDelta({
              sessionID: ctx.currentText.sessionID,
              messageID: ctx.currentText.messageID,
              partID: ctx.currentText.id,
              field: "text",
              delta: value.text,
            })
          }
          break

        case "text-end":
          if (ctx.currentText) {
            ctx.currentText.text = ctx.currentText.text.trimEnd()
            const textOutput = await Plugin.trigger(
              "experimental.text.complete",
              {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                partID: ctx.currentText.id,
              },
              { text: ctx.currentText.text },
            )
            ctx.currentText.text = textOutput.text
            ctx.currentText.time = { start: Date.now(), end: Date.now() }
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            await Session.updatePart(ctx.currentText)
          }
          ctx.currentText = undefined
          break

        case "finish":
          break

        default:
          log.info("unhandled", { ...value })
          break
      }
    })
  }

  function cleanupEffect(ctx: ProcessorContext) {
    return Effect.promise(async () => {
      if (ctx.snapshot) {
        const patch = await Snapshot.patch(ctx.snapshot)
        if (patch.files.length) {
          await Session.updatePart({
            id: PartID.ascending(),
            messageID: ctx.assistantMessage.id,
            sessionID: ctx.sessionID,
            type: "patch",
            hash: patch.hash,
            files: patch.files,
          })
        }
        ctx.snapshot = undefined
      }
      const parts = await MessageV2.parts(ctx.assistantMessage.id)
      for (const part of parts) {
        if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
          await Session.updatePart({
            ...part,
            state: {
              ...part.state,
              status: "error",
              error: "Tool execution aborted",
              time: { start: Date.now(), end: Date.now() },
            },
          })
        }
      }
      ctx.assistantMessage.time.completed = Date.now()
      await Session.updateMessage(ctx.assistantMessage)
    })
  }

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: SessionID
    model: Provider.Model
    abort: AbortSignal
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let needsCompaction = false

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput): Promise<"compact" | "stop" | "continue"> {
        log.info("process")
        needsCompaction = false
        const shouldBreak = (await Config.get()).experimental?.continue_loop_on_deny !== true

        const ctx: ProcessorContext = {
          assistantMessage: input.assistantMessage,
          sessionID: input.sessionID,
          model: input.model,
          abort: input.abort,
          toolcalls,
          shouldBreak,
          get snapshot() {
            return snapshot
          },
          set snapshot(v) {
            snapshot = v
          },
          get blocked() {
            return blocked
          },
          set blocked(v) {
            blocked = v
          },
          get needsCompaction() {
            return needsCompaction
          },
          set needsCompaction(v) {
            needsCompaction = v
          },
          currentText: undefined,
          reasoningMap: {},
        }

        const parse = (e: unknown) =>
          MessageV2.fromError(e, {
            providerID: input.model.providerID,
            aborted: input.abort.aborted,
          })

        const consumeStream = Effect.gen(function* () {
          ctx.currentText = undefined
          ctx.reasoningMap = {}
          const stream = yield* Effect.promise(() => LLM.stream(streamInput))

          yield* Stream.fromAsyncIterable(stream.fullStream, (e) => e).pipe(
            Stream.runForEachWhile((event) =>
              Effect.gen(function* () {
                input.abort.throwIfAborted()
                yield* handleEvent(event, ctx)
                return !needsCompaction
              }),
            ),
          )
        })

        const halt = (e: unknown): Effect.Effect<void> =>
          Effect.gen(function* () {
            log.error("process", { error: e, stack: JSON.stringify((e as any)?.stack) })
            const error = MessageV2.fromError(e, {
              providerID: input.model.providerID,
              aborted: input.abort.aborted,
            })
            if (MessageV2.ContextOverflowError.isInstance(error)) {
              needsCompaction = true
              Bus.publish(Session.Event.Error, { sessionID: input.sessionID, error })
              return
            }
            input.assistantMessage.error = error
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            })
            yield* Effect.promise(() => SessionStatus.set(input.sessionID, { type: "idle" }))
          })

        const loop: Effect.Effect<void, unknown> = consumeStream.pipe(
          Effect.catchCause((cause) => Effect.fail(Cause.squash(cause))),
          Effect.retry(SessionRetry.policy({ sessionID: input.sessionID, parse })),
          Effect.ensuring(cleanupEffect(ctx)),
        )

        const exit = await Effect.runPromiseExit(loop, { signal: input.abort })

        if (Exit.isFailure(exit)) {
          const err =
            Cause.hasInterrupts(exit.cause) && input.abort.aborted
              ? new DOMException("Aborted", "AbortError")
              : Cause.squash(exit.cause)
          await Effect.runPromise(halt(err))
        }

        if (needsCompaction) return "compact"
        if (blocked || input.assistantMessage.error) return "stop"
        return "continue"
      },
    }
    return result
  }
}

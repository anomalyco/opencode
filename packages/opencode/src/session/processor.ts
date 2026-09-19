import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { NamedError } from "@opencode-ai/core/util/error"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Image } from "@/image/image"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Cause, Deferred, Effect, Exit, Layer, Context, Scope, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import { Session } from "./session"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow } from "./overflow"
import { PartID } from "./schema"
import type { MessageID, SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { Usage, type LLMEvent } from "@opencode-ai/llm"

const DOOM_LOOP_THRESHOLD = 3
export type Result = "compact" | "stop" | "continue"

export interface Handle {
  readonly message: SessionV1.Assistant
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
  ) => Effect.Effect<SessionV1.ToolPart | undefined>
  readonly completeToolCall: (
    toolCallID: string,
    output: {
      title: string
      metadata: Record<string, any>
      output: string
      attachments?: SessionV1.FilePart[]
    },
  ) => Effect.Effect<void>
  readonly process: (
    streamInput: LLM.StreamInput,
    // Reactive recovery admission from the prompt loop. Callers that do not consult it (compaction's
    // summary request) leave it undefined, which keeps the recoverable overflow arm.
    reactiveAllowed?: boolean,
  ) => Effect.Effect<Result>
}

type Input = {
  assistantMessage: SessionV1.Assistant
  sessionID: SessionID
  model: Provider.Model
}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Handle>
}

type ToolCall = {
  partID: SessionV1.ToolPart["id"]
  messageID: SessionV1.ToolPart["messageID"]
  sessionID: SessionV1.ToolPart["sessionID"]
  done: Deferred.Deferred<void>
}

// Private failure-channel value for retry orchestration. Deliberately plain Err-shaped rather
// than a Schema.Class: `parse` passes it through by identity so it never degrades into an
// UnknownError, `SessionRetry.retryable` discriminates on `data.classification`, and the halt
// control arm either re-fails the raw cause (mixed) or settles the attempt (incomplete).
const RETRY_CONTROL = "session.processor.retry-control"

type RetryControl = {
  name: typeof RETRY_CONTROL
  data:
    | { classification: "incomplete-stream"; source: string; message: string }
    | { classification: "mixed-interrupt"; source: string; message: string; cause: Cause.Cause<never> }
}

const isRetryControl = (value: unknown): value is RetryControl => isRecord(value) && value.name === RETRY_CONTROL

// Incomplete streams get their own budget, shared by the classified marker and the clean-EOF
// detections; the retry ordinal itself stays the ordinary shared one.
const INCOMPLETE_RETRY_LIMIT = 2

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  shouldBreak: boolean
  snapshot: string | undefined
  blocked: boolean
  needsCompaction: boolean
  // Handle-level monotonic replay vetoes. They are deliberately not part of the per-attempt
  // reset below: once this handle has observed tool activity or dispatched a matching text hook,
  // no later attempt may replay it with another provider request.
  observedToolActivity: boolean
  dispatchedTextCompleteHook: boolean
  currentText: SessionV1.TextPart | undefined
  reasoningMap: Record<string, SessionV1.ReasoningPart>
  evidence: Evidence
  // Per-attempt ownership and rollback preparation, replaced wholesale alongside `evidence`.
  // `ownedParts` is registered before the part's first durable write so an authorized retry can
  // delete exactly what this attempt created. `baseline` is captured before the attempt runs, so
  // the attempt's own mutations (step-finish, settleIncomplete, halt) are what rollback undoes.
  ownedParts: PartID[]
  pendingSummaries: { sessionID: SessionID; messageID: MessageID }[]
  baseline: {
    finish: SessionV1.Assistant["finish"]
    cost: number
    tokens: SessionV1.Assistant["tokens"]
    error: SessionV1.Assistant["error"]
    timeCompleted: SessionV1.Assistant["time"]["completed"]
  }
}

/**
 * Per-attempt stream observation used to settle a stream that reaches EOF without a
 * reliable settlement. Held as a ctx field reference and replaced wholesale per physical
 * attempt (same pattern as ctx.toolcalls), so handleEvent always reads the live attempt.
 */
interface Evidence {
  hasSettledStep: boolean
  hasOpenStep: boolean
  lastStepUnknown: boolean
  hasVisibleText: boolean
  hasToolCallEvidence: boolean
  incompleteMarkerSeen: boolean
  // A content-less start (text/reasoning/tool-input/tool-call) arrived this attempt. Unlike the
  // EOF rules above it only vetoes a reactive recovery — an attempt that already produced output
  // may not be replayed by a compaction — and it never feeds the incomplete-settlement rules.
  hasStartedOutput: boolean
}

const emptyEvidence = (): Evidence => ({
  hasSettledStep: false,
  hasOpenStep: false,
  lastStepUnknown: false,
  hasVisibleText: false,
  hasToolCallEvidence: false,
  incompleteMarkerSeen: false,
  hasStartedOutput: false,
})

type StreamEvent = LLMEvent

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionProcessor") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const config = yield* Config.Service
    const snapshot = yield* Snapshot.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const permission = yield* Permission.Service
    const plugin = yield* Plugin.Service
    const summary = yield* SessionSummary.Service
    const scope = yield* Scope.Scope
    const status = yield* SessionStatus.Service
    const image = yield* Image.Service
    const events = yield* EventV2Bridge.Service
    const database = yield* Database.Service

    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      // Pre-capture snapshot before the LLM stream starts. The AI SDK
      // may execute tools internally before emitting start-step events,
      // so capturing inside the event handler can be too late.
      const initialSnapshot = yield* snapshot.track()
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        shouldBreak: false,
        snapshot: initialSnapshot,
        blocked: false,
        needsCompaction: false,
        observedToolActivity: false,
        dispatchedTextCompleteHook: false,
        currentText: undefined,
        reasoningMap: {},
        evidence: emptyEvidence(),
        ownedParts: [],
        pendingSummaries: [],
        baseline: {
          finish: input.assistantMessage.finish,
          cost: input.assistantMessage.cost,
          tokens: structuredClone(input.assistantMessage.tokens),
          error: input.assistantMessage.error,
          timeCompleted: input.assistantMessage.time.completed,
        },
      }
      let aborted = false
      // Raw value of the failure `halt` presented, i.e. the attempt's own primary cause. `Effect.catch`
      // consumes that failure, so the retry region exits successfully; the finalizer reads this to keep
      // the primary identity alive when finalization itself faults.
      let primary: unknown = undefined
      // Admission of the current process call, read by halt. Only a strict `false` may settle an
      // overflow, so an undefined value can never turn a recoverable overflow terminal.
      let reactiveAdmission: boolean | undefined = undefined

      const parse = (e: unknown) =>
        isRetryControl(e)
          ? e
          : MessageV2.fromError(e, {
              providerID: input.model.providerID,
              aborted,
            })

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const done = ctx.toolcalls[toolCallID]?.done
        delete ctx.toolcalls[toolCallID]
        if (done) yield* Deferred.succeed(done, undefined).pipe(Effect.ignore)
      })

      const readToolCall = Effect.fn("SessionProcessor.readToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        if (!call) return undefined
        const part = yield* session.getPart({
          partID: call.partID,
          messageID: call.messageID,
          sessionID: call.sessionID,
        })
        if (!part || part.type !== "tool") {
          delete ctx.toolcalls[toolCallID]
          return undefined
        }
        return { call, part }
      })

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) return undefined
        const part = yield* session.updatePart(update(match.part))
        ctx.toolcalls[toolCallID] = {
          ...match.call,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        return part
      })

      const completeToolCall = Effect.fn("SessionProcessor.completeToolCall")(function* (
        toolCallID: string,
        output: {
          title: string
          metadata: Record<string, any>
          output: string
          attachments?: SessionV1.FilePart[]
        },
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "completed",
            input: match.part.state.input,
            output: output.output,
            metadata: output.metadata,
            title: output.title,
            time: { start: match.part.state.time.start, end: Date.now() },
            attachments: output.attachments,
          },
        })
        yield* settleToolCall(toolCallID)
      })

      const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (toolCallID: string, error: unknown) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return false
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "error",
            input: match.part.state.input,
            error: errorMessage(error),
            // Keep metadata streamed while running so failures retain progress detail (e.g. execute's child calls).
            metadata: match.part.state.metadata,
            time: { start: match.part.state.time.start, end: Date.now() },
          },
        })
        if (error instanceof PermissionV1.RejectedError || error instanceof Question.RejectedError) {
          ctx.blocked = ctx.shouldBreak
        }
        yield* settleToolCall(toolCallID)
        return true
      })

      const finishReasoning = Effect.fn("SessionProcessor.finishReasoning")(function* (reasoningID: string) {
        if (!(reasoningID in ctx.reasoningMap)) return
        // oxlint-disable-next-line no-self-assign -- reactivity trigger
        ctx.reasoningMap[reasoningID].text = ctx.reasoningMap[reasoningID].text
        ctx.reasoningMap[reasoningID].time = { ...ctx.reasoningMap[reasoningID].time, end: Date.now() }
        yield* session.updatePart(ctx.reasoningMap[reasoningID])
        delete ctx.reasoningMap[reasoningID]
      })

      const ensureToolCall = Effect.fn("SessionProcessor.ensureToolCall")(function* (input: {
        id: string
        name: string
        providerExecuted?: boolean
      }) {
        const existing = yield* readToolCall(input.id)
        if (existing) {
          if (!input.providerExecuted || existing.part.metadata?.providerExecuted) return existing
          const part = yield* session.updatePart({
            ...existing.part,
            metadata: { ...existing.part.metadata, providerExecuted: true },
          })
          ctx.toolcalls[input.id] = {
            ...existing.call,
            partID: part.id,
            messageID: part.messageID,
            sessionID: part.sessionID,
          }
          return { call: ctx.toolcalls[input.id], part }
        }
        const partID = PartID.ascending()
        ctx.ownedParts.push(partID)
        const part = yield* session.updatePart({
          id: partID,
          messageID: ctx.assistantMessage.id,
          sessionID: ctx.assistantMessage.sessionID,
          type: "tool",
          tool: input.name,
          callID: input.id,
          state: { status: "pending", input: {}, raw: "" },
          metadata: input.providerExecuted ? { providerExecuted: true } : undefined,
        } satisfies SessionV1.ToolPart)
        ctx.toolcalls[input.id] = {
          done: yield* Deferred.make<void>(),
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        return { call: ctx.toolcalls[input.id], part }
      })

      const isFilePart = (value: unknown): value is SessionV1.FilePart => Schema.is(SessionV1.FilePart)(value)

      const toolResultOutput = (
        value: Extract<StreamEvent, { type: "tool-result" }>,
      ): { title: string; metadata: Record<string, any>; output: string; attachments?: SessionV1.FilePart[] } => {
        if (isRecord(value.result.value) && typeof value.result.value.output === "string") {
          return {
            title: typeof value.result.value.title === "string" ? value.result.value.title : value.name,
            metadata: isRecord(value.result.value.metadata) ? value.result.value.metadata : {},
            output: value.result.value.output,
            attachments: Array.isArray(value.result.value.attachments)
              ? value.result.value.attachments.filter(isFilePart)
              : undefined,
          }
        }
        return {
          title: value.name,
          metadata: value.result.type === "json" && isRecord(value.result.value) ? value.result.value : {},
          output:
            typeof value.result.value === "string" ? value.result.value : (JSON.stringify(value.result.value) ?? ""),
        }
      }

      const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
        switch (value.type) {
          case "reasoning-start":
            ctx.evidence.hasStartedOutput = true
            if (value.id in ctx.reasoningMap) return
            ctx.reasoningMap[value.id] = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            ctx.ownedParts.push(ctx.reasoningMap[value.id].id)
            yield* session.updatePart(ctx.reasoningMap[value.id])
            return

          case "reasoning-delta":
            // Match dev: silently drop orphan deltas (no preceding reasoning-start).
            if (!(value.id in ctx.reasoningMap)) return
            ctx.reasoningMap[value.id].text += value.text
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.reasoningMap[value.id].sessionID,
              messageID: ctx.reasoningMap[value.id].messageID,
              partID: ctx.reasoningMap[value.id].id,
              field: "text",
              delta: value.text,
            })
            return

          case "reasoning-end":
            if (value.providerMetadata && value.id in ctx.reasoningMap) {
              ctx.reasoningMap[value.id].metadata = value.providerMetadata
            }
            yield* finishReasoning(value.id)
            return

          case "tool-input-start":
            ctx.evidence.hasStartedOutput = true
            ctx.observedToolActivity = true
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            yield* ensureToolCall(value)
            return

          case "tool-input-delta":
            ctx.observedToolActivity = true
            yield* ensureToolCall(value)
            return

          case "tool-input-end": {
            ctx.observedToolActivity = true
            yield* ensureToolCall(value)
            return
          }

          case "tool-call": {
            ctx.evidence.hasStartedOutput = true
            ctx.observedToolActivity = true
            // A normalized tool call is usable output evidence; tool-input-* events are not.
            ctx.evidence.hasToolCallEvidence = true
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            yield* ensureToolCall(value)
            const input = isRecord(value.input) ? value.input : { value: value.input }
            yield* updateToolCall(value.id, (match) => ({
              ...match,
              tool: value.name,
              state:
                match.state.status === "running"
                  ? { ...match.state, input }
                  : {
                      status: "running",
                      input,
                      time: { start: Date.now() },
                    },
              metadata: match.metadata?.providerExecuted
                ? { ...value.providerMetadata, providerExecuted: true }
                : value.providerMetadata,
            }))

            const parts = yield* MessageV2.parts(ctx.assistantMessage.id).pipe(
              Effect.provideService(Database.Service, database),
            )
            const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)

            if (
              recentParts.length !== DOOM_LOOP_THRESHOLD ||
              !recentParts.every(
                (part) =>
                  part.type === "tool" &&
                  part.tool === value.name &&
                  part.state.status !== "pending" &&
                  JSON.stringify(part.state.input) === JSON.stringify(input),
              )
            ) {
              return
            }

            const agent = yield* agents.get(ctx.assistantMessage.agent)
            yield* permission.ask({
              permission: "doom_loop",
              patterns: [value.name],
              sessionID: ctx.assistantMessage.sessionID,
              metadata: { tool: value.name, input },
              always: [value.name],
              ruleset: agent.permission,
            })
            return
          }

          case "tool-result": {
            ctx.observedToolActivity = true
            const toolCall = yield* readToolCall(value.id)
            if (!toolCall && value.result.type === "error") return
            if (value.result.type === "error") {
              yield* failToolCall(value.id, value.result.value)
              return
            }
            const rawOutput = toolResultOutput(value)
            const normalized = yield* Effect.forEach(rawOutput.attachments ?? [], (attachment) =>
              attachment.mime.startsWith("image/")
                ? image.normalize(attachment).pipe(
                    Effect.catchIf(
                      (error) => error instanceof Image.ResizerUnavailableError,
                      () => Effect.succeed(attachment),
                    ),
                    Effect.exit,
                  )
                : Effect.succeed(Exit.succeed<SessionV1.FilePart>(attachment)),
            )
            const omitted = normalized.filter(Exit.isFailure).length
            const attachments = normalized.filter(Exit.isSuccess).map((item) => item.value)
            const output = {
              ...rawOutput,
              output:
                omitted === 0
                  ? rawOutput.output
                  : `${rawOutput.output}\n\n[${omitted} image${omitted === 1 ? "" : "s"} omitted: could not be resized below the image size limit.]`,
              attachments: attachments.length ? attachments : undefined,
            }
            yield* completeToolCall(value.id, output)
            return
          }

          case "tool-error": {
            ctx.observedToolActivity = true
            yield* failToolCall(value.id, value.error ?? new Error(value.message))
            return
          }

          case "provider-error":
            // A classified incomplete-stream marker only records evidence; the settlement that
            // follows it must still be consumed, so this branch neither throws nor compacts.
            if (value.classification === "incomplete-stream") {
              ctx.evidence.incompleteMarkerSeen = true
              return
            }
            // An opaque message with an explicit overflow classification still reaches the
            // existing ContextOverflowError path, so the classification survives the throw.
            if (value.classification === "context-overflow") {
              throw new SessionV1.ContextOverflowError({ message: value.message })
            }
            throw new Error(value.message)

          case "step-start":
            ctx.evidence.hasOpenStep = true
            if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()
            const stepStartID = PartID.ascending()
            ctx.ownedParts.push(stepStartID)
            yield* session.updatePart({
              id: stepStartID,
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              snapshot: ctx.snapshot,
              type: "step-start",
            })
            return

          case "step-finish": {
            ctx.evidence.hasSettledStep = true
            ctx.evidence.lastStepUnknown = value.reason === "unknown"
            ctx.evidence.hasOpenStep = false
            const completedSnapshot = yield* snapshot.track()
            yield* Effect.forEach(Object.keys(ctx.reasoningMap), finishReasoning)
            // Anthropic reports thinking blocks it removed before the model saw the
            // prompt. Prefix mismatches mean opencode changed history behind a signed
            // block; log them so the churn can be tracked down.
            const dropped = isRecord(value.providerMetadata?.anthropic)
              ? value.providerMetadata.anthropic.inputTransformations
              : undefined
            if (Array.isArray(dropped) && dropped.length > 0) {
              yield* Effect.logWarning("thinking blocks dropped by provider", {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                model: ctx.model.id,
                transformations: JSON.stringify(dropped),
              })
            }
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage ?? new Usage({}),
              metadata: value.providerMetadata,
            })
            ctx.assistantMessage.finish = value.reason
            ctx.assistantMessage.cost += usage.cost
            ctx.assistantMessage.tokens = usage.tokens
            const stepFinishID = PartID.ascending()
            ctx.ownedParts.push(stepFinishID)
            yield* session.updatePart({
              id: stepFinishID,
              reason: value.reason,
              snapshot: completedSnapshot,
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "step-finish",
              tokens: usage.tokens,
              cost: usage.cost,
            })
            yield* session.updateMessage(ctx.assistantMessage)
            if (ctx.snapshot) {
              const patch = yield* snapshot.patch(ctx.snapshot)
              if (patch.files.length) {
                const stepPatchID = PartID.ascending()
                ctx.ownedParts.push(stepPatchID)
                yield* session.updatePart({
                  id: stepPatchID,
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  type: "patch",
                  hash: patch.hash,
                  files: patch.files,
                })
              }
              ctx.snapshot = undefined
            }
            // Deferred instead of launched here: rollback drops this attempt's summaries by
            // clearing the pending list, and the finalizer flushes whatever survived.
            ctx.pendingSummaries.push({
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.parentID,
            })
            if (
              !ctx.assistantMessage.summary &&
              isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
            ) {
              ctx.needsCompaction = true
            }
            // A settled length cutoff is a terminal in its own right: the real step-finish path
            // produces the existing output-length error, it is not parsed from a later failure.
            if (value.reason === "length") throw new SessionV1.OutputLengthError({})
            return
          }

          case "text-start":
            ctx.evidence.hasStartedOutput = true
            ctx.currentText = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "text",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            ctx.ownedParts.push(ctx.currentText.id)
            yield* session.updatePart(ctx.currentText)
            return

          case "text-delta":
            if (!ctx.currentText) return
            ctx.currentText.text += value.text
            // Whitespace-only output is not visible text (same trim basis as empty-unknown).
            if (ctx.currentText.text.trim() !== "") ctx.evidence.hasVisibleText = true
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.currentText.sessionID,
              messageID: ctx.currentText.messageID,
              partID: ctx.currentText.id,
              field: "text",
              delta: value.text,
            })
            return

          case "text-end":
            if (!ctx.currentText) return
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.currentText.text = ctx.currentText.text
            // Dispatch is a replay veto even when the handler itself fails, so check the real
            // dispatch list before handing the text over. A hook registered between this check
            // and trigger() is missed; that approximation is accepted in the approved design.
            if ((yield* plugin.list()).some((hook) => typeof hook["experimental.text.complete"] === "function"))
              ctx.dispatchedTextCompleteHook = true
            ctx.currentText.text = (yield* plugin.trigger(
              "experimental.text.complete",
              {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                partID: ctx.currentText.id,
              },
              { text: ctx.currentText.text },
            )).text
            {
              const end = Date.now()
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            }
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePart(ctx.currentText)
            ctx.currentText = undefined
            return

          case "finish":
            return
        }
      })

      const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
        if (ctx.snapshot) {
          const patch = yield* snapshot.patch(ctx.snapshot)
          if (patch.files.length) {
            const cleanupPatchID = PartID.ascending()
            ctx.ownedParts.push(cleanupPatchID)
            yield* session.updatePart({
              id: cleanupPatchID,
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              type: "patch",
              hash: patch.hash,
              files: patch.files,
            })
          }
          ctx.snapshot = undefined
        }

        if (ctx.currentText) {
          const end = Date.now()
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          yield* session.updatePart(ctx.currentText)
          ctx.currentText = undefined
        }

        for (const part of Object.values(ctx.reasoningMap)) {
          const end = Date.now()
          yield* session.updatePart({
            ...part,
            time: { start: part.time.start ?? end, end },
          })
        }
        ctx.reasoningMap = {}

        yield* Effect.forEach(
          Object.values(ctx.toolcalls),
          (call) => Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore),
          { concurrency: "unbounded" },
        )

        for (const toolCallID of Object.keys(ctx.toolcalls)) {
          const match = yield* readToolCall(toolCallID)
          if (!match) continue
          const part = match.part
          const end = Date.now()
          const metadata = "metadata" in part.state && isRecord(part.state.metadata) ? part.state.metadata : {}
          yield* session.updatePart({
            ...part,
            state: {
              ...part.state,
              status: "error",
              error: "Tool execution aborted",
              metadata: { ...metadata, interrupted: true },
              time: { start: "time" in part.state ? part.state.time.start : end, end },
            },
          })
        }
        ctx.toolcalls = {}
        ctx.assistantMessage.time.completed = Date.now()
        yield* session.updateMessage(ctx.assistantMessage)
      })

      // Finalization: launch the summaries this attempt deferred, then run cleanup. Both run under
      // one `Effect.exit` capture in the retry region's finalizer so a failure in either is
      // reported alongside — never instead of — the region's own failure or interrupt.
      const finalize = Effect.fn("SessionProcessor.finalize")(function* () {
        yield* Effect.forEach(ctx.pendingSummaries, (input) =>
          summary.summarize(input).pipe(Effect.ignore, Effect.forkIn(scope)),
        )
        ctx.pendingSummaries = []
        yield* cleanup()
      })

      const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
        primary = e
        yield* Effect.logError("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
          error: errorMessage(e),
          stack: e instanceof Error ? e.stack : undefined,
        })
        // Retry controls never reach the parse chain: a mixed cause keeps both identities on the
        // failure channel, an incomplete one settles exactly like the exhausted EOF path. Both
        // arms return, so the settlement below cannot publish a second error or idle.
        if (isRetryControl(e)) {
          if (e.data.classification === "mixed-interrupt") return yield* Effect.failCause(e.data.cause)
          return yield* settleIncomplete(e.data.message)
        }
        const error = parse(e) as NonNullable<SessionV1.Assistant["error"]>
        if (SessionV1.ContextOverflowError.isInstance(error)) {
          if ((yield* config.get()).compaction?.auto === false && !ctx.assistantMessage.summary) {
            ctx.assistantMessage.error = error
            ctx.assistantMessage.finish = "error"
            yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
            yield* status.set(ctx.sessionID, { type: "idle" })
            return
          }
          // Same terminal shape as the auto=false arm: an overflow the caller cannot follow with a
          // recovery settles instead of asking for a compaction that would never be dispatched or
          // would replay output this attempt already produced. The caller's admission is strict, so
          // a caller that does not consult it (compaction's summary) stays on the recoverable arm;
          // the summary guard keeps a summary message's own overflow there too.
          if ((reactiveAdmission === false || ctx.evidence.hasStartedOutput) && !ctx.assistantMessage.summary) {
            ctx.assistantMessage.error = error
            ctx.assistantMessage.finish = "error"
            yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
            yield* status.set(ctx.sessionID, { type: "idle" })
            return
          }
          if (!ctx.evidence.hasStartedOutput) ctx.needsCompaction = true
          yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
          return
        }
        ctx.assistantMessage.error = error
        yield* events.publish(Session.Event.Error, {
          sessionID: ctx.assistantMessage.sessionID,
          error: ctx.assistantMessage.error,
        })
        yield* status.set(ctx.sessionID, { type: "idle" })
      })

      // Terminal settlement for a stream that ended without a reliable settlement. Same shape
      // as the auto=false overflow arm of halt: only message fields are overwritten, the
      // durable step-finish part keeps its own reason, and cleanup still persists the message.
      const settleIncomplete = Effect.fn("SessionProcessor.settleIncomplete")(function* (message: string) {
        const error = new NamedError.Unknown({ message }).toObject()
        ctx.assistantMessage.error = error
        ctx.assistantMessage.finish = "error"
        yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
        yield* status.set(ctx.sessionID, { type: "idle" })
      })

      // Undo this attempt's durable transcript and accounting before the next request is sent.
      // Runs from the retry seam, i.e. after the retry is authorized and before the backoff sleep,
      // so it never discards a retained attempt. Every writer here is typed `never`, so a failure
      // can only be a defect: it escapes the retry and is combined into the region's exit cause.
      const rollbackAttempt = Effect.fn("SessionProcessor.rollbackAttempt")(function* () {
        // Session aggregates recover through the same projection that applied these parts.
        yield* Effect.forEach(ctx.ownedParts, (partID) =>
          session.removePart({ sessionID: ctx.sessionID, messageID: ctx.assistantMessage.id, partID }),
        )
        const baseline = ctx.baseline
        ctx.assistantMessage.finish = baseline.finish
        ctx.assistantMessage.cost = baseline.cost
        ctx.assistantMessage.tokens = baseline.tokens
        ctx.assistantMessage.error = baseline.error
        ctx.assistantMessage.time.completed = baseline.timeCompleted
        yield* session.updateMessage(ctx.assistantMessage)
        // Dropped, never launched: nothing this attempt asked for may outlive the rollback.
        ctx.pendingSummaries = []
        // Open refs would make cleanup upsert the deleted rows back into existence during the
        // backoff; tool calls are retired by their existing paths instead.
        ctx.currentText = undefined
        ctx.reasoningMap = {}
      })

      // One interrupt body for both the attempt region and the retry/rollback region around it.
      // `aborted` is set before the settled-error guard because parse reads it.
      const abortAttempt = Effect.fn("SessionProcessor.abortAttempt")(function* () {
        aborted = true
        if (!ctx.assistantMessage.error) {
          yield* halt(new DOMException("Aborted", "AbortError"))
        }
      })

      const process = Effect.fn("SessionProcessor.process")(function* (
        streamInput: LLM.StreamInput,
        reactiveAllowed?: boolean,
      ) {
        reactiveAdmission = reactiveAllowed
        yield* Effect.logInfo("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
        })
        ctx.needsCompaction = false
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

        // Process-local incomplete budget. Raised before the retry is authorized, so the observable
        // arithmetic stays at most three physical attempts: two raises plus the exhausted settle.
        // The counter dies with this region and never carries into a later process.
        let incompleteRetries = 0
        const raiseIncomplete = (source: string) =>
          Effect.gen(function* () {
            if (incompleteRetries === INCOMPLETE_RETRY_LIMIT) return yield* settleIncomplete(source)
            incompleteRetries++
            yield* Effect.fail<RetryControl>({
              name: RETRY_CONTROL,
              data: { classification: "incomplete-stream", source, message: source },
            })
          })

        return yield* Effect.gen(function* () {
          yield* Effect.gen(function* () {
            ctx.currentText = undefined
            ctx.reasoningMap = {}
            ctx.evidence = emptyEvidence()
            ctx.ownedParts = []
            ctx.pendingSummaries = []
            // Checkpoint before the attempt mutates the message: rollback restores these values.
            // `tokens` is cloned because step-finish replaces the object reference per step.
            ctx.baseline = {
              finish: ctx.assistantMessage.finish,
              cost: ctx.assistantMessage.cost,
              tokens: structuredClone(ctx.assistantMessage.tokens),
              error: ctx.assistantMessage.error,
              timeCompleted: ctx.assistantMessage.time.completed,
            }
            primary = undefined
            yield* status.set(ctx.sessionID, { type: "busy" })
            const stream = llm.stream(streamInput)

            yield* stream.pipe(
              Stream.tap((event) => handleEvent(event)),
              Stream.takeUntil(() => ctx.needsCompaction),
              Stream.runDrain,
            )

            // The stream reached EOF without failing. Settle only when no reliable terminal
            // state was reached; an established terminal state keeps its existing outcome.
            if (ctx.evidence.incompleteMarkerSeen) {
              yield* raiseIncomplete("provider")
            } else if (!ctx.blocked && !ctx.needsCompaction && !ctx.assistantMessage.error) {
              const credible = ctx.evidence.hasSettledStep && !ctx.evidence.hasOpenStep
              if (!credible) {
                yield* raiseIncomplete("unsettled-step")
              } else if (
                ctx.evidence.lastStepUnknown &&
                !(ctx.evidence.hasVisibleText || ctx.evidence.hasToolCallEvidence)
              ) {
                yield* raiseIncomplete("empty-unknown")
              }
            }
          }).pipe(
            Effect.onInterrupt(() => abortAttempt()),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) =>
                Effect.fail(
                  // A mixed cause loses its interrupt identity through squash, so it travels as a
                  // control instead; an incomplete control has no interrupt reason and squash
                  // returns it unchanged, so both paths share this handler unchanged.
                  Cause.hasInterrupts(cause)
                    ? {
                        name: RETRY_CONTROL,
                        data: {
                          classification: "mixed-interrupt" as const,
                          source: "interrupt",
                          message: "attempt interrupted mid-failure",
                          // The raw cause is re-failed verbatim by halt; its error type is not
                          // tracked by the processor.
                          cause: cause as Cause.Cause<never>,
                        },
                      }
                    : Cause.squash(cause),
                ),
            ),
            Effect.retry(
              SessionRetry.policy({
                provider: input.model.providerID,
                parse,
                gate: () =>
                  !(ctx.observedToolActivity || ctx.dispatchedTextCompleteHook || ctx.needsCompaction || ctx.blocked),
                set: (info) => {
                  // Rollback precedes publication: if it dies, the status must not claim a retry
                  // that is not going to happen.
                  return rollbackAttempt().pipe(
                    Effect.andThen(
                      status.set(ctx.sessionID, {
                        type: "retry",
                        attempt: info.attempt,
                        message: info.message,
                        action: info.action,
                        next: info.next,
                      }),
                    ),
                  )
                },
              }),
            ),
            // Backoff and rollback cancellation never reaches the inner handler: the interrupted
            // sleep is inside the retry. Publishing the abort here covers that window, and the
            // guard keeps an already-settled terminal from being overwritten by the second trigger.
            Effect.onInterrupt(() => abortAttempt()),
            Effect.catch(halt),
            Effect.onExit((exit) =>
              Effect.gen(function* () {
                // Deferred summaries and cleanup are captured by one `Effect.exit`, so neither the
                // flush orchestration nor cleanup can replace the region's own cause. A successful
                // capture returns the original exit unchanged; a failed one keeps both identities.
                const done = yield* Effect.exit(finalize())
                if (Exit.isSuccess(done)) return
                // A region that failed keeps its own cause; a region whose failure `halt` presented
                // contributes the raw primary instead, so a finalization fault cannot erase it.
                const failure = Exit.isFailure(exit)
                  ? exit.cause
                  : primary === undefined
                    ? undefined
                    : Cause.die(primary)
                return yield* Effect.failCause(failure ? Cause.combine(failure, done.cause) : done.cause)
              }),
            ),
          )

          // An established terminal state outruns compaction: a settled error must not be
          // swallowed by returning "compact".
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          if (ctx.needsCompaction) return "compact"
          return "continue"
        })
      })

      return {
        get message() {
          return ctx.assistantMessage
        },
        updateToolCall,
        completeToolCall,
        process,
      } satisfies Handle
    })

    return Service.of({ create })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    Session.node,
    Config.node,
    Snapshot.node,
    Agent.node,
    LLM.node,
    Permission.node,
    Plugin.node,
    SessionSummary.node,
    SessionStatus.node,
    Image.node,
    EventV2Bridge.node,
    Database.node,
  ],
})

export * as SessionProcessor from "./processor"

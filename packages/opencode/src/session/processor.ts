import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Image } from "@/image/image"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Cause, Deferred, Duration, Effect, Exit, Layer, Context, Scope, Schema, Semaphore } from "effect"
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
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { Usage, isStaleReasoningFailure, type LLMEvent } from "@opencode-ai/llm"
import { SessionStaleReasoning } from "./stale-reasoning"

const DOOM_LOOP_THRESHOLD = 3
// Bounded tail of the newest *tool* parts to test for consecutive repeats (F-104). Counting
// tool parts directly (not a mixed window) prevents interleaved text from evading detection.
const DOOM_LOOP_TOOL_WINDOW = 24
// A retry re-issues the whole request and re-dispatches tools, so only a side-effecting
// call makes the turn non-idempotent; read-only tools are safe to run again.
const READ_ONLY_TOOLS = new Set(["read", "glob", "grep", "list", "lsp", "webfetch", "websearch"])
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
  // Terminal writer for a tool whose execution returned output but whose provider
  // request was aborted. Persists the aborted state instead of a false success (O2-04).
  readonly abortToolCall: (toolCallID: string) => Effect.Effect<void>
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
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
  // Last ToolPart written for this call. The processor is the sole writer of tool
  // parts during a turn, so reads are served from here rather than SQLite (F-001/F-024).
  part: SessionV1.ToolPart
  done: Deferred.Deferred<void>
}

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  // Tool metadata can arrive before the stream registers the call, so the latest
  // update per call id is held here until ensureToolCall creates the part.
  pendingToolUpdates: Map<string, (part: SessionV1.ToolPart) => SessionV1.ToolPart>
  shouldBreak: boolean
  snapshot: string | undefined
  // Tree hash captured by the previous step-finish. Nothing mutates the worktree
  // between step-finish and the next step-start, so it can seed the next baseline
  // without paying another full track() (F-068).
  lastSnapshot?: string
  blocked: boolean
  needsCompaction: boolean
  currentText: SessionV1.TextPart | undefined
  // PartIDs abandoned at a retry boundary. The next attempt reuses them so a fresh
  // generation replaces the failed attempt's row instead of appending a duplicate (O2-06).
  abandonedTextID?: SessionV1.TextPart["id"]
  abandonedReasoning: Record<string, SessionV1.ReasoningPart["id"]>
  reasoningMap: Record<string, SessionV1.ReasoningPart>
  lastToolFingerprint?: string
  recoveredStaleReasoning: boolean
}

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
    // Streaming deltas are non-durable and fire per token; accumulate them per part field and
    // flush on a short cadence (or before a part's final update) to cut per-token pipeline work.
    const DELTA_FLUSH_MS = 40
    type DeltaInput = Parameters<typeof session.updatePartDelta>[0]
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
        currentText: undefined,
        abandonedReasoning: {},
        reasoningMap: {},
        pendingToolUpdates: new Map(),
        recoveredStaleReasoning: false,
      }
      let aborted = false
      // A retry re-issues the whole provider request from the original snapshot and
      // the AI SDK re-dispatches tools, so once a tool call has been seen the turn
      // must not retry (non-idempotent side effects would run twice) — F-059.
      let toolExecuted = false
      // Delta-flush fibers are processor-scoped so cleanup interrupts any that are
      // still pending instead of letting them publish after the turn (F-048).
      const processScope = yield* Scope.make()
      // Buffers are keyed by partID (unique per part) so flushPart is O(1) with no key
      // concatenation per token (F-101/F-110). One flush loop per processor drains them on the
      // DELTA_FLUSH_MS cadence instead of a fiber per (part, field) window (F-102).
      const pendingDeltas = new Map<string, DeltaInput>()
      let flushing = false
      // The 40ms flush loop and a terminal flushPart can both publish for the same
      // part; serializing the publish keeps subscribers from observing a later delta
      // before an earlier one (O-21/F-022).
      const deltaLock = Semaphore.makeUnsafe(1)

      const flushDeltaCore = (partID: string) =>
        Effect.suspend(() => {
          const buffer = pendingDeltas.get(partID)
          if (!buffer) return Effect.void
          // Deleting before the publish keeps two flushes from publishing one buffer; a failed
          // publish restores the buffer so the delta survives for a later flush (F-103).
          pendingDeltas.delete(partID)
          return session.updatePartDelta(buffer).pipe(
            Effect.catchCause(() =>
              Effect.sync(() => {
                const latest = pendingDeltas.get(partID)
                pendingDeltas.set(partID, latest ? { ...buffer, delta: buffer.delta + latest.delta } : buffer)
              }),
            ),
          )
        })

      const flushDelta = (partID: string) => deltaLock.withPermits(1)(flushDeltaCore(partID))

      const flushPart = (partID: string) => flushDelta(partID)

      // Terminal full-part writes take the same permit as the 40 ms flush loop so an
      // in-flight delta can never land after the full text and resurrect a prefix (DRIFT-5).
      const writePart = <T extends SessionV1.Part>(part: T) => deltaLock.withPermits(1)(session.updatePart(part))

      const commitPart = <T extends SessionV1.Part>(part: T) =>
        deltaLock.withPermits(1)(
          Effect.gen(function* () {
            yield* flushDeltaCore(part.id)
            return yield* session.updatePart(part)
          }),
        )

      const flushLoop = Effect.gen(function* () {
        while (pendingDeltas.size > 0) {
          yield* Effect.sleep(Duration.millis(DELTA_FLUSH_MS))
          yield* Effect.forEach([...pendingDeltas.keys()], flushDelta, { discard: true })
        }
      }).pipe(Effect.ensuring(Effect.sync(() => (flushing = false))), Effect.forkIn(processScope))

      const queueDelta = (input: DeltaInput) =>
        Effect.gen(function* () {
          const buffer = pendingDeltas.get(input.partID)
          if (buffer) {
            // The buffer is private to this map, so accumulate in place (F-110).
            buffer.delta += input.delta
            return
          }
          pendingDeltas.set(input.partID, { ...input })
          if (flushing) return
          flushing = true
          yield* flushLoop
        })

      const parse = (e: unknown) =>
        MessageV2.fromError(e, {
          providerID: input.model.providerID,
          aborted,
        })

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        delete ctx.toolcalls[toolCallID]
        // A retry boundary or teardown must not leave a registered tool part pending or
        // running in SQLite, or replay sees a tool call that never resolved (DRIFT-6).
        if (call && (call.part.state.status === "pending" || call.part.state.status === "running")) {
          const end = Date.now()
          const metadata =
            "metadata" in call.part.state && isRecord(call.part.state.metadata) ? call.part.state.metadata : {}
          yield* writePart({
            ...call.part,
            state: {
              status: "error",
              input: call.part.state.input,
              error: "Tool execution aborted",
              metadata: { ...metadata, interrupted: true },
              time: { start: "time" in call.part.state ? call.part.state.time.start : end, end },
            },
          })
        }
        if (call) yield* Deferred.succeed(call.done, undefined).pipe(Effect.ignore)
      })

      const readToolCall = Effect.fn("SessionProcessor.readToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        if (!call) return undefined
        return { call, part: call.part }
      })

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) {
          ctx.pendingToolUpdates.set(toolCallID, update)
          return undefined
        }
        const part = yield* writePart(update(match.part))
        ctx.toolcalls[toolCallID] = { ...match.call, part }
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
        if (!match || match.part.state.status !== "running") {
          // Nothing left to complete; settle so teardown does not await a Deferred nobody resolves (F-103).
          yield* settleToolCall(toolCallID)
          return
        }
        const part = yield* writePart({
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
        ctx.toolcalls[toolCallID] = { ...match.call, part }
        yield* settleToolCall(toolCallID)
      })

      const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (toolCallID: string, error: unknown) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") {
          yield* settleToolCall(toolCallID)
          return false
        }
        const part = yield* writePart({
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
        ctx.toolcalls[toolCallID] = { ...match.call, part }
        if (error instanceof PermissionV1.RejectedError || error instanceof Question.RejectedError) {
          ctx.blocked = ctx.shouldBreak
        }
        yield* settleToolCall(toolCallID)
        return true
      })

      const abortToolCall = Effect.fn("SessionProcessor.abortToolCall")(function* (toolCallID: string) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") {
          yield* settleToolCall(toolCallID)
          return
        }
        const metadata = isRecord(match.part.state.metadata) ? match.part.state.metadata : {}
        const part = yield* writePart({
          ...match.part,
          state: {
            status: "error",
            input: match.part.state.input,
            error: "Tool execution aborted",
            metadata: { ...metadata, interrupted: true },
            time: { start: match.part.state.time.start, end: Date.now() },
          },
        })
        ctx.toolcalls[toolCallID] = { ...match.call, part }
        yield* settleToolCall(toolCallID)
      })

      const finishReasoning = Effect.fn("SessionProcessor.finishReasoning")(function* (reasoningID: string) {
        if (!(reasoningID in ctx.reasoningMap)) return
        // commitPart flushes coalesced deltas before the final full-part write so ordering
        // holds for every caller, including step-finish which has no reasoning-end (F-021).
        // oxlint-disable-next-line no-self-assign -- reactivity trigger
        ctx.reasoningMap[reasoningID].text = ctx.reasoningMap[reasoningID].text
        ctx.reasoningMap[reasoningID].time = { ...ctx.reasoningMap[reasoningID].time, end: Date.now() }
        yield* commitPart(ctx.reasoningMap[reasoningID])
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
          ctx.toolcalls[input.id] = { ...existing.call, part }
          return { call: ctx.toolcalls[input.id], part }
        }
        const created = yield* session.updatePart({
          id: PartID.ascending(),
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
          part: created,
        }
        const pending = ctx.pendingToolUpdates.get(input.id)
        if (pending) {
          ctx.pendingToolUpdates.delete(input.id)
          const updated = yield* updateToolCall(input.id, pending)
          if (updated) return { call: ctx.toolcalls[input.id], part: updated }
        }
        return { call: ctx.toolcalls[input.id], part: created }
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
            if (value.id in ctx.reasoningMap) return
            ctx.reasoningMap[value.id] = {
              id: ctx.abandonedReasoning[value.id] ?? PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            delete ctx.abandonedReasoning[value.id]
            yield* session.updatePart(ctx.reasoningMap[value.id])
            return

          case "reasoning-delta":
            // Match dev: silently drop orphan deltas (no preceding reasoning-start).
            if (!(value.id in ctx.reasoningMap)) return
            ctx.reasoningMap[value.id].text += value.text
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* queueDelta({
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
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            yield* ensureToolCall(value)
            return

          case "tool-input-delta":
            // Deltas never carry providerExecuted, so a tracked call makes ensureToolCall a no-op.
            if (value.id in ctx.toolcalls) return
            yield* ensureToolCall(value)
            return

          case "tool-input-end": {
            yield* ensureToolCall(value)
            return
          }

          case "tool-call": {
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            if (!READ_ONLY_TOOLS.has(value.name)) toolExecuted = true
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

            const inputNeedle = JSON.stringify(input)
            // Only a repeated identical call can form a doom loop; skip the full parts read otherwise.
            const fingerprint = `${value.name}:${inputNeedle}`
            if (ctx.lastToolFingerprint !== fingerprint) {
              ctx.lastToolFingerprint = fingerprint
              return
            }

            const tail = yield* MessageV2.toolPartsTail(ctx.assistantMessage.id, DOOM_LOOP_TOOL_WINDOW).pipe(
              Effect.provideService(Database.Service, database),
            )
            const recentParts = tail
              .filter((part): part is SessionV1.ToolPart => part.type === "tool")
              .slice(-DOOM_LOOP_THRESHOLD)

            if (
              recentParts.length !== DOOM_LOOP_THRESHOLD ||
              !recentParts.every(
                (part) =>
                  part.tool === value.name &&
                  part.state.status !== "pending" &&
                  JSON.stringify(part.state.input) === inputNeedle,
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
            yield* failToolCall(value.id, value.error ?? new Error(value.message))
            return
          }

          case "provider-error":
            throw new Error(value.message)

          case "step-start":
            if (!ctx.snapshot) ctx.snapshot = ctx.lastSnapshot ?? (yield* snapshot.track())
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              snapshot: ctx.snapshot,
              type: "step-start",
            })
            return

          case "step-finish": {
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
            yield* session.updatePart({
              id: PartID.ascending(),
              reason: value.reason,
              snapshot: completedSnapshot,
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "step-finish",
              tokens: usage.tokens,
              cost: usage.cost,
            })
            yield* session.updateMessage(ctx.assistantMessage)
            const stepUnchanged = ctx.snapshot !== undefined && completedSnapshot === ctx.snapshot
            if (ctx.snapshot) {
              // track() stages then write-trees, so an unchanged tree proves the
              // snapshot index already equals ctx.snapshot and patch() would diff
              // to an empty file list. Skip its redundant stage + diff subprocesses.
              const patch = stepUnchanged
                ? { hash: ctx.snapshot, files: [] as string[] }
                : yield* snapshot.patch(
                    ctx.snapshot,
                    completedSnapshot !== undefined ? { to: completedSnapshot } : undefined,
                  )
              if (patch.files.length) {
                yield* session.updatePart({
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
            // Reuse the baseline only when no tool was still running at step-finish; a tool
            // mutating the worktree after this capture would corrupt the next step's diff.
            ctx.lastSnapshot = Object.keys(ctx.toolcalls).length === 0 ? completedSnapshot : undefined
            if (!stepUnchanged) {
              yield* summary
                .summarize({
                  sessionID: ctx.sessionID,
                  messageID: ctx.assistantMessage.parentID,
                })
                .pipe(Effect.ignore, Effect.forkIn(scope))
            }
            if (
              !ctx.assistantMessage.summary &&
              isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
            ) {
              ctx.needsCompaction = true
            }
            return
          }

          case "text-start":
            ctx.currentText = {
              id: ctx.abandonedTextID ?? PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "text",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            ctx.abandonedTextID = undefined
            yield* writePart(ctx.currentText)
            return

          case "text-delta":
            if (!ctx.currentText) return
            ctx.currentText.text += value.text
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* queueDelta({
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
            yield* commitPart(ctx.currentText)
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
            yield* session.updatePart({
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

        if (ctx.currentText) {
          const end = Date.now()
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          yield* commitPart(ctx.currentText)
          ctx.currentText = undefined
        }

        for (const part of Object.values(ctx.reasoningMap)) {
          const end = Date.now()
          yield* commitPart({
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
        ctx.pendingToolUpdates.clear()
        ctx.assistantMessage.time.completed = Date.now()
        yield* session.updateMessage(ctx.assistantMessage)
        yield* Scope.close(processScope, Exit.void)
      })

      const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
        yield* Effect.logError("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
          error: errorMessage(e),
          stack: e instanceof Error ? e.stack : undefined,
        })
        const error = parse(e)
        if (SessionV1.ContextOverflowError.isInstance(error)) {
          if ((yield* config.get()).compaction?.auto === false && !ctx.assistantMessage.summary) {
            ctx.assistantMessage.error = error
            ctx.assistantMessage.finish = "error"
            yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
            yield* status.set(ctx.sessionID, { type: "idle" })
            return
          }
          ctx.needsCompaction = true
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

      const outputStarted = () =>
        ctx.currentText !== undefined || Object.keys(ctx.reasoningMap).length > 0 || Object.keys(ctx.toolcalls).length > 0

      // Strip rejected caller-bound reasoning from request and persisted parts, then replay once.
      const recoverStaleReasoning = Effect.fn("SessionProcessor.recoverStaleReasoning")(function* (
        streamInput: LLM.StreamInput,
      ) {
        SessionStaleReasoning.stripRequest(streamInput.messages)
        yield* SessionStaleReasoning.persist(session, ctx.sessionID)
        yield* Effect.logInfo("recovered stale encrypted reasoning", {
          "session.id": ctx.sessionID,
          messageID: ctx.assistantMessage.id,
        })
        ctx.currentText = undefined
        ctx.reasoningMap = {}
        yield* status.set(ctx.sessionID, { type: "busy" })
        yield* llm.stream(streamInput).pipe(
          Stream.tap((event) => handleEvent(event)),
          Stream.takeUntil(() => ctx.needsCompaction),
          Stream.runDrain,
        )
      })

      // cleanup only runs after the last attempt, so a retry must finalize the aborted
      // attempt's in-flight parts, buffers and tool calls or they are orphaned (F-023).
      const finalizeRetryInflight = Effect.fn("SessionProcessor.finalizeRetryInflight")(function* () {
        if (ctx.currentText) {
          const end = Date.now()
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          yield* commitPart(ctx.currentText)
          ctx.abandonedTextID = ctx.currentText.id
          ctx.currentText = undefined
        }
        for (const [reasoningID, part] of Object.entries(ctx.reasoningMap)) {
          const end = Date.now()
          yield* commitPart({ ...part, time: { start: part.time.start ?? end, end } })
          ctx.abandonedReasoning[reasoningID] = part.id
        }
        ctx.reasoningMap = {}
        yield* Effect.forEach(Object.keys(ctx.toolcalls), settleToolCall, { discard: true })
      })

      const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
        yield* Effect.logInfo("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
        })
        ctx.needsCompaction = false
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

        return yield* Effect.gen(function* () {
          yield* Effect.gen(function* () {
            ctx.currentText = undefined
            ctx.reasoningMap = {}
            yield* status.set(ctx.sessionID, { type: "busy" })
            const stream = llm.stream(streamInput)

            yield* stream.pipe(
              Stream.tap((event) => handleEvent(event)),
              Stream.takeUntil(() => ctx.needsCompaction),
              Stream.runDrain,
            )
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                aborted = true
                if (!ctx.assistantMessage.error) {
                  yield* halt(new DOMException("Aborted", "AbortError"))
                }
              }),
            ),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => Effect.fail(Cause.squash(cause)),
            ),
            Effect.retry({
              schedule: SessionRetry.policy({
                provider: input.model.providerID,
                parse,
                set: (info) =>
                  Effect.gen(function* () {
                    yield* finalizeRetryInflight()
                    yield* status.set(ctx.sessionID, {
                      type: "retry",
                      attempt: info.attempt,
                      message: info.message,
                      action: info.action,
                      next: info.next,
                    })
                  }),
              }),
              while: () => !toolExecuted,
            }),
            Effect.catchIf(
              (error) => !ctx.recoveredStaleReasoning && !outputStarted() && isStaleReasoningFailure(error),
              () =>
                Effect.gen(function* () {
                  ctx.recoveredStaleReasoning = true
                  yield* recoverStaleReasoning(streamInput)
                }).pipe(Effect.catch(halt)),
            ),
            Effect.catch(halt),
            Effect.ensuring(cleanup()),
          )

          if (ctx.needsCompaction) return "compact"
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          return "continue"
        })
      })

      return {
        get message() {
          return ctx.assistantMessage
        },
        updateToolCall,
        completeToolCall,
        abortToolCall,
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

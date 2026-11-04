export * as ClaudeSessions from "./sessions.js"

import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type {
  LanguageModelV3FunctionTool,
  LanguageModelV3Prompt,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCallPart,
} from "@ai-sdk/provider"
import { Effect, Fiber, Semaphore } from "effect"
import { ClaudeIO } from "./io.js"
import type { ClaudeStatus } from "./status.js"
import { ClaudeQueryOptions } from "./query-options.js"
import { ClaudeSession } from "./session.js"
import { SessionRecord } from "../sync/record.js"
import { Checkpoints } from "../sync/checkpoints.js"
import { SyncDecision } from "../sync/decide.js"
import { CatchUp } from "../sync/catch-up.js"
import { ConvertToClaudeMessage } from "../language-model/convert-to-claude-message.js"
import { PendingTools } from "../tools/pending.js"
import { ToolNames } from "../tools/names.js"
import { ToolResult } from "../tools/result.js"

export const HANDOVER_MS = 10_000
export const IDLE_MS = 5 * 60_000

export interface Request {
  // Only primary calls have one. Side calls run in a throwaway process.
  readonly sessionID?: string
  // Native OpenCode fork lineage, or the session supplying a compaction/generate snapshot.
  readonly sourceID?: string
  readonly compaction?: boolean
  readonly model: string
  readonly effort?: Options["effort"]
  readonly maxOutputTokens?: number
  readonly connection?: Readonly<Record<string, string>>
  readonly system: NonNullable<Options["systemPrompt"]>
  readonly prompt: LanguageModelV3Prompt
  readonly tools: readonly LanguageModelV3FunctionTool[]
  readonly emit: (message: SDKMessage) => void
}

interface LiveProcess {
  readonly session: ClaudeSession.Interface
  readonly pending: PendingTools.Interface
  model: string
  effort?: Options["effort"]
  // Settings that need a new process to change. Model and effort change on the running one.
  readonly launch: string
  waiting?: string[]
}

interface ToolContinuation {
  readonly end: number
  readonly results: Array<{ id: string; result: ToolResult.Result }>
}

interface Entry {
  readonly lock: Semaphore.Semaphore
  process?: LiveProcess
  record?: SessionRecord.Record
  idle?: Fiber.Fiber<void, never>
  active?: Fiber.Fiber<unknown, unknown>
}

export interface Interface {
  readonly run: (request: Request) => Effect.Effect<void, Error>
  // OpenCode stopped running the session, so a turn still waiting for tool results will not get them.
  readonly idle: (sessionID: string) => Effect.Effect<void>
}

const launch = (request: Request) =>
  JSON.stringify([request.maxOutputTokens, request.connection, request.system, request.tools])

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))
const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: toError })
const attemptSync = <A>(run: () => A) => Effect.try({ try: run, catch: toError })

export function registry() {
  const entries = new Map<string, Entry>()
  // Side calls share startup/draining with chat, but are tracked only until their request ends.
  const temporary = new Set<Entry>()
  let owners = 0
  let handover: Fiber.Fiber<void, never> | undefined

  const interrupt = Effect.fn("ClaudeSessions.interrupt")(function* (entry: Entry) {
    const process = entry.process
    if (!process) return
    yield* attempt(() => process.session.interrupt())
    process.pending.clear()
    process.waiting = undefined
  }, Effect.uninterruptible)

  const stop = Effect.fn("ClaudeSessions.stop")(function* (entry: Entry) {
    const process = entry.process
    if (!process) return
    yield* attempt(() => process.session.stop()).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          process.pending.clear()
          entry.process = undefined
        }),
      ),
    )
  }, Effect.uninterruptible)

  const armIdle = Effect.fn("ClaudeSessions.armIdle")(function* (entry: Entry) {
    if (entry.idle) yield* Fiber.interrupt(entry.idle)
    entry.idle = yield* Effect.sleep(IDLE_MS).pipe(
      Effect.andThen(entry.lock.withPermit(stop(entry))),
      Effect.catch((error) => Effect.logWarning(error)),
      Effect.forkDetach,
    )
  })

  const closeEntries = Effect.fn("ClaudeSessions.closeEntries")(function* () {
    for (const entry of [...entries.values(), ...temporary]) {
      if (entry.active) yield* Fiber.interrupt(entry.active)
      // The active turn's finalizer can install a new idle timer.
      if (entry.idle) yield* Fiber.interrupt(entry.idle)
      yield* entry.lock.withPermit(stop(entry)).pipe(Effect.catch((error) => Effect.logWarning(error)))
    }
    entries.clear()
  })

  const cancelHandover = Effect.fn("ClaudeSessions.cancelHandover")(function* () {
    if (!handover) return
    yield* Fiber.interrupt(handover)
    handover = undefined
  })

  const close = Effect.fn("ClaudeSessions.close")(function* () {
    yield* cancelHandover()
    yield* closeEntries()
  })

  const attach = Effect.fn("ClaudeSessions.attach")(function* (input: {
    readonly io: ClaudeIO.Interface
    readonly status: ClaudeStatus.Interface
    readonly storage: SessionRecord.Storage
    readonly directory: string
  }) {
    const records = SessionRecord.make(input.storage)
    owners++
    yield* cancelHandover()
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        owners--
        if (owners !== 0) return
        if (entries.size === 0 && temporary.size === 0) return
        handover = yield* Effect.sleep(HANDOVER_MS).pipe(Effect.andThen(closeEntries()), Effect.forkDetach)
      }),
    )

    const open = Effect.fn("ClaudeSessions.open")(function* (entry: Entry, request: Request) {
      const starting = !entry.process
      // A cancel can only land while waiting for ready, so a started process is always recorded and stopped.
      const opened = yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (!entry.process) {
            const executable = input.io.which()
            if (!executable) {
              yield* input.status.report({ type: "missing" })
              return yield* Effect.fail(new Error("Install Claude Code and run `claude auth login` first"))
            }
            const pending = PendingTools.make()
            const session = yield* attempt(async () =>
              ClaudeSession.start(
                await ClaudeQueryOptions.session({
                  executable,
                  io: input.io,
                  connection: request.connection,
                  directory: input.directory,
                  model: request.model,
                  effort: request.effort,
                  maxOutputTokens: request.maxOutputTokens,
                  system: request.system,
                  tools: request.tools,
                  pending,
                  persist: request.sessionID !== undefined,
                  resume: entry.record?.claudeSessionID,
                }),
              ),
            )
            entry.process = { session, pending, model: request.model, effort: request.effort, launch: launch(request) }
          }
          const process = entry.process
          const probe = yield* restore(
            attempt(() => process.session.ready).pipe(
              Effect.timeoutOrElse({
                duration: "30 seconds",
                orElse: () => Effect.fail(new Error("claude did not start within 30 seconds")),
              }),
            ),
          ).pipe(Effect.onError(() => stop(entry).pipe(Effect.ignore)))
          return { process, probe }
        }),
      )
      const process = opened.process
      // A new process reports its version, login and models, which keeps the model list current without a separate check.
      if (starting) yield* input.status.report({ type: "ready", probe: opened.probe })
      // Apply controls before sending input or releasing parked tool results.
      if (process.model !== request.model) {
        yield* attempt(() => process.session.setModel(request.model))
        process.model = request.model
      }
      if (process.effort !== request.effort) {
        yield* attempt(() => process.session.setEffort(request.effort))
        process.effort = request.effort
      }
      return process
    })

    const turn = Effect.fn("ClaudeSessions.turn")(function* (
      entry: Entry,
      request: Request,
      start: number,
      continuation?: ToolContinuation,
    ) {
      // Validate before opening a process: a rejected rebuild must not pair an empty process with the old record.
      const content = yield* attemptSync(() => {
        if (request.sessionID || entry.record) return CatchUp.content(request.prompt, continuation?.end ?? start)
        return ConvertToClaudeMessage.content(request.prompt)
      })
      const live = yield* open(entry, request)
      const session = live.session

      const addsUserMessage = !continuation || content.length > 0
      const userID = addsUserMessage ? crypto.randomUUID() : undefined

      const reply: Array<LanguageModelV3TextPart | LanguageModelV3ToolCallPart> = []
      const toolMessages = new Map<string, string>()
      const seen = new Set<string>()
      let messageID: string | undefined
      const waiting: string[] = []

      const emit = (message: SDKMessage) => {
        if (message.type === "system" && message.subtype === "init" && request.tools.length > 0) {
          const connected = message.mcp_servers.some(
            (server) => server.name === "opencode" && server.status === "connected",
          )
          if (!connected) throw new Error("The OpenCode tool server did not connect to Claude Code")
        }
        if (
          message.type === "assistant" &&
          message.parent_tool_use_id === null &&
          !message.error &&
          !seen.has(message.uuid)
        ) {
          seen.add(message.uuid)
          messageID = message.uuid
          for (const part of message.message.content) {
            if (part.type === "text") {
              reply.push({ type: "text", text: part.text })
              continue
            }
            if (part.type !== "tool_use") continue
            const name = ToolNames.original(part.name, request.tools)
            if (!name) continue
            live.pending.expect(part.id, part.name)
            waiting.push(part.id)
            reply.push({ type: "tool-call", toolCallId: part.id, toolName: name, input: part.input })
          }
        }
        if (message.type === "user" && message.uuid && Array.isArray(message.message.content)) {
          for (const part of message.message.content) {
            if (part.type === "tool_result") toolMessages.set(part.tool_use_id, message.uuid)
          }
        }
        request.emit(message)
      }

      let completed = false
      let interrupted = false
      let started = false
      let parked = false
      const step = Effect.gen(function* () {
        if (!continuation) session.begin(content, userID)
        if (continuation) {
          if (userID !== undefined) session.addUser(content, userID)
          for (const item of continuation.results) {
            live.pending.resolve(item.id, item.result)
          }
        }
        started = true
        const outcome = yield* attempt(() => session.readStep(emit, request.tools))
        parked = outcome === "tools"
        completed = true
        live.waiting = parked ? waiting : undefined
      })

      // A tool boundary ends only the OpenCode step; the Claude turn waits for the results. Anything else interrupts and drains it.
      const interruptUnlessParked = Effect.gen(function* () {
        if (parked) return
        yield* interrupt(entry).pipe(Effect.orDie)
      })

      const saveRecord = Effect.gen(function* () {
        if (!request.sessionID || !session.persisted || !started) return
        const history =
          completed || interrupted
            ? Checkpoints.build({
                prompt: request.prompt,
                previous: entry.record,
                userID,
                reply: completed ? reply : [],
                messageID: completed ? messageID : undefined,
                toolMessages,
              })
            : undefined
        entry.record = { claudeSessionID: session.id, history, interrupted: interrupted && !completed }
        yield* records.set(request.sessionID, entry.record)
      })

      yield* step.pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true
          }),
        ),
        Effect.ensuring(interruptUnlessParked),
        Effect.ensuring(saveRecord),
      )
    })

    const release = Effect.fn("ClaudeSessions.release")(function* (entry: Entry, request: Request) {
      entry.active = undefined
      if (!request.sessionID) {
        yield* stop(entry).pipe(Effect.catch((error) => Effect.logWarning(error)))
        const sessionID = entry.record?.claudeSessionID
        if (sessionID)
          yield* attempt(() => input.io.remove(sessionID)).pipe(Effect.catch((error) => Effect.logWarning(error)))
        temporary.delete(entry)
        return
      }
      // A turn waiting for tool results is still busy. Subagents, permission prompts and questions can take longer
      // than IDLE_MS, so idle() starts the timer once OpenCode stops running the session.
      if (entry.process?.waiting) return
      yield* armIdle(entry)
    })

    const branch = Effect.fn("ClaudeSessions.branch")(function* (
      entry: Entry,
      request: Request,
      source?: SessionRecord.Record,
    ) {
      const boundary = SyncDecision.boundary(request.prompt, source)
      if (!source || !boundary) return 0
      // Validate catch-up input before creating a forked transcript on disk.
      yield* attemptSync(() => CatchUp.content(request.prompt, boundary.start))
      const fork = yield* attempt(() => input.io.fork(source.claudeSessionID, boundary.messageID))
      if (!fork) return 0
      const history = boundary.history.map((checkpoint) => ({
        hash: checkpoint.hash,
        claudeMessageID: checkpoint.claudeMessageID ? fork.messages.get(checkpoint.claudeMessageID) : undefined,
      }))
      entry.record = { claudeSessionID: fork.sessionID, history }
      return boundary.start
    }, Effect.uninterruptible)

    const snapshot = Effect.fn("ClaudeSessions.snapshot")(function* (entry: Entry, request: Request) {
      const sourceID = request.sourceID
      if (!sourceID) return 0
      const source = entries.get(sourceID)
      const copy = Effect.gen(function* () {
        // Compaction ends the old primary context. Generate only takes a read-only snapshot.
        if (request.compaction && source) yield* stop(source)
        const record = source?.record ?? (yield* records.get(sourceID))
        return yield* branch(entry, request, record)
      })
      // Hold the source only while copying its settled prefix, never during side-call inference.
      if (!source) return yield* copy
      return yield* source.lock.withPermit(copy)
    })

    const prepare = Effect.fn("ClaudeSessions.prepare")(function* (entry: Entry, request: Request) {
      // Retire an exited or incompatible process first: once we continue its parked turn, open() must not replace it.
      if (entry.process) {
        const needsRestart = entry.process.session.ended || entry.process.launch !== launch(request)
        if (needsRestart) yield* stop(entry)
      }

      if (!request.sessionID) {
        const start = yield* snapshot(entry, request)
        return { start, continuation: undefined }
      }

      if (!entry.record) entry.record = yield* records.get(request.sessionID)
      const decision = SyncDecision.decide(request.prompt, entry.record)
      const start = yield* Effect.gen(function* () {
        if (decision.kind === "fresh" || decision.kind === "changed") {
          yield* stop(entry)
          const previous = entry.record
          entry.record = undefined
          if (decision.kind === "changed") return yield* branch(entry, request, previous)
          if (!previous) return yield* snapshot(entry, request)
          return decision.start
        }
        if (entry.process || !entry.record) return decision.start
        const sessionID = entry.record.claudeSessionID
        const exists = yield* attempt(() => input.io.sessionExists(sessionID))
        if (exists) return decision.start
        entry.record = undefined
        return 0
      })

      const live = entry.process
      if (!live || !live.session.running || !live.waiting) return { start, continuation: undefined }
      const collected = yield* attemptSync(() => ToolResult.collect(request.prompt, start))
      const continuation: ToolContinuation = { end: collected.end, results: [] }
      for (const id of live.waiting) {
        const result = collected.results.get(id)
        if (!result) {
          yield* stop(entry)
          entry.record = undefined
          return { start: 0, continuation: undefined }
        }
        continuation.results.push({ id, result })
      }
      if (collected.aborted) {
        // A stopped OpenCode turn needs a fresh Claude turn; addUser would only steer the old one.
        yield* interrupt(entry)
        return { start, continuation: undefined }
      }
      return { start, continuation }
    })

    const entryFor = (request: Request) => {
      if (request.sessionID) {
        const existing = entries.get(request.sessionID)
        if (existing) return existing
        const entry: Entry = { lock: Semaphore.makeUnsafe(1) }
        entries.set(request.sessionID, entry)
        return entry
      }
      const entry: Entry = { lock: Semaphore.makeUnsafe(1) }
      temporary.add(entry)
      return entry
    }

    const run = Effect.fn("ClaudeSessions.run")(function* (request: Request) {
      const entry = entryFor(request)
      yield* entry.lock.withPermit(
        Effect.gen(function* () {
          if (entry.idle) {
            yield* Fiber.interrupt(entry.idle)
            entry.idle = undefined
          }
          entry.active = yield* Effect.withFiber(Effect.succeed)
          const prepared = yield* prepare(entry, request)
          yield* turn(entry, request, prepared.start, prepared.continuation)
        }).pipe(Effect.ensuring(release(entry, request))),
      )
    })

    const idle = Effect.fn("ClaudeSessions.idle")(function* (sessionID: string) {
      const entry = entries.get(sessionID)
      // Other processes already have a timer, and a running request starts one when it ends.
      if (!entry?.process?.waiting || entry.active) return
      yield* armIdle(entry)
    })

    return { run, idle } satisfies Interface
  })

  return { attach, close }
}

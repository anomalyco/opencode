// SDK event subscription and prompt turn coordination.
//
// Creates a long-lived event stream subscription and feeds every event
// through the session-data reducer. The reducer produces scrollback commits
// and footer patches, which get forwarded to the footer through stream.ts.
//
// Prompt turns are one-at-a-time: runPromptTurn() sends the prompt to the
// SDK, arms a deferred Wait, and resolves when the session becomes idle.
// Prefer session.status idle events, but also poll session.status because some
// transports can miss status events while still delivering message events. If
// the turn is aborted (user interrupt), it flushes any in-progress parts as
// interrupted entries.
//
// The tick counter prevents stale idle events from resolving the wrong turn.
// We also re-check live session status before resolving an idle event so a
// delayed idle from an older turn cannot complete a newer busy turn.
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2"
import { Context, Deferred, Effect, Exit, Layer, Scope, Stream } from "effect"
import { makeRuntime } from "@/effect/run-service"
import {
  blockerStatus,
  bootstrapSessionData,
  createSessionData,
  flushInterrupted,
  pickBlockerView,
  reduceSessionData,
  type SessionData,
} from "./session-data"
import {
  bootstrapSubagentCalls,
  bootstrapSubagentData,
  clearFinishedSubagents,
  createSubagentData,
  listSubagentPermissions,
  listSubagentQuestions,
  listSubagentTabs,
  reduceSubagentData,
  sameSubagentTab,
  snapshotSelectedSubagentData,
  SUBAGENT_BOOTSTRAP_LIMIT,
  SUBAGENT_CALL_BOOTSTRAP_LIMIT,
  type SubagentData,
} from "./subagent-data"
import { traceFooterOutput, writeSessionOutput } from "./stream"
import type {
  FooterApi,
  FooterOutput,
  FooterPatch,
  FooterSubagentState,
  FooterSubagentTab,
  FooterView,
  RunFilePart,
  RunInput,
  RunPrompt,
  RunPromptPart,
  StreamCommit,
} from "./types"

type Trace = {
  write(type: string, data?: unknown): void
}

type StreamInput = {
  sdk: OpencodeClient
  sessionID: string
  thinking: boolean
  limits: () => Record<string, number>
  footer: FooterApi
  trace?: Trace
  signal?: AbortSignal
}

type Wait = {
  tick: number
  armed: boolean
  live: boolean
  done: Deferred.Deferred<void, unknown>
}

export type SessionTurnInput = {
  agent: string | undefined
  model: RunInput["model"]
  variant: string | undefined
  prompt: RunPrompt
  files: RunFilePart[]
  includeFiles: boolean
  signal?: AbortSignal
}

export type SessionTransport = {
  runPromptTurn(input: SessionTurnInput): Promise<void>
  selectSubagent(sessionID: string | undefined): void
  close(): Promise<void>
}

type State = {
  data: SessionData
  subagent: SubagentData
  wait?: Wait
  tick: number
  fault?: unknown
  footerView: FooterView
  blockerTick: number
  selectedSubagent?: string
  blockers: Map<string, number>
}

type TransportService = {
  readonly runPromptTurn: (input: SessionTurnInput) => Effect.Effect<void, unknown>
  readonly selectSubagent: (sessionID: string | undefined) => Effect.Effect<void>
  readonly close: () => Effect.Effect<void>
}

class Service extends Context.Service<Service, TransportService>()("@opencode/RunStreamTransport") {}

function sid(event: Event): string | undefined {
  if (event.type === "message.updated") {
    return event.properties.sessionID
  }

  if (event.type === "message.part.delta") {
    return event.properties.sessionID
  }

  if (event.type === "message.part.updated") {
    return event.properties.part.sessionID
  }

  if (
    event.type === "permission.asked" ||
    event.type === "permission.replied" ||
    event.type === "question.asked" ||
    event.type === "question.replied" ||
    event.type === "question.rejected" ||
    event.type === "session.error" ||
    event.type === "session.status"
  ) {
    return event.properties.sessionID
  }

  return undefined
}

function isEvent(value: unknown): value is Event {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const type = Reflect.get(value, "type")
  const properties = Reflect.get(value, "properties")
  return typeof type === "string" && !!properties && typeof properties === "object"
}

function active(event: Event, sessionID: string): boolean {
  if (sid(event) !== sessionID) {
    return false
  }

  if (event.type === "message.updated") {
    return event.properties.info.role === "assistant"
  }

  if (event.type === "message.part.delta" || event.type === "message.part.updated") {
    return false
  }

  if (event.type !== "session.status") {
    return true
  }

  return event.properties.status.type !== "idle"
}

// Races the turn's deferred completion against an abort signal.
function waitTurn(done: Wait["done"], signal: AbortSignal) {
  return Effect.raceAll([
    Deferred.await(done).pipe(Effect.as("idle" as const), Effect.exit),
    Effect.callback<"abort">((resume) => {
      if (signal.aborted) {
        resume(Effect.succeed("abort"))
        return Effect.void
      }

      const onAbort = () => {
        signal.removeEventListener("abort", onAbort)
        resume(Effect.succeed("abort"))
      }

      signal.addEventListener("abort", onAbort, { once: true })
      return Effect.sync(() => signal.removeEventListener("abort", onAbort))
    }).pipe(Effect.exit),
  ]).pipe(Effect.flatMap((exit) => (Exit.isFailure(exit) ? Effect.failCause(exit.cause) : Effect.succeed(exit.value))))
}

export function formatUnknownError(error: unknown): string {
  if (typeof error === "string") {
    return error
  }

  if (error instanceof Error) {
    return error.message || error.name
  }

  if (error && typeof error === "object") {
    const value = error as { message?: unknown; name?: unknown }
    if (typeof value.message === "string" && value.message.trim()) {
      return value.message
    }

    if (typeof value.name === "string" && value.name.trim()) {
      return value.name
    }
  }

  return "unknown error"
}

function sameView(a: FooterView, b: FooterView) {
  if (a.type !== b.type) {
    return false
  }

  if (a.type === "prompt" && b.type === "prompt") {
    return true
  }

  if (a.type === "prompt" || b.type === "prompt") {
    return false
  }

  return a.request === b.request
}

function blockerOrder(order: Map<string, number>, id: string) {
  return order.get(id) ?? Number.MAX_SAFE_INTEGER
}

function firstByOrder<T extends { id: string }>(left: T[], right: T[], order: Map<string, number>) {
  return [...left, ...right].sort((a, b) => {
    const next = blockerOrder(order, a.id) - blockerOrder(order, b.id)
    if (next !== 0) {
      return next
    }

    return a.id.localeCompare(b.id)
  })[0]
}

function pickView(data: SessionData, subagent: SubagentData, order: Map<string, number>): FooterView {
  return pickBlockerView({
    permission: firstByOrder(data.permissions, listSubagentPermissions(subagent), order),
    question: firstByOrder(data.questions, listSubagentQuestions(subagent), order),
  })
}

function composeFooter(input: {
  patch?: FooterPatch
  subagent?: FooterSubagentState
  current: FooterView
  previous: FooterView
}) {
  let footer: FooterOutput | undefined

  if (input.subagent) {
    footer = {
      ...footer,
      subagent: input.subagent,
    }
  }

  if (!sameView(input.previous, input.current)) {
    footer = {
      ...footer,
      view: input.current,
    }
  }

  if (input.current.type !== "prompt") {
    footer = {
      ...footer,
      patch: {
        ...input.patch,
        status: blockerStatus(input.current),
      },
    }
    return footer
  }

  if (input.patch) {
    footer = {
      ...footer,
      patch: input.patch,
    }
    return footer
  }

  if (input.previous.type !== "prompt") {
    footer = {
      ...footer,
      patch: {
        status: "",
      },
    }
  }

  return footer
}

function traceTabs(trace: Trace | undefined, prev: FooterSubagentTab[], next: FooterSubagentTab[]) {
  const before = new Map(prev.map((item) => [item.sessionID, item]))
  const after = new Map(next.map((item) => [item.sessionID, item]))

  for (const [sessionID, tab] of after) {
    if (sameSubagentTab(before.get(sessionID), tab)) {
      continue
    }

    trace?.write("subagent.tab", {
      sessionID,
      tab,
    })
  }

  for (const sessionID of before.keys()) {
    if (after.has(sessionID)) {
      continue
    }

    trace?.write("subagent.tab", {
      sessionID,
      cleared: true,
    })
  }
}

function createLayer(input: StreamInput) {
  return Layer.fresh(
    Layer.effect(
      Service,
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const abort = yield* Scope.provide(scope)(
          Effect.acquireRelease(
            Effect.sync(() => new AbortController()),
            (abort) => Effect.sync(() => abort.abort()),
          ),
        )
        let closed = false
        let closeStream = () => {}
        const halt = () => {
          abort.abort()
        }
        const stop = () => {
          input.signal?.removeEventListener("abort", halt)
          abort.abort()
          closeStream()
        }
        const closeScope = () => {
          if (closed) {
            return Effect.void
          }

          closed = true
          stop()
          return Scope.close(scope, Exit.void)
        }

        input.signal?.addEventListener("abort", halt, { once: true })
        yield* Effect.addFinalizer(() => closeScope())

        const events = yield* Scope.provide(scope)(
          Effect.acquireRelease(
            Effect.promise(() =>
              input.sdk.event.subscribe(undefined, {
                signal: abort.signal,
              }),
            ),
            (events) =>
              Effect.sync(() => {
                void events.stream.return(undefined).catch(() => {})
              }),
          ),
        )
        closeStream = () => {
          void events.stream.return(undefined).catch(() => {})
        }
        input.trace?.write("recv.subscribe", {
          sessionID: input.sessionID,
        })

        const state: State = {
          data: createSessionData(),
          subagent: createSubagentData(),
          tick: 0,
          footerView: { type: "prompt" },
          blockerTick: 0,
          blockers: new Map(),
        }
        const recovering = new Set<string>()

        const currentSubagentState = () => {
          if (state.selectedSubagent && !state.subagent.tabs.has(state.selectedSubagent)) {
            state.selectedSubagent = undefined
          }

          return snapshotSelectedSubagentData(state.subagent, state.selectedSubagent)
        }

        const seedBlocker = (id: string) => {
          if (state.blockers.has(id)) {
            return
          }

          state.blockerTick += 1
          state.blockers.set(id, state.blockerTick)
        }

        const trackBlocker = (event: Event) => {
          if (event.type !== "permission.asked" && event.type !== "question.asked") {
            return
          }

          if (event.properties.sessionID !== input.sessionID && !state.subagent.tabs.has(event.properties.sessionID)) {
            return
          }

          seedBlocker(event.properties.id)
        }

        const releaseBlocker = (event: Event) => {
          if (
            event.type !== "permission.replied" &&
            event.type !== "question.replied" &&
            event.type !== "question.rejected"
          ) {
            return
          }

          state.blockers.delete(event.properties.requestID)
        }

        const syncFooter = (commits: StreamCommit[], patch?: FooterPatch, nextSubagent?: FooterSubagentState) => {
          const current = pickView(state.data, state.subagent, state.blockers)
          const footer = composeFooter({
            patch,
            subagent: nextSubagent,
            current,
            previous: state.footerView,
          })

          if (commits.length === 0 && !footer) {
            state.footerView = current
            return
          }

          input.trace?.write("reduce.output", {
            commits,
            footer: traceFooterOutput(footer),
          })
          writeSessionOutput(
            {
              footer: input.footer,
              trace: input.trace,
            },
            {
              commits,
              footer,
            },
          )
          state.footerView = current
        }

        const recoverQuestion = Effect.fn("RunStreamTransport.recoverQuestion")(function* (partID: string) {
          if (recovering.has(partID)) {
            return
          }

          recovering.add(partID)
          try {
            while (!closed && !abort.signal.aborted && !input.footer.isClosed) {
              if (state.data.questions.length > 0 || !state.data.tools.has(partID)) {
                return
              }

              const questions = yield* Effect.promise(() => input.sdk.question.list()).pipe(
                Effect.map((item) => (item.data ?? []).filter((request) => request.sessionID === input.sessionID)),
                Effect.orElseSucceed(() => []),
              )
              if (state.data.questions.length > 0 || !state.data.tools.has(partID)) {
                return
              }

              if (questions.length > 0) {
                bootstrapSessionData({
                  data: state.data,
                  messages: [],
                  permissions: [],
                  questions,
                })
                for (const request of questions) {
                  seedBlocker(request.id)
                }
                input.trace?.write("question.recover", {
                  sessionID: input.sessionID,
                  requests: questions.map((request) => request.id),
                })
                syncFooter([])
                return
              }

              yield* Effect.sleep("250 millis")
            }
          } finally {
            recovering.delete(partID)
          }
        })

        const messages = (sessionID: string, limit: number) =>
          Effect.promise(() =>
            input.sdk.session.messages({
              sessionID,
              limit,
            }),
          ).pipe(
            Effect.map((item) => item.data ?? []),
            Effect.orElseSucceed(() => []),
          )

        const bootstrap = Effect.fn("RunStreamTransport.bootstrap")(function* () {
          const [messagesList, children, permissions, questions] = yield* Effect.all(
            [
              messages(input.sessionID, SUBAGENT_BOOTSTRAP_LIMIT),
              Effect.promise(() =>
                input.sdk.session.children({
                  sessionID: input.sessionID,
                }),
              ).pipe(
                Effect.map((item) => item.data ?? []),
                Effect.orElseSucceed(() => []),
              ),
              Effect.promise(() => input.sdk.permission.list()).pipe(
                Effect.map((item) => item.data ?? []),
                Effect.orElseSucceed(() => []),
              ),
              Effect.promise(() => input.sdk.question.list()).pipe(
                Effect.map((item) => item.data ?? []),
                Effect.orElseSucceed(() => []),
              ),
            ],
            {
              concurrency: "unbounded",
            },
          )

          bootstrapSessionData({
            data: state.data,
            messages: messagesList,
            permissions: permissions.filter((item) => item.sessionID === input.sessionID),
            questions: questions.filter((item) => item.sessionID === input.sessionID),
          })
          bootstrapSubagentData({
            data: state.subagent,
            messages: messagesList,
            children,
            permissions,
            questions,
          })

          const sessions = [
            ...new Set(
              listSubagentPermissions(state.subagent)
                .filter((item) => item.tool && item.metadata?.input === undefined)
                .map((item) => item.sessionID),
            ),
          ]
          yield* Effect.forEach(
            sessions,
            (sessionID) =>
              messages(sessionID, SUBAGENT_CALL_BOOTSTRAP_LIMIT).pipe(
                Effect.tap((messagesList) =>
                  Effect.sync(() => {
                    bootstrapSubagentCalls({
                      data: state.subagent,
                      sessionID,
                      messages: messagesList,
                    })
                  }),
                ),
              ),
            {
              concurrency: "unbounded",
              discard: true,
            },
          )

          for (const request of [
            ...state.data.permissions,
            ...listSubagentPermissions(state.subagent),
            ...state.data.questions,
            ...listSubagentQuestions(state.subagent),
          ].sort((a, b) => a.id.localeCompare(b.id))) {
            seedBlocker(request.id)
          }

          const snapshot = currentSubagentState()
          traceTabs(input.trace, [], snapshot.tabs)
          syncFooter([], undefined, snapshot)
        })

        const idle = Effect.fn("RunStreamTransport.idle")((fallback: boolean) =>
          Effect.promise(() => input.sdk.session.status()).pipe(
            Effect.map((out) => {
              const item = out.data?.[input.sessionID]
              return !item || item.type === "idle"
            }),
            Effect.orElseSucceed(() => fallback),
          ),
        )

        const fail = Effect.fn("RunStreamTransport.fail")(function* (error: unknown) {
          if (state.fault) {
            return
          }

          state.fault = error
          const next = state.wait
          state.wait = undefined
          if (!next) {
            return
          }

          yield* Deferred.fail(next.done, error).pipe(Effect.ignore)
        })

        const touch = (event: Event) => {
          const next = state.wait
          if (!next || !active(event, input.sessionID)) {
            return
          }

          next.live = true
        }

        const complete = Effect.fn("RunStreamTransport.complete")(function* (next: Wait, fallback: boolean) {
          if (state.wait !== next || !next.armed || !next.live) {
            return
          }

          if (!(yield* idle(fallback)) || state.wait !== next) {
            return
          }

          state.tick = next.tick + 1
          state.wait = undefined
          yield* Deferred.succeed(next.done, undefined).pipe(Effect.ignore)
        })

        const mark = Effect.fn("RunStreamTransport.mark")(function* (event: Event) {
          if (
            event.type !== "session.status" ||
            event.properties.sessionID !== input.sessionID ||
            event.properties.status.type !== "idle"
          ) {
            return
          }

          const next = state.wait
          if (!next) {
            return
          }

          yield* complete(next, true)
        })

        const poll = Effect.fn("RunStreamTransport.poll")(function* (next: Wait, signal: AbortSignal) {
          while (state.wait === next && !signal.aborted && !input.footer.isClosed && !closed) {
            yield* Effect.sleep("250 millis")
            yield* complete(next, false)
          }
        })

        const flush = (type: "turn.abort" | "turn.cancel") => {
          const commits: StreamCommit[] = []
          flushInterrupted(state.data, commits)
          syncFooter(commits)
          input.trace?.write(type, {
            sessionID: input.sessionID,
          })
        }

        const watch = Effect.fn("RunStreamTransport.watch")(() =>
          Stream.fromAsyncIterable(events.stream, (error) =>
            error instanceof Error ? error : new Error(String(error)),
          ).pipe(
            Stream.takeUntil(() => input.footer.isClosed || abort.signal.aborted),
            Stream.runForEach(
              Effect.fn("RunStreamTransport.event")(function* (item: unknown) {
                if (input.footer.isClosed) {
                  abort.abort()
                  return
                }

                if (!isEvent(item)) {
                  return
                }

                const event = item
                input.trace?.write("recv.event", event)
                trackBlocker(event)

                const prev = event.type === "message.part.updated" ? listSubagentTabs(state.subagent) : undefined
                const next = reduceSessionData({
                  data: state.data,
                  event,
                  sessionID: input.sessionID,
                  thinking: input.thinking,
                  limits: input.limits(),
                })
                state.data = next.data

                if (
                  event.type === "message.part.updated" &&
                  event.properties.part.sessionID === input.sessionID &&
                  event.properties.part.type === "tool" &&
                  event.properties.part.tool === "question" &&
                  event.properties.part.state.status === "running" &&
                  state.data.questions.length === 0
                ) {
                  yield* recoverQuestion(event.properties.part.id).pipe(
                    Effect.forkIn(scope, { startImmediately: true }),
                    Effect.asVoid,
                  )
                }

                const changed = reduceSubagentData({
                  data: state.subagent,
                  event,
                  sessionID: input.sessionID,
                  thinking: input.thinking,
                  limits: input.limits(),
                })
                if (changed && prev) {
                  traceTabs(input.trace, prev, listSubagentTabs(state.subagent))
                }
                releaseBlocker(event)

                syncFooter(next.commits, next.footer?.patch, changed ? currentSubagentState() : undefined)

                touch(event)
                yield* mark(event)
              }),
            ),
            Effect.catch((error) => (abort.signal.aborted ? Effect.void : fail(error))),
            Effect.ensuring(
              Effect.gen(function* () {
                if (!abort.signal.aborted && !state.fault) {
                  yield* fail(new Error("session event stream closed"))
                }
                closeStream()
              }),
            ),
          ),
        )

        yield* bootstrap()
        yield* Scope.provide(scope)(watch().pipe(Effect.forkScoped))

        const runPromptTurn = Effect.fn("RunStreamTransport.runPromptTurn")(function* (next: SessionTurnInput) {
          if (closed || next.signal?.aborted || input.footer.isClosed) {
            return
          }

          if (state.fault) {
            yield* Effect.fail(state.fault)
            return
          }

          if (state.wait) {
            yield* Effect.fail(new Error("prompt already running"))
            return
          }

          const prev = listSubagentTabs(state.subagent)
          if (clearFinishedSubagents(state.subagent)) {
            const snapshot = currentSubagentState()
            traceTabs(input.trace, prev, snapshot.tabs)
            syncFooter([], undefined, snapshot)
          }

          const item: Wait = {
            tick: state.tick,
            armed: false,
            live: false,
            done: yield* Deferred.make<void, unknown>(),
          }
          state.wait = item
          state.data.announced = false

          const turn = new AbortController()
          const stop = () => {
            turn.abort()
          }
          next.signal?.addEventListener("abort", stop, { once: true })
          abort.signal.addEventListener("abort", stop, { once: true })
          yield* poll(item, turn.signal).pipe(Effect.forkIn(scope, { startImmediately: true }), Effect.asVoid)

          const req = {
            sessionID: input.sessionID,
            agent: next.agent,
            model: next.model,
            variant: next.variant,
            parts: [
              ...(next.includeFiles ? next.files : []),
              { type: "text" as const, text: next.prompt.text },
              ...next.prompt.parts,
            ],
          }
          const command = next.prompt.command
          const send = command
            ? Effect.sync(() => {
                input.trace?.write("send.command", { sessionID: input.sessionID, command: command.name })
              }).pipe(
                Effect.andThen(
                  Effect.promise(() =>
                    input.sdk.session.command(
                      {
                        sessionID: input.sessionID,
                        agent: next.agent,
                        model: next.model ? `${next.model.providerID}/${next.model.modelID}` : undefined,
                        variant: next.variant,
                        command: command.name,
                        arguments: command.arguments,
                        parts: [
                          ...(next.includeFiles ? next.files : []),
                          ...next.prompt.parts.filter(
                            (item): item is Extract<RunPromptPart, { type: "file" }> => item.type === "file",
                          ),
                        ],
                      },
                      { signal: turn.signal },
                    ),
                  ).pipe(
                    Effect.tap(() =>
                      Effect.sync(() => {
                        input.trace?.write("send.command.ok", {
                          sessionID: input.sessionID,
                          command: command.name,
                        })
                        item.armed = true
                        item.live = true
                      }),
                    ),
                    Effect.flatMap(() => Deferred.succeed(item.done, undefined).pipe(Effect.ignore)),
                    Effect.catch((error) => Deferred.fail(item.done, error).pipe(Effect.ignore)),
                    Effect.forkIn(scope, { startImmediately: true }),
                    Effect.asVoid,
                  ),
                ),
              )
            : Effect.sync(() => {
                input.trace?.write("send.prompt", req)
              }).pipe(
                Effect.andThen(
                  Effect.promise(() =>
                    input.sdk.session.promptAsync(req, {
                      signal: turn.signal,
                    }),
                  ),
                ),
                Effect.tap(() =>
                  Effect.sync(() => {
                    input.trace?.write("send.prompt.ok", {
                      sessionID: input.sessionID,
                    })
                    item.armed = true
                  }),
                ),
              )

          yield* send.pipe(
            Effect.flatMap(() => {
              if (turn.signal.aborted || next.signal?.aborted || input.footer.isClosed || closed) {
                if (state.wait === item) {
                  state.wait = undefined
                }
                flush("turn.abort")
                return Effect.void
              }

              if (!input.footer.isClosed && !state.data.announced) {
                input.trace?.write("ui.patch", {
                  phase: "running",
                  status: "waiting for assistant",
                })
                input.footer.event({
                  type: "turn.wait",
                })
              }

              if (state.tick > item.tick) {
                if (state.wait === item) {
                  state.wait = undefined
                }
                return Effect.void
              }

              return waitTurn(item.done, turn.signal).pipe(
                Effect.flatMap((status) =>
                  Effect.sync(() => {
                    if (state.wait === item) {
                      state.wait = undefined
                    }

                    if (status === "abort") {
                      flush("turn.abort")
                    }
                  }),
                ),
              )
            }),
            Effect.catch((error) => {
              if (state.wait === item) {
                state.wait = undefined
              }

              const canceled = turn.signal.aborted || next.signal?.aborted === true || input.footer.isClosed || closed
              if (canceled) {
                flush("turn.cancel")
                return Effect.void
              }

              if (error === state.fault) {
                return Effect.fail(error)
              }

              input.trace?.write("send.prompt.error", {
                sessionID: input.sessionID,
                error: formatUnknownError(error),
              })
              return Effect.fail(error)
            }),
            Effect.ensuring(
              Effect.sync(() => {
                input.trace?.write("turn.end", {
                  sessionID: input.sessionID,
                })
                next.signal?.removeEventListener("abort", stop)
                abort.signal.removeEventListener("abort", stop)
              }),
            ),
          )
          return
        })

        const selectSubagent = Effect.fn("RunStreamTransport.selectSubagent")((sessionID: string | undefined) =>
          Effect.sync(() => {
            if (closed) {
              return
            }

            const next = sessionID && state.subagent.tabs.has(sessionID) ? sessionID : undefined
            if (state.selectedSubagent === next) {
              return
            }

            state.selectedSubagent = next
            syncFooter([], undefined, currentSubagentState())
          }),
        )

        const close = Effect.fn("RunStreamTransport.close")(function* () {
          yield* closeScope()
        })

        return Service.of({
          runPromptTurn,
          selectSubagent,
          close,
        })
      }),
    ),
  )
}

// Opens an SDK event subscription and returns a SessionTransport.
//
// The background `watch` loop consumes every SDK event, runs it through the
// reducer, and writes output to the footer. When a session.status idle
// event arrives, it resolves the current turn's Wait so runPromptTurn()
// can return.
//
// The transport is single-turn: only one runPromptTurn() call can be active
// at a time. The prompt queue enforces this from above.
export async function createSessionTransport(input: StreamInput): Promise<SessionTransport> {
  const runtime = makeRuntime(Service, createLayer(input))
  await runtime.runPromise(() => Effect.void)

  return {
    runPromptTurn: (next) => runtime.runPromise((svc) => svc.runPromptTurn(next)),
    selectSubagent: (sessionID) => runtime.runSync((svc) => svc.selectSubagent(sessionID)),
    close: () => runtime.runPromise((svc) => svc.close()),
  }
}

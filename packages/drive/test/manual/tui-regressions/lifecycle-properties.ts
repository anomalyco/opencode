import { defineScript, Llm } from "../../../src/index.js"
import type { OpenCode } from "../../../src/index.js"
import { Deferred, Effect, Queue, Stream } from "effect"
import { run } from "./state-machine.js"

const seed = readInteger("OPENCODE_DRIVE_SEED", 1, Number.MAX_SAFE_INTEGER)
const steps = readInteger("OPENCODE_DRIVE_STEPS", 12, 1_000)

interface RecordedEvent {
  readonly index: number
  readonly type: string
  readonly sessionID?: unknown
  readonly data: unknown
}

type Model =
  | {
      readonly phase: "idle"
      readonly sessionID?: SessionID
      readonly prompt?: string
      readonly output?: string
    }
  | {
      readonly phase: "pending"
      readonly sessionID: SessionID
      readonly prompt: string
      readonly output?: string
      readonly pendingPrompt: string
    }
  | {
      readonly phase: "streaming"
      readonly sessionID: SessionID
      readonly prompt: string
      readonly output?: string
      readonly reasoning?: string
      readonly queuedPrompt?: string
      readonly tool?: {
        readonly callID: string
        readonly question: string
        readonly phase: "input" | "running"
        readonly startedAfter: number
      }
    }

type SessionID = Effect.Success<
  ReturnType<OpenCode["session"]["list"]>
>["data"][number]["id"]

interface ResponseControl {
  readonly id: string
  readonly output: Queue.Queue<Llm.Output>
  readonly ended: Deferred.Deferred<void>
}

export default defineScript({
  run: ({ ui, llm, opencode, artifacts }) =>
    Effect.scoped(Effect.gen(function* () {
      const responses = yield* Queue.unbounded<ResponseControl>()
      const eventQueue = yield* Queue.unbounded<RecordedEvent>()
      const events: Array<RecordedEvent> = []
      let activeResponse: ResponseControl | undefined
      let eventSequence = 0

      yield* llm.serve((request) =>
        Stream.unwrap(Effect.gen(function* () {
          const output = yield* Queue.unbounded<Llm.Output>()
          const ended = yield* Deferred.make<void>()
          yield* Queue.offer(responses, { id: request.id, output, ended })
          return Stream.fromQueue(output).pipe(
            Stream.takeUntil((item) => item.type === "finish" || item.type === "disconnect"),
            Stream.ensuring(Deferred.succeed(ended, undefined).pipe(Effect.asVoid)),
          )
        })),
      )
      yield* opencode.event.subscribe().pipe(
        Stream.runForEach((event) => {
          const recorded: RecordedEvent = {
            index: eventSequence++,
            type: event.type,
            ...(event.data !== null &&
            typeof event.data === "object" &&
            "sessionID" in event.data
              ? { sessionID: event.data.sessionID }
              : {}),
            data: event.data,
          }
          events.push(recorded)
          if (events.length > 100) events.shift()
          return Queue.offer(eventQueue, recorded).pipe(Effect.asVoid)
        }),
        Effect.forkScoped,
      )

      const currentSession = Effect.fn("LifecycleProperties.currentSession")(function* () {
        const sessions = yield* opencode.session.list({ limit: 1, order: "desc" })
        const sessionID = sessions.data[0]?.id
        if (sessionID === undefined) return yield* Effect.fail(new Error("no current session"))
        return sessionID
      })

      const waitForEvent = Effect.fn("LifecycleProperties.waitForEvent")(function* (
        type: string,
        sessionID: SessionID | undefined,
        after: number,
      ) {
        while (true) {
          const event = yield* Queue.take(eventQueue)
          if (
            event.index > after &&
            event.type === type &&
            (sessionID === undefined || event.sessionID === sessionID)
          ) return event
        }
      }, (effect, type) =>
        effect.pipe(
          Effect.timeoutOrElse({
            duration: 10_000,
            orElse: () => Effect.fail(new Error(`timed out waiting for ${type}`)),
          }),
        ))

      const waitForResponse = Effect.fn("LifecycleProperties.waitForResponse")(function* () {
        if (activeResponse !== undefined)
          return yield* Effect.fail(new Error(`LLM response ${activeResponse.id} is already active`))
        while (true) {
          const response = yield* Queue.take(responses)
          if (yield* Deferred.isDone(response.ended)) continue
          activeResponse = response
          return
        }
      }, (effect) =>
        effect.pipe(
          Effect.timeoutOrElse({
            duration: 10_000,
            orElse: () => Effect.fail(new Error("timed out waiting for an LLM response")),
          }),
        ))

      const sendOutput = Effect.fn("LifecycleProperties.sendOutput")(function* (
        item: Llm.Output,
      ) {
        const response = activeResponse
        if (response === undefined) return yield* Effect.fail(new Error("no active LLM response"))
        yield* Queue.offer(response.output, item)
      })

      const endResponse = Effect.fn("LifecycleProperties.endResponse")(function* (item: Llm.Output) {
        const response = activeResponse
        if (response === undefined) return yield* Effect.fail(new Error("no active LLM response"))
        yield* Queue.offer(response.output, item)
        yield* Deferred.await(response.ended)
        activeResponse = undefined
      }, (effect) =>
        effect.pipe(
          Effect.timeoutOrElse({
            duration: 10_000,
            orElse: () => Effect.fail(new Error("timed out waiting for the LLM response to end")),
          }),
        ))

      const promptOwners = Effect.fn("LifecycleProperties.promptOwners")(function* (
        sessionID: SessionID,
        prompt: string,
      ) {
        const [messages, pending] = yield* Effect.all([
          opencode.message.list({ sessionID, limit: 20, order: "desc" }),
          opencode.session.pending.list({ sessionID }),
        ], { concurrency: "unbounded" })
        return {
          projected: messages.data.filter(
            (message) => message.type === "user" && message.text === prompt,
          ).length,
          pending: pending.filter(
            (input) => input.type === "user" && input.data.text === prompt,
          ).length,
        }
      })

      const assertAssistantContent = Effect.fn("LifecycleProperties.assertAssistantContent")(function* (
        state: Extract<Model, { phase: "streaming" }>,
      ) {
        if (
          state.output === undefined &&
          state.reasoning === undefined &&
          state.tool === undefined
        ) return
        const messages = yield* opencode.message.list({
          sessionID: state.sessionID,
          limit: 20,
          order: "desc",
        })
        const assistant = messages.data.find((message) => message.type === "assistant")
        if (
          assistant?.type === "assistant" &&
          (state.output === undefined ||
            assistant.content.some(
              (part) => part.type === "text" && part.text === state.output,
            )) &&
          (state.reasoning === undefined ||
            assistant.content.some(
              (part) => part.type === "reasoning" && part.text === state.reasoning,
            )) &&
          (state.tool === undefined ||
            assistant.content.some(
              (part) =>
                part.type === "tool" &&
                part.id === state.tool?.callID &&
                part.state.status === "error" &&
                part.state.error.type === "aborted",
            ))
        ) return
        return yield* Effect.fail(new Error("server projection lost settled assistant content"))
      })

      const idleAfter = (
        state: Extract<Model, { phase: "streaming" }>,
      ): Model => ({
        phase: "idle",
        sessionID: state.sessionID,
        prompt: state.prompt,
        output: state.output,
      })

      const afterInterrupted = Effect.fn("LifecycleProperties.afterInterrupted")(function* (
        state: Extract<Model, { phase: "streaming" }>,
      ) {
        if (state.queuedPrompt === undefined) return idleAfter(state)
        const owners = yield* promptOwners(state.sessionID, state.queuedPrompt)
        if (owners.pending === 1 && owners.projected === 0)
          return {
            phase: "pending",
            sessionID: state.sessionID,
            prompt: state.prompt,
            output: state.output,
            pendingPrompt: state.queuedPrompt,
          } satisfies Model
        return yield* Effect.fail(
          new Error(
            `interrupted prompt has ${owners.projected} projected and ${owners.pending} pending owners`,
          ),
        )
      })

      const afterProviderFailure = Effect.fn("LifecycleProperties.afterProviderFailure")(function* (
        state: Extract<Model, { phase: "streaming" }>,
        after: number,
      ) {
        if (state.queuedPrompt === undefined) return idleAfter(state)
        const started = yield* waitForEvent("session.execution.started", state.sessionID, after)
        yield* waitForEvent("session.input.promoted", state.sessionID, started.index)
        const owners = yield* promptOwners(state.sessionID, state.queuedPrompt)
        if (owners.pending !== 0 || owners.projected !== 1)
          return yield* Effect.fail(
            new Error(
              `recovered prompt has ${owners.projected} projected and ${owners.pending} pending owners`,
            ),
          )
        yield* waitForResponse()
        return {
          phase: "streaming",
          sessionID: state.sessionID,
          prompt: state.queuedPrompt,
        } satisfies Model
      })

      const final = yield* run<Model>({
        context: {
          ui,
          artifacts,
          evidence: () => Effect.succeed({ events }),
        },
        initial: { phase: "idle" },
        seed,
        steps,
        transitions: [
          {
            name: "submit",
            enabled: (state) => state.phase !== "streaming",
            run: (state, step) =>
              Effect.gen(function* () {
                if (state.phase === "streaming") return state
                const prompt = `lifecycle-prompt-${step}`
                const after = eventSequence - 1
                yield* ui.submit(prompt)
                const admitted = state.phase === "pending"
                  ? yield* waitForEvent("session.input.admitted", state.sessionID, after)
                  : undefined
                const started = yield* waitForEvent(
                  "session.execution.started",
                  state.phase === "pending" ? state.sessionID : undefined,
                  admitted?.index ?? after,
                )
                const sessionID = state.phase === "pending" ? state.sessionID : yield* currentSession()
                if (started.sessionID !== sessionID)
                  return yield* Effect.fail(new Error("execution started for an unexpected session"))
                if (state.phase === "pending") {
                  const first = yield* waitForEvent("session.input.promoted", sessionID, started.index)
                  yield* waitForEvent("session.input.promoted", sessionID, first.index)
                  const [previous, current] = yield* Effect.all([
                    promptOwners(sessionID, state.pendingPrompt),
                    promptOwners(sessionID, prompt),
                  ], { concurrency: "unbounded" })
                  if (
                    previous.projected !== 1 ||
                    previous.pending !== 0 ||
                    current.projected !== 1 ||
                    current.pending !== 0
                  )
                    return yield* Effect.fail(
                      new Error(
                        `resumed prompts have previous ${previous.projected}/${previous.pending} and current ${current.projected}/${current.pending} projected/pending owners`,
                      ),
                    )
                  yield* waitForResponse()
                  return { phase: "streaming", sessionID, prompt }
                }
                yield* waitForResponse()
                return { phase: "streaming", sessionID, prompt }
              }),
          },
          {
            name: "emit-text",
            enabled: (state) =>
              state.phase === "streaming" &&
              state.output === undefined &&
              state.tool === undefined,
            run: (state, step) =>
              Effect.gen(function* () {
                if (state.phase !== "streaming") return state
                const text = `lifecycle-output-${step}`
                const after = eventSequence - 1
                yield* sendOutput(Llm.text(text, { delay: 0, chunkSize: 100 }))
                yield* waitForEvent("session.text.started", state.sessionID, after)
                return { ...state, output: text }
              }),
          },
          {
            name: "emit-reasoning",
            enabled: (state) =>
              state.phase === "streaming" &&
              state.reasoning === undefined &&
              state.tool === undefined,
            run: (state, step) =>
              Effect.gen(function* () {
                if (state.phase !== "streaming") return state
                const reasoning = `lifecycle-reasoning-${step}`
                const after = eventSequence - 1
                yield* sendOutput(Llm.reasoning(reasoning, { delay: 0, chunkSize: 100 }))
                yield* waitForEvent("session.reasoning.started", state.sessionID, after)
                return { ...state, reasoning }
              }),
          },
          {
            name: "start-tool-input",
            enabled: (state) => state.phase === "streaming" && state.tool === undefined,
            run: (state, step) =>
              Effect.gen(function* () {
                if (state.phase !== "streaming") return state
                const callID = `call_lifecycle_${step}`
                const question = `lifecycle-tool-question-${step}`
                const after = eventSequence - 1
                yield* sendOutput(
                  Llm.toolCall(
                    {
                      index: 0,
                      id: callID,
                      name: "question",
                      input: {
                        questions: [
                          {
                            question,
                            header: "Lifecycle",
                            options: [
                              {
                                label: "Continue",
                                description: "Continue the lifecycle simulation.",
                              },
                            ],
                            multiple: false,
                          },
                        ],
                      },
                    },
                    { delay: 20, chunkSize: 100 },
                  ),
                )
                const started = yield* waitForEvent(
                  "session.tool.input.started",
                  state.sessionID,
                  after,
                )
                return {
                  ...state,
                  tool: {
                    callID,
                    question,
                    phase: "input" as const,
                    startedAfter: started.index,
                  },
                }
              }),
          },
          {
            name: "await-tool-execution",
            enabled: (state) => state.phase === "streaming" && state.tool?.phase === "input",
            run: (state) =>
              Effect.gen(function* () {
                if (state.phase !== "streaming" || state.tool?.phase !== "input") return state
                yield* endResponse(Llm.finish("tool-calls"))
                yield* waitForEvent(
                  "session.tool.called",
                  state.sessionID,
                  state.tool.startedAfter,
                )
                yield* ui.waitFor(state.tool.question, { timeout: 10_000 })
                return { ...state, tool: { ...state.tool, phase: "running" as const } }
              }),
          },
          {
            name: "queue-prompt",
            enabled: (state) =>
              state.phase === "streaming" &&
              state.queuedPrompt === undefined &&
              state.tool === undefined,
            run: (state, step) =>
              Effect.gen(function* () {
                if (state.phase !== "streaming") return state
                const queuedPrompt = `queued-prompt-${step}`
                const after = eventSequence - 1
                yield* ui.submit(queuedPrompt)
                yield* waitForEvent("session.input.admitted", state.sessionID, after)
                return { ...state, queuedPrompt }
              }),
          },
          {
            name: "finish",
            enabled: (state) =>
              state.phase === "streaming" &&
              state.tool === undefined &&
              (state.output !== undefined || state.reasoning !== undefined),
            run: (state) =>
              Effect.gen(function* () {
                if (state.phase !== "streaming") return state
                const after = eventSequence - 1
                yield* endResponse(Llm.finish())
                if (state.queuedPrompt !== undefined) {
                  yield* waitForEvent("session.input.promoted", state.sessionID, after)
                  yield* assertAssistantContent(state)
                  const owners = yield* promptOwners(state.sessionID, state.queuedPrompt)
                  if (owners.projected !== 1 || owners.pending !== 0)
                    return yield* Effect.fail(
                      new Error(
                        `promoted prompt has ${owners.projected} projected and ${owners.pending} pending owners`,
                      ),
                    )
                  yield* waitForResponse()
                  return {
                    phase: "streaming",
                    sessionID: state.sessionID,
                    prompt: state.queuedPrompt,
                  }
                }
                yield* waitForEvent("session.execution.succeeded", state.sessionID, after)
                yield* assertAssistantContent(state)
                return idleAfter(state)
              }),
          },
          {
            name: "interrupt",
            enabled: (state) => state.phase === "streaming",
            run: (state) =>
              Effect.gen(function* () {
                if (state.phase !== "streaming") return state
                const after = eventSequence - 1
                yield* opencode.session.interrupt({ sessionID: state.sessionID })
                yield* waitForEvent("session.execution.interrupted", state.sessionID, after)
                if (state.tool?.phase !== "running")
                  yield* endResponse(
                    Llm.text("discarded-after-interrupt", { delay: 0, chunkSize: 100 }),
                  )
                yield* assertAssistantContent(state)
                return yield* afterInterrupted(state)
              }),
          },
          {
            name: "provider-disconnect",
            enabled: (state) => state.phase === "streaming" && state.tool === undefined,
            run: (state) =>
              Effect.gen(function* () {
                if (state.phase !== "streaming") return state
                const after = eventSequence - 1
                yield* endResponse(Llm.disconnect())
                const failed = yield* waitForEvent("session.execution.failed", state.sessionID, after)
                yield* assertAssistantContent(state)
                return yield* afterProviderFailure(state, failed.index)
              }),
          },
        ],
        invariants: [
          {
            name: "latest prompt remains visible",
            check: (state) =>
              state.phase === "streaming" && state.queuedPrompt !== undefined
                ? ui.waitFor(state.queuedPrompt, { timeout: 10_000 }).pipe(Effect.asVoid)
                : state.phase === "pending"
                ? ui.waitFor(state.pendingPrompt, { timeout: 10_000 }).pipe(Effect.asVoid)
                : state.prompt === undefined
                ? Effect.void
                : ui.waitFor(state.prompt, { timeout: 10_000 }).pipe(Effect.asVoid),
          },
          {
            name: "settled output remains visible",
            check: (state) =>
              state.phase === "streaming" || state.output === undefined
                ? Effect.void
                : ui.waitFor(state.output, { timeout: 10_000 }).pipe(Effect.asVoid),
          },
          {
            name: "active output remains visible",
            check: (state) =>
              state.phase !== "streaming" || state.output === undefined
                ? Effect.void
                : ui.waitFor(state.output, { timeout: 10_000 }).pipe(Effect.asVoid),
          },
          {
            name: "running tool remains visible",
            check: (state) =>
              state.phase === "streaming" && state.tool?.phase === "running"
                ? ui.waitFor(state.tool.question, { timeout: 10_000 }).pipe(Effect.asVoid)
                : Effect.void,
          },
          {
            name: "settled composer is actionable",
            check: (state) =>
              state.phase !== "streaming"
                ? ui.waitFor((current) => current.focused.editor, { timeout: 10_000 }).pipe(Effect.asVoid)
                : Effect.void,
          },
          {
            name: "server projection retains the latest prompt",
            check: (state) =>
              state.sessionID === undefined || state.prompt === undefined
                ? Effect.void
                : Effect.gen(function* () {
                    const sessionID = state.sessionID
                    const prompt = state.prompt
                    if (sessionID === undefined || prompt === undefined) return
                    const messages = yield* opencode.message.list({
                      sessionID,
                      limit: 20,
                      order: "desc",
                    })
                    if (messages.data.some((message) => message.type === "user" && message.text === prompt))
                      return
                    return yield* Effect.fail(new Error(`server projection lost prompt: ${prompt}`))
                  }),
          },
          {
            name: "queued prompt has exactly one owner",
            check: (state) =>
              (state.phase === "streaming"
                ? state.queuedPrompt
                : state.phase === "pending"
                ? state.pendingPrompt
                : undefined) === undefined ||
              state.sessionID === undefined
                ? Effect.void
                : Effect.gen(function* () {
                    const ownedPrompt = state.phase === "streaming"
                      ? state.queuedPrompt
                      : state.phase === "pending"
                      ? state.pendingPrompt
                      : undefined
                    const sessionID = state.sessionID
                    if (ownedPrompt === undefined || sessionID === undefined) return
                    const owners = yield* promptOwners(sessionID, ownedPrompt)
                    if (owners.projected + owners.pending === 1) return
                    return yield* Effect.fail(
                      new Error(
                        `queued prompt has ${owners.projected} projected and ${owners.pending} pending owners: ${ownedPrompt}`,
                      ),
                    )
                  }),
          },
          {
            name: "settled session has no pending input",
            check: (state) =>
              state.phase !== "idle" || state.sessionID === undefined
                ? Effect.void
                : Effect.gen(function* () {
                    const sessionID = state.sessionID
                    if (sessionID === undefined) return
                    const pending = yield* opencode.session.pending.list({ sessionID })
                    if (pending.length === 0) return
                    return yield* Effect.fail(new Error(`settled session retained ${pending.length} pending input(s)`))
                  }),
          },
          {
            name: "transport defects are not rendered",
            check: () =>
              Effect.forEach(["UnknownError", "RpcClientDefect"], (text) =>
                ui.matches(text).pipe(
                  Effect.filterOrFail((visible) => !visible, () => new Error(`rendered internal error: ${text}`)),
                ),
              ).pipe(Effect.asVoid),
          },
        ],
      })

      if (final.phase === "streaming") {
        const after = eventSequence - 1
        if (final.tool !== undefined) {
          yield* opencode.session.interrupt({ sessionID: final.sessionID })
          yield* waitForEvent("session.execution.interrupted", final.sessionID, after)
          if (final.tool.phase === "input")
            yield* endResponse(
              Llm.text("discarded-after-interrupt", { delay: 0, chunkSize: 100 }),
            )
          yield* assertAssistantContent(final)
        } else {
          yield* endResponse(Llm.finish())
          if (final.queuedPrompt !== undefined) {
            const promoted = yield* waitForEvent("session.input.promoted", final.sessionID, after)
            yield* waitForResponse()
            yield* endResponse(Llm.finish())
            yield* waitForEvent("session.execution.succeeded", final.sessionID, promoted.index)
          } else {
            yield* waitForEvent("session.execution.succeeded", final.sessionID, after)
          }
        }
      }
    })),
})

function readInteger(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new Error(`${name} must be an integer between 0 and ${maximum}`)
  return value
}

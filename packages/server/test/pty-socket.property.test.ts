import { expect, test } from "bun:test"
import { Cause, Effect, Fiber, Queue } from "effect"
import { Socket } from "effect/socket"
import FastCheck from "fast-check"
import { type Outbound, runPtySocket } from "../src/handlers/pty-socket"

// Latencies are mostly scheduler yields so interleavings stay dense and fast; a few are real sleeps.
type Latency = { readonly yields: number } | { readonly millis: number }

type Step =
  | { readonly type: "inbound"; readonly message: string | Uint8Array }
  | { readonly type: "outbound"; readonly frame: string | Uint8Array }
  | { readonly type: "serverClose"; readonly code: number }
  | { readonly type: "clientClose"; readonly code: number }
  | { readonly type: "readError" }
  | { readonly type: "writeError" }
  | { readonly type: "interrupt" }

type Scenario = {
  readonly replay: ReadonlyArray<string | Uint8Array>
  readonly steps: ReadonlyArray<{ readonly step: Step; readonly delay: Latency }>
  readonly reader: Latency
  readonly open: Latency | undefined
  readonly message: ReadonlyArray<Latency>
  readonly write: ReadonlyArray<Latency>
  readonly batch: number
}

type Terminal = "close" | "readError" | "writeError" | "interrupt"

type Entry =
  | { readonly type: "reader" | "openStart" | "openEnd" | "detach" }
  | { readonly type: "messageStart" | "messageEnd"; readonly message: string | Uint8Array }
  | { readonly type: "write"; readonly chunk: Outbound }
  | { readonly type: "terminal"; readonly terminal: Terminal }

const latency: FastCheck.Arbitrary<Latency> = FastCheck.oneof(
  { weight: 12, arbitrary: FastCheck.record({ yields: FastCheck.nat(6) }) },
  { weight: 1, arbitrary: FastCheck.record({ millis: FastCheck.integer({ min: 1, max: 3 }) }) },
)
const payload = FastCheck.oneof(FastCheck.string({ maxLength: 8 }), FastCheck.uint8Array({ maxLength: 8 }))
const code = FastCheck.constantFrom(1000, 1001, 1006, 4404)
const step: FastCheck.Arbitrary<Step> = FastCheck.oneof(
  { weight: 8, arbitrary: FastCheck.record({ type: FastCheck.constant("inbound"), message: payload }) },
  { weight: 8, arbitrary: FastCheck.record({ type: FastCheck.constant("outbound"), frame: payload }) },
  { weight: 1, arbitrary: FastCheck.record({ type: FastCheck.constant("serverClose"), code }) },
  { weight: 1, arbitrary: FastCheck.record({ type: FastCheck.constant("clientClose"), code }) },
  { weight: 1, arbitrary: FastCheck.record({ type: FastCheck.constant("readError") }) },
  { weight: 1, arbitrary: FastCheck.record({ type: FastCheck.constant("writeError") }) },
  { weight: 1, arbitrary: FastCheck.record({ type: FastCheck.constant("interrupt") }) },
)
const scenario: FastCheck.Arbitrary<Scenario> = FastCheck.record({
  replay: FastCheck.array(payload, { maxLength: 4 }),
  steps: FastCheck.array(FastCheck.record({ step, delay: latency }), { maxLength: 24 }),
  reader: latency,
  open: FastCheck.option(latency, { nil: undefined }),
  message: FastCheck.array(latency, { minLength: 1, maxLength: 4 }),
  write: FastCheck.array(latency, { minLength: 1, maxLength: 4 }),
  batch: FastCheck.integer({ min: 1, max: 3 }),
})

const wait = (value: Latency) =>
  Effect.gen(function* () {
    if ("millis" in value) return yield* Effect.sleep(value.millis)
    for (let i = 0; i < value.yields; i++) yield* Effect.yieldNow
  })

const nonEmpty = <A>(values: ReadonlyArray<A>): values is readonly [A, ...Array<A>] => values.length > 0

const socketError = (reason: Socket.SocketError["reason"]) => new Socket.SocketError({ reason })

// Drives one connection through the scenario against an in-memory socket and records every observable event.
const simulate = (input: Scenario) =>
  Effect.gen(function* () {
    const inbound = yield* Queue.unbounded<string | Uint8Array, Socket.SocketError>()
    const outbox = yield* Queue.unbounded<Outbound>()
    const log: Entry[] = []
    const sent: Array<string | Uint8Array> = []
    const offered: Outbound[] = [...input.replay]
    const state = { failNextWrite: false, writes: 0, messages: 0, detached: 0 }
    yield* Queue.offerAll(outbox, input.replay)

    const socket = Socket.make({
      reader: wait(input.reader).pipe(
        Effect.tap(() => Effect.sync(() => log.push({ type: "reader" }))),
        Effect.as({
          pull: Queue.takeBetween(inbound, 1, input.batch).pipe(
            Effect.tapError((error) =>
              Effect.sync(() =>
                log.push({
                  type: "terminal",
                  terminal: error.reason._tag === "SocketCloseError" ? "close" : "readError",
                }),
              ),
            ),
            Effect.flatMap((batch) =>
              nonEmpty(batch) ? Effect.succeed(batch) : Effect.die(new Error("empty batch")),
            ),
          ),
          upgrade: Socket.SocketUpgradeError.unsupported,
        }),
      ),
      writer: Effect.succeed({
        write: (chunk: Outbound) =>
          Effect.gen(function* () {
            yield* wait(input.write[state.writes++ % input.write.length]!)
            if (state.failNextWrite) {
              state.failNextWrite = false
              log.push({ type: "terminal", terminal: "writeError" })
              return yield* socketError(new Socket.SocketWriteError({ cause: new Error("write failed") }))
            }
            log.push({ type: "write", chunk })
            if (chunk instanceof Socket.CloseEvent) log.push({ type: "terminal", terminal: "close" })
          }),
        writeAll: () => Effect.die(new Error("runPtySocket writes frames one at a time")),
      }),
    })

    const open = input.open
    const run = yield* runPtySocket({
      socket,
      outbox,
      onOpen:
        open &&
        Effect.gen(function* () {
          log.push({ type: "openStart" })
          yield* wait(open)
          log.push({ type: "openEnd" })
        }),
      onMessage: (message) =>
        Effect.gen(function* () {
          log.push({ type: "messageStart", message })
          yield* wait(input.message[state.messages++ % input.message.length]!)
          log.push({ type: "messageEnd", message })
        }),
      detach: () => {
        state.detached++
        log.push({ type: "detach" })
      },
    }).pipe(Effect.scoped, Effect.forkChild({ startImmediately: true }))

    for (const { step, delay } of input.steps) {
      yield* wait(delay)
      if (step.type === "inbound" && (yield* Queue.offer(inbound, step.message))) sent.push(step.message)
      if (step.type === "outbound") {
        offered.push(step.frame)
        yield* Queue.offer(outbox, step.frame)
      }
      if (step.type === "serverClose") {
        const close = new Socket.CloseEvent(step.code)
        offered.push(close)
        yield* Queue.offer(outbox, close)
      }
      if (step.type === "clientClose")
        yield* Queue.fail(inbound, socketError(new Socket.SocketCloseError({ code: step.code })))
      if (step.type === "readError")
        yield* Queue.fail(inbound, socketError(new Socket.SocketReadError({ cause: new Error("reset") })))
      if (step.type === "writeError") state.failNextWrite = true
      if (step.type === "interrupt") {
        log.push({ type: "terminal", terminal: "interrupt" })
        // Fiber.interrupt waits for the run to finish, so a run that ignores interruption would stall here.
        if ((yield* Fiber.interrupt(run).pipe(Effect.timeoutOption("2 seconds")))._tag === "None")
          return yield* Effect.die(new Error("runPtySocket ignored interruption"))
      }
    }
    // Every real connection eventually closes; this bounds runs whose scenario never ended them.
    yield* Queue.fail(inbound, socketError(new Socket.SocketCloseError({ code: 1000 })))
    const exit = yield* Fiber.await(run).pipe(Effect.timeoutOption("5 seconds"))
    return { exit, log, sent, offered, state, hasOpen: open !== undefined }
  })

function verify(result: Effect.Success<ReturnType<typeof simulate>>) {
  // The run terminates within the scheduler bound.
  if (result.exit._tag === "None") throw new Error("runPtySocket did not terminate")
  const exit = result.exit.value
  const log = result.log
  const index = (predicate: (entry: Entry) => boolean) => log.findIndex(predicate)
  const detach = index((entry) => entry.type === "detach")

  // detach runs exactly once, whatever ended the connection.
  expect(result.state.detached).toBe(1)

  // Outbound frames are written in queue order and nothing follows a close frame or detach.
  const written = log.flatMap((entry) => (entry.type === "write" ? [entry.chunk] : []))
  expect(written.every((chunk, position) => chunk === result.offered[position])).toBeTrue()
  const close = written.findIndex((chunk) => chunk instanceof Socket.CloseEvent)
  if (close !== -1) expect(close).toBe(written.length - 1)
  expect(log.slice(detach).some((entry) => entry.type === "write")).toBeFalse()

  // Inbound messages reach onMessage one at a time, in order, after onOpen and before detach.
  const started = log.flatMap((entry) => (entry.type === "messageStart" ? [entry.message] : []))
  expect(started).toEqual(result.sent.slice(0, started.length))
  const reader = index((entry) => entry.type === "reader")
  const openStart = index((entry) => entry.type === "openStart")
  const openEnd = index((entry) => entry.type === "openEnd")
  if (openStart !== -1) expect(openStart).toBeGreaterThan(reader)
  const firstMessage = index((entry) => entry.type === "messageStart")
  if (firstMessage !== -1) {
    expect(firstMessage).toBeGreaterThan(reader)
    if (result.hasOpen) expect(firstMessage).toBeGreaterThan(openEnd)
    expect(firstMessage).toBeLessThan(detach)
  }
  expect(log.slice(detach).some((entry) => entry.type === "messageStart")).toBeFalse()
  let inFlight = 0
  for (const entry of log) {
    if (entry.type === "messageStart") inFlight++
    if (entry.type === "messageEnd") inFlight--
    expect(inFlight).toBeLessThanOrEqual(1)
  }

  // Clean closes succeed, socket failures die, and interruption is honored. The outcome follows the first
  // close or failure the run observed; an interrupt that lands while the race settles may still win, but
  // nothing observed after an interrupt may decide the outcome.
  const terminals = log.flatMap((entry) => (entry.type === "terminal" ? [entry.terminal] : []))
  if (exit._tag === "Failure" && Cause.hasInterrupts(exit.cause)) {
    expect(terminals).toContain("interrupt")
    return
  }
  const first = terminals[0]
  if (first === "close") {
    expect(exit._tag).toBe("Success")
    return
  }
  if (first === "interrupt" || first === undefined) throw new Error(`Interrupt was not honored: ${exit._tag}`)
  if (exit._tag !== "Failure" || !Cause.hasDies(exit.cause))
    throw new Error(`Expected the run to die after ${first}, got ${exit._tag}`)
  const defect = Cause.squash(exit.cause)
  if (!Socket.isSocketError(defect)) throw new Error(`Expected a socket error defect, got ${String(defect)}`)
  expect(defect.reason._tag).toBe(first === "readError" ? "SocketReadError" : "SocketWriteError")
}

test(
  "runPtySocket preserves ordering, detaches once, and ends correctly under random interleavings",
  () =>
    FastCheck.assert(
      FastCheck.asyncProperty(scenario, async (input) => verify(await Effect.runPromise(simulate(input)))),
      { numRuns: 300 },
    ),
  60_000,
)

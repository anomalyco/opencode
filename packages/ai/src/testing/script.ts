import { Deferred, Effect, Latch, Queue, Scope } from "effect"

export type Gate = Readonly<{ started: Effect.Effect<void>; release: Effect.Effect<void> }>

export interface Controls<Request, Response> {
  /** Returns a snapshot of requests observed at execution time. */
  readonly requests: () => Effect.Effect<readonly Request[]>
  readonly push: (...responses: readonly Response[]) => Effect.Effect<void>
  /** Replaces the fallback without changing queued responses. */
  readonly always: (response: Response) => Effect.Effect<void>
  /** Answers requests after the one-shot queue is exhausted; receives the original request. */
  readonly serve: (responder: (request: Request) => Response) => Effect.Effect<void>
  /** Waits for request arrivals, not output or completion. */
  readonly wait: (count: number) => Effect.Effect<void>
  readonly gate: () => Effect.Effect<Gate, never, Scope.Scope>
}

export interface Options<Request, Response> {
  readonly transformRequest?: (request: Request) => Request
  /** Used after the one-shot response queue is exhausted. Omit to defect on unexpected requests. */
  readonly fallback?: Response
}

/** The response queue, fallback, request log, and gates shared by every test client. */
export const make = <Request, Response>(name: string, options: Options<Request, Response>) => {
  const requests: Request[] = []
  const responses: Response[] = []
  let started = Deferred.makeUnsafe<void>()
  const initial = options.fallback
  let fallback: ((request: Request) => Response) | undefined = initial === undefined ? undefined : () => initial
  let activeGate: { readonly started: Queue.Queue<void>; readonly release: Latch.Latch } | undefined
  const wait = (count: number): Effect.Effect<void> =>
    Effect.suspend(() =>
      requests.length >= count ? Effect.void : Deferred.await(started).pipe(Effect.andThen(wait(count))),
    )

  const take = (request: Request) =>
    Effect.suspend(() => {
      const count = requests.push(options.transformRequest?.(request) ?? request)
      const waiting = started
      started = Deferred.makeUnsafe()
      const gate = activeGate
      try {
        const response = responses.shift() ?? fallback?.(request)
        if (!response) return Effect.die(new Error(`${name} has no response for request ${count}`))
        if (!gate) return Effect.succeed(response)
        return Queue.offer(gate.started, undefined).pipe(Effect.andThen(gate.release.await), Effect.as(response))
      } finally {
        // Waiters can resume synchronously; assign the reply and gate before notifying them.
        Deferred.doneUnsafe(waiting, Effect.void)
      }
    })

  const controls: Controls<Request, Response> = {
    requests: () => Effect.sync(() => [...requests]),
    push: (...input) =>
      Effect.sync(() => {
        responses.push(...input)
      }),
    always: (response) =>
      Effect.sync(() => {
        fallback = () => response
      }),
    serve: (responder) =>
      Effect.sync(() => {
        fallback = responder
      }),
    wait,
    gate: () =>
      Effect.gen(function* () {
        const gate = {
          started: yield* Effect.acquireRelease(Queue.unbounded<void>(), Queue.shutdown),
          release: yield* Latch.make(),
        }
        activeGate = gate
        const release = Effect.sync(() => {
          if (activeGate === gate) activeGate = undefined
        }).pipe(Effect.andThen(gate.release.open), Effect.asVoid)
        yield* Effect.addFinalizer(() => release)
        return {
          started: Queue.take(gate.started),
          release,
        }
      }),
  }
  return { take, controls }
}

export * as TestScript from "./script.js"

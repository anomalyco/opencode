import { expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { DesktopCliState } from "./desktop-cli-state"

const cli = { version: "2.0.0", command: ["opencode-cli"], binary: "opencode-cli" }

const eperm = new Error("EPERM: operation not permitted, copyfile")

test.each([
  { name: "fails", failure: Effect.fail(eperm) },
  { name: "dies", failure: Effect.die(eperm) },
])("a lookup that $name is looked up again by the next caller, and a success is kept", async (row) => {
  const calls = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const calls = { count: 0 }
        const gate = yield* Deferred.make<void>()

        const resolve = yield* DesktopCliState.make(
          Effect.suspend(() => {
            calls.count++

            return calls.count === 1 ? Deferred.await(gate).pipe(Effect.andThen(row.failure)) : Effect.succeed(cli)
          }),
        )

        // The background service and the plugin host both ask at boot; on dev the shared failure stuck for both.
        const first = yield* Effect.forkChild(Effect.exit(resolve), { startImmediately: true })
        const second = yield* Effect.forkChild(Effect.exit(resolve), { startImmediately: true })
        yield* Deferred.succeed(gate, undefined)
        expect(Exit.isFailure(yield* Fiber.join(first))).toBe(true)
        expect(Exit.isFailure(yield* Fiber.join(second))).toBe(true)

        expect(yield* resolve).toEqual(cli)
        expect(yield* resolve).toEqual(cli)

        return calls.count
      }),
    ),
  )

  expect(calls).toBe(2)
})

test("a caller that gives up does not interrupt the lookup another caller waits on", async () => {
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        const resolve = yield* DesktopCliState.make(Deferred.await(gate).pipe(Effect.as(cli)))
        const leaving = yield* Effect.forkChild(resolve, { startImmediately: true })
        const staying = yield* Effect.forkChild(resolve, { startImmediately: true })

        yield* Fiber.interrupt(leaving)
        yield* Deferred.succeed(gate, undefined)

        return yield* Fiber.join(staying)
      }),
    ),
  )

  expect(result).toEqual(cli)
})

test("closing the scope interrupts the lookup in flight and starts none after", async () => {
  const calls = { count: 0 }
  const scope = Scope.makeUnsafe()

  const resolve = await Effect.runPromise(
    DesktopCliState.make(
      Effect.suspend(() => {
        calls.count++

        return Effect.never
      }),
    ).pipe(Scope.provide(scope)),
  )

  const waiting = Effect.runFork(resolve)
  await Effect.runPromise(Effect.yieldNow)
  await Effect.runPromise(Scope.close(scope, Exit.void))

  expect(Exit.hasInterrupts(await Effect.runPromise(Fiber.await(waiting)))).toBe(true)
  expect(Exit.hasInterrupts(await Effect.runPromise(Effect.exit(resolve)))).toBe(true)
  expect(calls.count).toBe(1)
})

import { afterEach, beforeEach, expect, jest, test } from "bun:test"
import { Scope } from "./scope"

const TIMEOUT = 1_000

beforeEach(() => jest.useFakeTimers())

afterEach(() => jest.useRealTimers())

// Fake timers leave setImmediate real: one turn drains every pending microtask.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

const fixture = () => {
  const events: string[] = []
  const logs: { message: string; data: object }[] = []
  const scope = Scope.make("test", { timeout: TIMEOUT, log: (message, data) => logs.push({ message, data }) })

  const record = (name: string) => () => {
    events.push(name)
  }

  return { events, logs, scope, record }
}

const settled = (promise: Promise<unknown>) => {
  const state = { settled: false }
  void promise.then(() => (state.settled = true))

  return state
}

test("close aborts the signal at once and runs finalizers in reverse, past one that fails", async () => {
  const world = fixture()
  world.scope.addFinalizer(world.record("first"))
  world.scope.addFinalizer(() => {
    world.events.push("failing")
    throw new Error("boom")
  })
  world.scope.addFinalizer(world.record("last"))
  const closing = world.scope.close()
  expect(world.scope.signal.aborted).toBe(true)
  // Finalizers start only once the closing code yields.
  expect(world.events).toEqual([])
  await closing
  expect(world.events).toEqual(["last", "failing", "first"])
  expect(world.logs.map((entry) => entry.message)).toEqual(["scope finalizer failed"])
})

test("a finalizer added after close runs at once, and closing again waits for it", async () => {
  const world = fixture()
  await world.scope.close()
  const release = { resolve: () => {} }
  world.scope.addFinalizer(async () => {
    world.events.push("late")
    await new Promise<void>((resolve) => (release.resolve = resolve))
    world.events.push("late done")
  })
  await flush()
  expect(world.events).toEqual(["late"])
  const again = settled(world.scope.close())
  await flush()
  expect(again.settled).toBe(false)
  release.resolve()
  await flush()
  expect(again.settled).toBe(true)
  expect(world.events).toEqual(["late", "late done"])
})

test("a fork closes with its parent in reverse order like a finalizer, or earlier on its own", async () => {
  const world = fixture()
  world.scope.addFinalizer(world.record("parent before fork"))
  const fork = world.scope.fork("child")
  fork.addFinalizer(world.record("child"))
  const alone = world.scope.fork("alone")
  alone.addFinalizer(world.record("alone"))
  world.scope.addFinalizer(world.record("parent after fork"))

  await alone.close()
  expect(world.events).toEqual(["alone"])
  await world.scope.close()
  expect(fork.signal.aborted).toBe(true)
  // The fork that closed on its own left the parent: it does not run again.
  expect(world.events).toEqual(["alone", "parent after fork", "child", "parent before fork"])
  expect(world.scope.fork("after close").signal.aborted).toBe(true)
})

test("the deadline gives up on a hung finalizer, logs it, and runs the rest", async () => {
  const world = fixture()
  world.scope.addFinalizer(world.record("first"))
  world.scope.addFinalizer(function hung() {
    world.events.push("hung")

    return new Promise<void>(() => {})
  })
  world.scope.addFinalizer(world.record("last"))
  const closing = settled(world.scope.close())
  await flush()
  jest.advanceTimersByTime(TIMEOUT - 1)
  await flush()
  expect(world.events).toEqual(["last", "hung"])
  expect(closing.settled).toBe(false)
  jest.advanceTimersByTime(1)
  await flush()
  expect(world.events).toEqual(["last", "hung", "first"])
  expect(closing.settled).toBe(true)
  expect(world.logs).toEqual([{ message: "scope finalizer timed out", data: { scope: "test", finalizer: "hung" } }])
})

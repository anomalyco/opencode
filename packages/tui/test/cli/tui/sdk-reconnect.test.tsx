/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { onMount } from "solid-js"
import { runEventStream, SDKProvider, useSDK, type EventSource } from "../../../src/context/sdk"

const connected = {
  directory: "global",
  payload: {
    id: "evt_connected",
    type: "server.connected",
    properties: {},
  },
} satisfies GlobalEvent

const queued = {
  directory: "global",
  payload: {
    id: "evt_disposed",
    type: "global.disposed",
    properties: {},
  },
} satisfies GlobalEvent

type Connect = (signal: AbortSignal) => Promise<AsyncIterable<GlobalEvent>>
type CallbackBoundary = "flush" | "wait" | "retry"

function createHarness(connect: Connect, fault?: CallbackBoundary) {
  const lifecycle = new AbortController()
  const subscription = new AbortController()
  const waits: Array<{ readonly delay: number; readonly release: () => void }> = []
  const queue: GlobalEvent[] = []
  const seen: GlobalEvent[] = []
  const retries: Array<{ readonly attempt: number; readonly error: unknown }> = []
  let flushes = 0
  let faulted = false
  const fail = (boundary: CallbackBoundary) => {
    if (fault !== boundary || faulted) return
    faulted = true
    throw new Error(`${boundary} failed`)
  }

  return {
    lifecycle,
    subscription,
    waits,
    seen,
    retries,
    get flushes() {
      return flushes
    },
    start: () =>
      runEventStream({
        signals: [lifecycle.signal, subscription.signal],
        connect,
        event: (event) => queue.push(event),
        flush: () => {
          fail("flush")
          flushes++
          seen.push(...queue.splice(0))
        },
        wait: (delay, signal) => {
          fail("wait")
          const deferred = Promise.withResolvers<void>()
          const release = () => {
            signal.removeEventListener("abort", release)
            deferred.resolve()
          }
          signal.addEventListener("abort", release, { once: true })
          waits.push({ delay, release })
          return deferred.promise
        },
        retry: (entry) => {
          fail("retry")
          retries.push(entry)
        },
      }),
  }
}

async function settleUntil(condition: () => boolean) {
  for (let count = 0; count < 100; count++) {
    if (condition()) return
    await Promise.resolve()
  }
  throw new Error("condition did not settle")
}

async function releaseRetry(harness: ReturnType<typeof createHarness>, index = 0) {
  await settleUntil(() => harness.waits.length > index)
  const call = harness.waits[index]
  if (!call) throw new Error("retry wait not found")
  call.release()
}

function untilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"))
    if (signal.aborted) return abort()
    signal.addEventListener("abort", abort, { once: true })
  })
}

async function* emptyStream(): AsyncIterable<GlobalEvent> {}

test("fans out an injected event to subscribers once", async () => {
  const sourceReady = Promise.withResolvers<void>()
  const listenerReady = Promise.withResolvers<void>()
  const received = Promise.withResolvers<GlobalEvent>()
  let handler: ((event: GlobalEvent) => void) | undefined
  const source: EventSource = {
    subscribe: async (next) => {
      handler = next
      sourceReady.resolve()
      return () => {
        handler = undefined
      }
    },
  }

  function Probe() {
    const sdk = useSDK()
    onMount(() => {
      const unsubscribe = sdk.event.on("event", received.resolve)
      listenerReady.resolve()
      return unsubscribe
    })
    return <box />
  }

  const app = await testRender(() => (
    <SDKProvider url="http://test" events={source}>
      <Probe />
    </SDKProvider>
  ))

  try {
    await Promise.all([sourceReady.promise, listenerReady.promise])
    if (!handler) throw new Error("event source not ready")
    handler(connected)

    expect(await received.promise).toEqual(connected)
  } finally {
    app.renderer.destroy()
  }
})

test("unsubscribes an injected source disposed before subscription resolves", async () => {
  const subscribed = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let unsubscribed = 0
  const source: EventSource = {
    subscribe: async () => {
      subscribed.resolve()
      await release.promise
      return () => unsubscribed++
    },
  }
  const app = await testRender(() => (
    <SDKProvider url="http://test" events={source}>
      <box />
    </SDKProvider>
  ))

  await subscribed.promise
  app.renderer.destroy()
  release.resolve()
  await settleUntil(() => unsubscribed === 1)

  expect(unsubscribed).toBe(1)
})

test("reconnects after connection establishment rejects", async () => {
  const failure = new Error("connect failed")
  let connects = 0
  const harness = createHarness(async (signal) => {
    connects++
    if (connects === 1) throw failure
    return untilAbort(signal)
  })

  const task = harness.start()
  await releaseRetry(harness)
  await settleUntil(() => connects === 2)
  harness.subscription.abort()
  await task

  expect(connects).toBe(2)
  expect(harness.waits.map((call) => call.delay)).toEqual([1000])
  expect(harness.retries).toEqual([{ attempt: 1, error: failure }])
})

test("reconnects after a stream completes normally", async () => {
  let connects = 0
  const harness = createHarness(async (signal) => {
    connects++
    if (connects === 1) return emptyStream()
    return untilAbort(signal)
  })

  const task = harness.start()
  await releaseRetry(harness)
  await settleUntil(() => connects === 2)
  harness.subscription.abort()
  await task

  expect(connects).toBe(2)
  expect(harness.retries).toHaveLength(1)
  expect(harness.retries[0]?.attempt).toBe(1)
})

test("flushes a failed stream and delivers the recovered first event once", async () => {
  const failure = new Error("iterator failed")
  const recovered = Promise.withResolvers<void>()
  let connects = 0
  let active = 0
  let maxActiveStreams = 0
  const harness = createHarness(async (signal) => {
    connects++
    return (async function* () {
      active++
      maxActiveStreams = Math.max(maxActiveStreams, active)
      try {
        if (connects === 1) {
          yield queued
          throw failure
        }
        yield connected
        recovered.resolve()
        await untilAbort(signal)
      } finally {
        active--
      }
    })()
  })

  const task = harness.start()
  await releaseRetry(harness)
  await recovered.promise
  harness.lifecycle.abort()
  await task

  expect(connects).toBe(2)
  expect(harness.seen).toEqual([queued, connected])
  expect(harness.retries).toEqual([{ attempt: 1, error: failure }])
  expect(harness.flushes).toBe(2)
  expect(maxActiveStreams).toBe(1)
  expect(active).toBe(0)
})

test("caps exponential delays and resets them after server.connected", async () => {
  let connects = 0
  const harness = createHarness(async () => {
    connects++
    if (connects === 8)
      return (async function* () {
        yield connected
      })()
    return emptyStream()
  })

  const task = harness.start()
  for (let index = 0; index < 7; index++) await releaseRetry(harness, index)
  await settleUntil(() => harness.waits.length === 8)
  harness.subscription.abort()
  await task

  expect(harness.waits.map((call) => call.delay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 1000])
  expect(harness.retries).toHaveLength(7)
})

test.each(["flush", "wait", "retry"] as const)("%s callback failure remains owned and reconnects", async (boundary) => {
  let connects = 0
  const harness = createHarness(async (signal) => {
    connects++
    if (connects === 1) return emptyStream()
    return untilAbort(signal)
  }, boundary)

  const task = harness.start()
  const outcome = task.then(
    () => "resolved" as const,
    () => "rejected" as const,
  )
  if (boundary !== "wait") await releaseRetry(harness)
  const state = await Promise.race([outcome, settleUntil(() => connects === 2).then(() => "running" as const)])
  expect(state).toBe("running")
  harness.subscription.abort()

  expect(await outcome).toBe("resolved")
  expect(connects).toBe(2)
})

test.each(["lifecycle", "subscription"] as const)("%s abort during connect exits without retry", async (owner) => {
  const started = Promise.withResolvers<void>()
  const harness = createHarness(async (signal) => {
    started.resolve()
    return untilAbort(signal)
  })

  const task = harness.start()
  await started.promise
  harness[owner].abort()
  await task

  expect(harness.waits).toEqual([])
  expect(harness.retries).toEqual([])
})

test.each(["lifecycle", "subscription"] as const)("%s abort during iteration exits without retry", async (owner) => {
  const iterating = Promise.withResolvers<void>()
  const harness = createHarness(async (signal) =>
    (async function* () {
      iterating.resolve()
      await untilAbort(signal)
    })(),
  )

  const task = harness.start()
  await iterating.promise
  harness[owner].abort()
  await task

  expect(harness.waits).toEqual([])
  expect(harness.retries).toEqual([])
})

test.each(["lifecycle", "subscription"] as const)("%s abort during backoff exits without retry", async (owner) => {
  let connects = 0
  const harness = createHarness(async () => {
    connects++
    return emptyStream()
  })

  const task = harness.start()
  await settleUntil(() => harness.waits.length === 1)
  harness[owner].abort()
  await task

  expect(connects).toBe(1)
  expect(harness.retries).toEqual([])
})

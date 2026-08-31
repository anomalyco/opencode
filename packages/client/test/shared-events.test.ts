import { expect, test } from "bun:test"
import { SharedEvents } from "../src/shared-events"

type Event = { readonly type: string; readonly value?: number }

function source(cleanup?: Promise<void>) {
  const connections: {
    signal: AbortSignal
    push: (event: Event) => void
    close: () => void
    fail: (error: unknown) => void
    closing: Promise<void>
    closed: Promise<void>
  }[] = []
  const opened: ReturnType<typeof Promise.withResolvers<void>>[] = []

  return {
    connections,
    async at(index: number) {
      if (!connections[index]) await (opened[index] ??= Promise.withResolvers<void>()).promise
      return connections[index]
    },
    connect(signal: AbortSignal): AsyncIterable<Event> {
      let controller!: ReadableStreamDefaultController<Event>
      let ended = false
      const closing = Promise.withResolvers<void>()
      const closed = Promise.withResolvers<void>()
      const stream = new ReadableStream<Event>({
        start(value) {
          controller = value
        },
      })
      const close = () => {
        if (ended) return
        ended = true
        controller.close()
      }
      signal.addEventListener("abort", close, { once: true })
      connections.push({
        signal,
        push: (event) => controller.enqueue(event),
        close,
        fail(error) {
          ended = true
          controller.error(error)
        },
        closing: closing.promise,
        closed: closed.promise,
      })
      opened[connections.length - 1]?.resolve()

      return (async function* () {
        try {
          yield* stream
        } finally {
          signal.removeEventListener("abort", close)
          closing.resolve()
          await cleanup
          closed.resolve()
        }
      })()
    },
  }
}

test("creation, subscription, and idle iterators are lazy", async () => {
  const events = source()
  const shared = SharedEvents.make(events.connect)
  const iterable = shared.subscribe()
  const idle = iterable[Symbol.asyncIterator]()
  expect(events.connections).toHaveLength(0)
  expect(await idle.return!()).toEqual({ done: true, value: undefined })
  expect(await idle.next()).toEqual({ done: true, value: undefined })
  expect(events.connections).toHaveLength(0)

  const active = iterable[Symbol.asyncIterator]()
  const next = active.next()
  expect(events.connections).toHaveLength(1)
  events.connections[0].push({ type: "server.connected" })
  expect(await next).toEqual({ done: false, value: { type: "server.connected" } })
  await active.return!()
  await events.connections[0].closed
})

test("pre-aborted subscribers do not open a source", async () => {
  const events = source()
  const controller = new AbortController()
  const iterator = SharedEvents.make(events.connect).subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
  controller.abort()
  expect(await iterator.next()).toEqual({ done: true, value: undefined })
  expect(events.connections).toHaveLength(0)
})

test("multiple consumers share one source and receive live native and RPC events", async () => {
  const events = source()
  const shared = SharedEvents.make(events.connect)
  const first = shared.subscribe()[Symbol.asyncIterator]()
  const second = shared.subscribe()[Symbol.asyncIterator]()

  for (const event of [{ type: "server.connected" }, { type: "session.updated" }, { type: "rpc.example.updated", value: 1 }]) {
    const reads = [first.next(), second.next()]
    events.connections[0].push(event)
    expect(await Promise.all(reads)).toEqual([
      { done: false, value: event },
      { done: false, value: event },
    ])
  }
  expect(events.connections).toHaveLength(1)
  await first.return!()
  expect(events.connections[0].signal.aborted).toBe(false)
  const next = second.next()
  events.connections[0].push({ type: "rpc.example.updated", value: 2 })
  expect((await next).value).toEqual({ type: "rpc.example.updated", value: 2 })
  await second.return!()
  await events.connections[0].closed
})

test("late consumers receive the latest connection marker but no business event replay", async () => {
  const events = source()
  const shared = SharedEvents.make(events.connect)
  const first = shared.subscribe()[Symbol.asyncIterator]()
  const idle = shared.subscribe()[Symbol.asyncIterator]()
  for (const event of [
    { type: "server.connected", value: 1 },
    { type: "server.connected", value: 2 },
    { type: "rpc.example.updated", value: 3 },
  ]) {
    const next = first.next()
    events.connections[0].push(event)
    await next
  }

  expect(await idle.next()).toEqual({ done: false, value: { type: "server.connected", value: 2 } })
  const next = idle.next()
  events.connections[0].push({ type: "rpc.example.updated", value: 4 })
  expect(await next).toEqual({ done: false, value: { type: "rpc.example.updated", value: 4 } })
  expect(events.connections).toHaveLength(1)
  await first.return!()
  await idle.return!()
  await events.connections[0].closed
})

test("abort removes only its subscriber; last return closes the native source and resolves pending reads", async () => {
  const events = source()
  const shared = SharedEvents.make(events.connect)
  const controller = new AbortController()
  const first = shared.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
  const second = shared.subscribe()[Symbol.asyncIterator]()
  const firstRead = first.next()
  const secondReads = [second.next(), second.next()]
  controller.abort()
  expect(await firstRead).toEqual({ done: true, value: undefined })
  expect(await first.next()).toEqual({ done: true, value: undefined })
  expect(events.connections[0].signal.aborted).toBe(false)

  await second.return!()
  expect(await Promise.all(secondReads)).toEqual([
    { done: true, value: undefined },
    { done: true, value: undefined },
  ])
  expect(events.connections[0].signal.aborted).toBe(true)
  await events.connections[0].closed
  expect(await second.next()).toEqual({ done: true, value: undefined })
})

test("breaking a native for-await loop closes the last source", async () => {
  const events = source()
  const shared = SharedEvents.make(events.connect)
  const consumed = (async () => {
    for await (const event of shared.subscribe()) {
      expect(event.type).toBe("server.connected")
      break
    }
  })()
  events.connections[0].push({ type: "server.connected" })
  await consumed
  expect(events.connections[0].signal.aborted).toBe(true)
  await events.connections[0].closed
})

test("rapid resubscription opens a replacement while old cleanup finishes", async () => {
  const cleanup = Promise.withResolvers<void>()
  const events = source(cleanup.promise)
  const shared = SharedEvents.make(events.connect)
  const first = shared.subscribe()[Symbol.asyncIterator]()
  const firstRead = first.next()
  events.connections[0].push({ type: "server.connected", value: 1 })
  await firstRead
  await first.return!()
  await events.connections[0].closing

  const second = shared.subscribe()[Symbol.asyncIterator]()
  const third = shared.subscribe()[Symbol.asyncIterator]()
  const secondRead = second.next()
  const thirdRead = third.next()
  const controller = new AbortController()
  const cancelled = shared.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
  const cancelledRead = cancelled.next()
  controller.abort()
  expect(await cancelledRead).toEqual({ done: true, value: undefined })
  expect(events.connections).toHaveLength(2)

  const replacement = await events.at(1)
  replacement.push({ type: "server.connected", value: 2 })
  expect(await Promise.all([secondRead, thirdRead])).toEqual([
    { done: false, value: { type: "server.connected", value: 2 } },
    { done: false, value: { type: "server.connected", value: 2 } },
  ])
  cleanup.resolve()
  await events.connections[0].closed
  await second.return!()
  await third.return!()
  await replacement.closed
})

test("source EOF finishes all consumers and permits a fresh subscription without retry", async () => {
  const events = source()
  const shared = SharedEvents.make(events.connect)
  const first = shared.subscribe()[Symbol.asyncIterator]()
  const second = shared.subscribe()[Symbol.asyncIterator]()
  const reads = [first.next(), second.next()]
  events.connections[0].push({ type: "server.connected", value: 1 })
  await Promise.all(reads)
  const nextReads = [first.next(), second.next()]
  events.connections[0].push({ type: "rpc.example.updated", value: 2 })
  expect(await Promise.all(nextReads)).toEqual([
    { done: false, value: { type: "rpc.example.updated", value: 2 } },
    { done: false, value: { type: "rpc.example.updated", value: 2 } },
  ])
  events.connections[0].close()
  await events.connections[0].closed
  expect(await first.next()).toEqual({ done: true, value: undefined })
  expect(await second.next()).toEqual({ done: true, value: undefined })
  expect(events.connections).toHaveLength(1)

  const fresh = shared.subscribe()[Symbol.asyncIterator]()
  const next = fresh.next()
  const replacement = await events.at(1)
  replacement.push({ type: "server.connected", value: 3 })
  expect(await next).toEqual({ done: false, value: { type: "server.connected", value: 3 } })
  await fresh.return!()
  await replacement.closed
})

test("source failures preserve error identity for every consumer and permit a new subscription", async () => {
  const events = source()
  const shared = SharedEvents.make(events.connect)
  const first = shared.subscribe()[Symbol.asyncIterator]()
  const second = shared.subscribe()[Symbol.asyncIterator]()
  const failure = { reason: "actual source failure" }
  const reads = Promise.allSettled([first.next(), second.next()])
  events.connections[0].fail(failure)
  expect(await reads).toEqual([
    { status: "rejected", reason: failure },
    { status: "rejected", reason: failure },
  ])
  await expect(first.next()).rejects.toBe(failure)
  expect(events.connections).toHaveLength(1)

  const fresh = shared.subscribe()[Symbol.asyncIterator]()
  const next = fresh.next()
  const replacement = await events.at(1)
  replacement.push({ type: "server.connected" })
  expect(await next).toEqual({ done: false, value: { type: "server.connected" } })
  await fresh.return!()
  await replacement.closed
})

test("synchronous source creation failures reject subscribers without automatic retry", async () => {
  const failure = new Error("connect failed")
  const attempts: AbortSignal[] = []
  const shared = SharedEvents.make<Event>((signal) => {
    attempts.push(signal)
    throw failure
  })
  await expect(shared.subscribe()[Symbol.asyncIterator]().next()).rejects.toBe(failure)
  expect(attempts).toHaveLength(1)
  expect(attempts[0].aborted).toBe(true)
  await expect(shared.subscribe()[Symbol.asyncIterator]().next()).rejects.toBe(failure)
  expect(attempts).toHaveLength(2)
})

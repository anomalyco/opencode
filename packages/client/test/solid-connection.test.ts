import { expect, jest, test } from "bun:test"
import { createRoot } from "solid-js"
import { createClientConnection } from "../src/solid"
import { OpenCode, type OpenCodeEvent } from "../src/promise"

const connected = { id: "evt_connected", created: 1, type: "server.connected", data: {} }

// One fake server whose event streams stay open until the test writes to them or the client aborts.
function server() {
  const encoder = new TextEncoder()
  const streams: {
    headers: Headers
    write: (text: string) => void
    close: () => void
    error: (reason: Error) => void
    aborted: boolean
  }[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      let controller!: ReadableStreamDefaultController<Uint8Array>
      const entry = {
        headers: request.headers,
        write: (text: string) => controller.enqueue(encoder.encode(text)),
        close: () => controller.close(),
        error: (reason: Error) => controller.error(reason),
        aborted: false,
      }
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value
        },
        cancel() {
          entry.aborted = true
        },
      })
      request.signal.addEventListener("abort", () => {
        entry.aborted = true
        controller.error(request.signal.reason)
      })
      streams.push(entry)
      return new Response(body, { headers: { "content-type": "text/event-stream" } })
    },
  })
  return { api, streams }
}

function setup(input: ReturnType<typeof server>, idleTimeout: number) {
  const events: OpenCodeEvent[] = []
  return createRoot((dispose) => ({
    events,
    dispose,
    connection: createClientConnection(input.api, {
      idleTimeout,
      flushInterval: 0,
      onEvent: (event) => events.push(event),
    }),
  }))
}

async function until(check: () => boolean, timeout = 2_000) {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test("a stream that goes silent past the idle timeout is replaced", async () => {
  const fake = server()
  const ctx = setup(fake, 60)
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")

    await until(() => fake.streams.length === 2)
    expect(fake.streams[0].aborted).toBe(true)
    expect(ctx.connection.internal.history().map((item) => item.data)).toContainEqual({
      status: "disconnected",
      attempt: 1,
      error: "Event stream stalled",
    })

    fake.streams[1].write(`data: ${JSON.stringify({ ...connected, id: "evt_connected_2" })}\n\n`)
    await until(() => ctx.connection.status() === "connected" && ctx.events.length === 2)
    expect(ctx.connection.error()).toBeUndefined()
  } finally {
    ctx.dispose()
  }
})

test("keepalive comments hold a quiet stream open", async () => {
  const fake = server()
  const ctx = setup(fake, 60)
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")

    const heartbeat = setInterval(() => fake.streams[0].write(": heartbeat\n\n"), 20)
    await new Promise((resolve) => setTimeout(resolve, 250))
    clearInterval(heartbeat)

    expect(fake.streams).toHaveLength(1)
    expect(fake.streams[0].aborted).toBe(false)
    expect(ctx.connection.status()).toBe("connected")
    expect(ctx.events).toHaveLength(1)
  } finally {
    ctx.dispose()
  }
})

test("a forced resync replaces the stream immediately and only while connected", async () => {
  const fake = server()
  const ctx = setup(fake, 10_000)
  try {
    ctx.connection.internal.resync("too early")
    await until(() => fake.streams.length === 1)
    expect(fake.streams[0].aborted).toBe(false)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")

    const started = Date.now()
    ctx.connection.internal.resync("Network connection restored")
    await until(() => fake.streams.length === 2)
    expect(Date.now() - started).toBeLessThan(500)
    expect(fake.streams[0].aborted).toBe(true)
    expect(ctx.connection.internal.history().map((item) => item.data)).toContainEqual({
      status: "disconnected",
      attempt: 1,
      error: "Network connection restored",
    })
    fake.streams[1].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")
  } finally {
    ctx.dispose()
  }
})

test.each([
  ["closes", (stream: ReturnType<typeof server>["streams"][number]) => stream.close(), "Event stream disconnected"],
  [
    "fails",
    (stream: ReturnType<typeof server>["streams"][number]) => stream.error(new Error("contract failure")),
    "Transport: contract failure",
  ],
])("a stream the server %s reconnects and reports the disconnect", async (_name, end, message) => {
  const fake = server()
  const ctx = setup(fake, 10_000)
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    await until(() => ctx.connection.status() === "connected")

    end(fake.streams[0])
    await until(() => ctx.connection.status() === "reconnecting")
    expect(ctx.connection.error()).toBe(message)
    await until(() => fake.streams.length === 2)
  } finally {
    ctx.dispose()
  }
})

test("a reconnect does not ask the volatile event stream to replay", async () => {
  const fake = server()
  const ctx = setup(fake, 10_000)
  try {
    await until(() => fake.streams.length === 1)
    fake.streams[0].write(`data: ${JSON.stringify(connected)}\n\n`)
    fake.streams[0].write(`id: timeline-event-7\ndata: ${JSON.stringify({ ...connected, id: "evt_2" })}\n\n`)
    await until(() => ctx.events.length === 2)

    fake.streams[0].error(new Error("retry with event id"))
    await until(() => fake.streams.length === 2)
    expect(fake.streams[1].headers.get("last-event-id")).toBeNull()
  } finally {
    ctx.dispose()
  }
})

test.each([
  {
    name: "a failing server resolution backs off exponentially up to 15s",
    reconnect: async (): Promise<never> => {
      throw new Error("unavailable")
    },
    gaps: [1_000, 2_000, 4_000, 8_000, 15_000, 15_000],
  },
  {
    name: "a plain stream retry keeps a 1s delay",
    reconnect: undefined,
    gaps: [1_000, 1_000, 1_000, 1_000, 1_000, 1_000],
  },
])("$name", async (input) => {
  jest.useFakeTimers()
  const attempts: number[] = []
  let disconnects = 0
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async () => {
      attempts.push(Date.now())
      return new Response("", { headers: { "content-type": "text/event-stream" } })
    },
  })
  // The connect timeout is cleared before a disconnect is reported, so the next pending timer is the retry delay.
  // Spinning on microtasks starves the test timeout, so give up after a bound instead of hanging the run.
  const retryScheduled = async (count: number) => {
    for (let spin = 0; spin < 10_000; spin++) {
      if (disconnects >= count && jest.getTimerCount() > 0) return
      await Promise.resolve()
    }
    throw new Error(`No retry was scheduled after disconnect ${count}`)
  }

  const start = Date.now()
  let dispose!: () => void
  createRoot((cleanup) => {
    dispose = cleanup
    createClientConnection(api, {
      reconnect: input.reconnect,
      flushInterval: 0,
      onEvent: () => {},
      log: {
        info(message) {
          if (message === "event stream disconnected") disconnects += 1
        },
      },
    })
  })

  try {
    for (let step = 1; step <= input.gaps.length; step++) {
      await retryScheduled(step)
      jest.advanceTimersToNextTimer()
    }
    await retryScheduled(input.gaps.length + 1)

    expect(attempts[0]).toBe(start)
    expect(attempts.slice(1).map((time, index) => time - attempts[index])).toEqual(input.gaps)
  } finally {
    dispose()
    jest.useRealTimers()
  }
})

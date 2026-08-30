import { afterEach, expect, test } from "bun:test"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import { Rpc } from "@opencode-ai/schema/rpc"
import { z } from "zod"
import { OpenCode } from "../src/promise/index"

const cleanup = new Set<() => void>()
afterEach(() => {
  cleanup.forEach((close) => close())
  cleanup.clear()
})

const Echo = Rpc.define({
  id: "acme/jobs",
  methods: {
    echo: {
      input: z.string(),
      output: z.string(),
      errors: { rejected: z.object({ reason: z.string() }) },
    },
    raw: { input: z.unknown(), output: z.unknown() },
    ping: { input: z.undefined(), output: z.undefined() },
  },
  events: {
    updated: { schema: z.object({ count: z.number() }) },
  },
})
const connected = { id: "evt_connected", created: 0, type: "server.connected", data: {} }
const rpcEvent = (data: unknown, directory = "/first", rpcID = Echo.id, name = "updated") => ({
  id: "evt_rpc",
  created: 10,
  type: `rpc.${rpcID}.${name}`,
  location: { directory },
  metadata: { source: "test" },
  data,
})
function http(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })
  cleanup.add(() => server.stop(true))
  return OpenCode.make({ baseUrl: server.url.href, headers: { authorization: "Bearer default", "x-base": "base" } })
}

function events() {
  const requests: Request[] = []
  const opened = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()
  const cancelled = Promise.withResolvers<void>()
  const encoder = new TextEncoder()
  let stopped = false
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    headers: { authorization: "Bearer events" },
    fetch: async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = () => {
            if (stopped) return
            stopped = true
            controller.error(request.signal.reason)
            cancelled.resolve()
          }
          request.signal.addEventListener("abort", abort, { once: true })
          cleanup.add(abort)
          opened.resolve(controller)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(connected)}\n\n`))
        },
        cancel() {
          stopped = true
          cancelled.resolve()
        },
      })
      return new Response(stream, { headers: { "content-type": "text/event-stream" } })
    },
  })
  return {
    client,
    requests,
    cancelled: cancelled.promise,
    async send(value: unknown) {
      return (await opened.promise).enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
    },
    async end() {
      stopped = true
      return (await opened.promise).close()
    },
    async fail(error: Error) {
      stopped = true
      return (await opened.promise).error(error)
    },
  }
}

test("rpc is callable, retains raw call, and routes method location, headers, and JSON body", async () => {
  const requests: Array<{ url: string; method: string; headers: Headers; body: unknown }> = []
  const client = http(async (request) => {
    const body = await request.json()
    requests.push({ url: request.url, method: request.method, headers: request.headers, body })
    return Response.json({ output: body.input })
  })
  expect(typeof client.rpc).toBe("function")
  expect(typeof client.rpc.call).toBe("function")
  expect(
    await client.rpc(Echo).echo("hello", {
      location: { directory: "/project with spaces", workspace: "wrk_test" },
      headers: { authorization: "Bearer override", "x-call": "call" },
    }),
  ).toBe("hello")
  const url = new URL(requests[0].url)
  expect(url.pathname).toBe("/api/rpc/acme%2Fjobs/echo")
  expect(url.searchParams.get("location[directory]")).toBe("/project with spaces")
  expect(url.searchParams.get("location[workspace]")).toBe("wrk_test")
  expect(requests[0].body).toEqual({ input: "hello" })
  expect(requests[0].method).toBe("POST")
  expect(requests[0].headers.get("authorization")).toBe("Bearer override")
  expect(requests[0].headers.get("x-base")).toBe("base")
  expect(requests[0].headers.get("x-call")).toBe("call")
  expect(await client.rpc.call({ rpcID: Echo.id, method: "echo", input: "raw" })).toEqual({ output: "raw" })
  expect(new URL(requests[1].url).search).toBe("")
  expect(requests[1].headers.get("authorization")).toBe("Bearer default")
})

test("no-input RPC methods and absent output use empty wrappers", async () => {
  const client = http(async (request) => {
    expect(await request.json()).toEqual({})
    return Response.json({})
  })
  expect(await client.rpc(Echo).ping()).toBeUndefined()
  expect(await client.rpc(Echo).ping(undefined, { location: { directory: "/project" } })).toBeUndefined()
})

test("RPC Standard Schema results are already parsed and are not transformed again", async () => {
  const calls = { input: 0, output: 0 }
  const input: StandardSchemaV1<string, number> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => {
        calls.input++
        return { value: Number(value) }
      },
    },
  }
  const output: StandardSchemaV1<number, string> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => {
        calls.output++
        return { value: String(value) }
      },
    },
  }
  const eventOutput: StandardSchemaV1<{ count: number }, { text: string }> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => {
        if (typeof value !== "object" || value === null || !("count" in value) || typeof value.count !== "number")
          return { issues: [{ message: "Expected count" }] }
        return { value: { text: String(value.count) } }
      },
    },
  }
  const definition = Rpc.define({
    id: "standard",
    methods: { count: { input, output } },
    events: { counted: { schema: eventOutput } },
  })
  const client = http(async (request) => {
    expect(await request.json()).toEqual({ input: "41" })
    return Response.json({ output: "42" })
  })
  expect(await client.rpc(definition).count("41")).toBe("42")
  const source = events()
  const iterator = source.client.rpc(definition).events.subscribe("counted")[Symbol.asyncIterator]()
  const next = iterator.next()
  await source.send(rpcEvent({ text: "42" }, "/project", definition.id, "counted"))
  expect((await next).value?.data).toEqual({ text: "42" })
  await iterator.return?.()
  expect(calls).toEqual({ input: 0, output: 0 })
})

test("RPC method signals cancel an in-flight HTTP request", async () => {
  const received = Promise.withResolvers<void>()
  const response = Promise.withResolvers<Response>()
  const client = http(() => {
    received.resolve()
    return response.promise
  })
  const controller = new AbortController()
  const result = client
    .rpc(Echo)
    .echo("hello", { signal: controller.signal })
    .catch((error: unknown) => error)
  await received.promise
  controller.abort()
  expect(await result).toMatchObject({ name: "ClientError", reason: "Transport" })
  response.resolve(Response.json({ output: "late" }))
})

test("RPC pre-aborted methods do not issue HTTP requests", async () => {
  let requests = 0
  const client = http(() => {
    requests++
    return Response.json({ output: "hello" })
  })
  await expect(client.rpc(Echo).echo("hello", { signal: AbortSignal.abort() })).rejects.toBeDefined()
  expect(requests).toBe(0)
})

test("RPC declared HTTP failures propagate", async () => {
  await expect(
    http(() => Response.json({ _tag: "UnauthorizedError", message: "Denied" }, { status: 401 }))
      .rpc(Echo)
      .echo("hello"),
  ).rejects.toMatchObject({ _tag: "UnauthorizedError", message: "Denied" })
})

test("RPC method failures remove the generic transport wrapper", async () => {
  const response = { _tag: "RpcError", type: "rejected", message: "Rejected", data: { reason: "busy" } }
  const client = http(() => Response.json(response, { status: 400 }))
  const error = await client.rpc(Echo).echo("hello").catch((error: unknown) => error)

  expect(error).toEqual({ type: "rejected", message: "Rejected", data: { reason: "busy" } })
  await expect(client.rpc.call({ rpcID: Echo.id, method: "echo", input: "hello" })).rejects.toEqual(response)
})

test("RPC transport failures remove the generic transport wrapper", async () => {
  const response = { _tag: "RpcInternalError", type: "rpc.internal", message: "Failed" }
  await expect(http(() => Response.json(response, { status: 500 })).rpc(Echo).echo("hello")).rejects.toEqual({
    type: "rpc.internal",
    message: "Failed",
  })
})

test("native events and multiple RPC clients share one lazy source across locations", async () => {
  const source = events()
  const native = source.client.event.subscribe()[Symbol.asyncIterator]()
  const first = source.client.rpc(Echo).events.subscribe("updated")[Symbol.asyncIterator]()
  const second = source.client.rpc(Echo).events.subscribe("updated")[Symbol.asyncIterator]()
  const otherDefinition = Rpc.define({ ...Echo, id: "other" })
  const other = source.client.rpc(otherDefinition).events.subscribe("updated")[Symbol.asyncIterator]()
  expect(source.requests).toHaveLength(0)
  const firstNext = first.next()
  const secondNext = second.next()
  const otherNext = other.next()
  expect(await native.next()).toEqual({ done: false, value: connected })
  expect(source.requests).toHaveLength(1)
  expect(source.requests[0].headers.get("authorization")).toBe("Bearer events")
  const late = source.client.event.subscribe()[Symbol.asyncIterator]()
  expect(await late.next()).toEqual({ done: false, value: connected })
  await Promise.all([native.return?.(), late.return?.()])
  await source.send(rpcEvent({ ignored: true }, "/first", Echo.id, "unknown"))
  await source.send(rpcEvent({ count: 9 }, "/other", otherDefinition.id))
  expect((await otherNext).value).toMatchObject({
    type: "rpc.other.updated",
    location: { directory: "/other" },
    data: { count: 9 },
  })
  await other.return?.()
  await source.send(rpcEvent({ count: 42 }))
  const expected = {
    id: "evt_rpc",
    created: 10,
    type: `rpc.${Echo.id}.updated`,
    location: { directory: "/first" },
    metadata: { source: "test" },
    data: { count: 42 },
  }
  expect(await firstNext).toEqual({ done: false, value: expected })
  expect(await secondNext).toEqual({ done: false, value: expected })
  const next = first.next()
  await source.send(rpcEvent({ count: 43 }, "/second"))
  expect((await next).value).toMatchObject({ location: { directory: "/second" }, data: { count: 43 } })
  await Promise.all([first.return?.(), second.return?.()])
  await source.cancelled
  expect(source.requests[0].signal.aborted).toBe(true)
  expect(source.requests).toHaveLength(1)
})

test("RPC iterator return and abort cancel only their pending subscribers", async () => {
  const source = events()
  const controller = new AbortController()
  const first = source.client.rpc(Echo).events.subscribe("updated")[Symbol.asyncIterator]()
  const secondEvents = source.client.rpc(Echo).events.subscribe("updated", { signal: controller.signal })
  const second = secondEvents[Symbol.asyncIterator]()
  const native = source.client.event.subscribe()[Symbol.asyncIterator]()
  const firstNext = first.next()
  const secondNext = second.next()
  await native.next()
  expect((await first.return?.())?.done).toBe(true)
  expect((await firstNext).done).toBe(true)
  expect(source.requests[0].signal.aborted).toBe(false)
  controller.abort()
  expect((await secondNext).done).toBe(true)
  expect(source.requests[0].signal.aborted).toBe(false)
  const nativeNext = native.next()
  const event = rpcEvent({ count: 42 })
  await source.send(event)
  expect(await nativeNext).toEqual({ done: false, value: event })
  await native.return?.()
  await source.cancelled
})

test("RPC callback subscriptions unsubscribe independently", async () => {
  const source = events()
  const received = Promise.withResolvers<unknown>()
  const native = source.client.event.subscribe()[Symbol.asyncIterator]()
  await native.next()
  const unsubscribe = source.client.rpc(Echo).events.on("updated", received.resolve)
  await source.send(rpcEvent({ count: 42 }))
  expect(await received.promise).toMatchObject({ data: { count: 42 }, type: `rpc.${Echo.id}.updated` })
  unsubscribe()
  unsubscribe()
  expect(source.requests[0].signal.aborted).toBe(false)
  await native.return?.()
  await source.cancelled
})

test("RPC async callback failures stop only that listener and are not unhandled", async () => {
  const source = events()
  const client = source.client.rpc(Echo)
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const failed: number[] = []
  cleanup.add(release.resolve)
  cleanup.add(
    client.events.on("updated", async (event) => {
      failed.push(event.data.count)
      started.resolve()
      await release.promise
      throw new Error("Expected async RPC callback failure")
    }),
  )
  const healthy = client.events.subscribe("updated")[Symbol.asyncIterator]()
  const first = healthy.next()
  await source.send(rpcEvent({ count: 1 }))
  await started.promise
  expect((await first).value.data.count).toBe(1)
  const second = healthy.next()
  await source.send(rpcEvent({ count: 2 }))
  expect((await second).value.data.count).toBe(2)
  expect(failed).toEqual([1])
  release.resolve()
  await healthy.return?.()
  await source.cancelled
  expect(failed).toEqual([1])
})

test("RPC checks unknown event names and pre-aborted subscriptions remain lazy", async () => {
  const source = events()
  const broad: Rpc.PortableDefinition = Echo
  expect(() => source.client.rpc(broad).events.subscribe("unknown")).toThrow("Unknown RPC event")
  expect(() => source.client.rpc(broad).events.subscribe("toString")).toThrow("Unknown RPC event")
  expect(() => source.client.rpc(broad).events.on("unknown", () => {})).toThrow("Unknown RPC event")
  const aborted = source.client.rpc(Echo).events.subscribe("updated", { signal: AbortSignal.abort() })
  const iterator = aborted[Symbol.asyncIterator]()
  expect((await iterator.next()).done).toBe(true)
  expect(source.requests).toHaveLength(0)
})

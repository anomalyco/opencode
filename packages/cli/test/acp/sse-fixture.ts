import { OpenCode, type OpenCodeEvent, type SessionMessageInfo } from "@opencode-ai/client/promise"

type DurableEvent = Extract<OpenCodeEvent, { durable: unknown }>
type EphemeralEvent = Exclude<OpenCodeEvent, DurableEvent>

type RequestRecord = {
  readonly method: string
  readonly path: string
  readonly body?: unknown
}

type FixtureOptions = {
  readonly onPrompt?: (input: {
    readonly sessionID: string
    readonly id: string
    readonly body: unknown
    readonly signal: AbortSignal
    readonly send: (event: unknown) => void
  }) => void | Promise<void>
  readonly onInterrupt?: (input: {
    readonly sessionID: string
    readonly send: (event: unknown) => void
  }) => void | Promise<void>
  readonly onPermissionReply?: (input: {
    readonly sessionID: string
    readonly requestID: string
    readonly reply: string
    readonly body: unknown
    readonly send: (event: unknown) => void
  }) => void | Promise<void>
  readonly onFormCancel?: (input: {
    readonly sessionID: string
    readonly formID: string
    readonly send: (event: unknown) => void
  }) => void | Promise<void>
  readonly onFormReply?: (input: {
    readonly sessionID: string
    readonly formID: string
    readonly body: unknown
    readonly send: (event: unknown) => void
  }) => void | Promise<void>
}

const ids = { next: 0 }

export function durableEvent<Type extends DurableEvent["type"]>(
  type: Type,
  data: Extract<DurableEvent, { type: Type }>["data"],
) {
  ids.next++
  return {
    id: `evt_${ids.next}`,
    created: ids.next,
    type,
    durable: { aggregateID: "test", seq: ids.next, version: 1 },
    data,
  }
}

export function ephemeralEvent<Type extends EphemeralEvent["type"]>(
  type: Type,
  data: Extract<EphemeralEvent, { type: Type }>["data"],
) {
  ids.next++
  return { id: `evt_${ids.next}`, created: ids.next, type, data }
}

export function createSseFixture(options: FixtureOptions = {}) {
  const encoder = new TextEncoder()
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const requests: RequestRecord[] = []
  const messages = new Map<string, SessionMessageInfo>()

  const send = (event: unknown) => {
    for (const stream of streams) {
      try {
        stream.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      } catch {
        streams.delete(stream)
      }
    }
  }

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = request.method === "GET" ? undefined : await request.json().catch(() => undefined)
      requests.push({ method: request.method, path: url.pathname, ...(body === undefined ? {} : { body }) })

      if (url.pathname === "/api/event") {
        const state: { stream?: ReadableStreamDefaultController<Uint8Array> } = {}
        return new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              state.stream = stream
              streams.add(stream)
              stream.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ id: "evt_connected", type: "server.connected", data: {} })}\n\n`,
                ),
              )
            },
            cancel() {
              if (state.stream) streams.delete(state.stream)
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      }

      const prompt = /^\/api\/session\/([^/]+)\/prompt$/.exec(url.pathname)
      if (prompt?.[1]) {
        const id = stringField(body, "id")
        if (!id) return new Response(null, { status: 400 })
        await options.onPrompt?.({
          sessionID: decodeURIComponent(prompt[1]),
          id,
          body,
          signal: request.signal,
          send,
        })
        return Response.json({ data: { text: stringField(body, "text") ?? "" } })
      }

      const message = /^\/api\/session\/([^/]+)\/message\/([^/]+)$/.exec(url.pathname)
      if (message?.[1] && message[2]) {
        const sessionID = decodeURIComponent(message[1])
        const messageID = decodeURIComponent(message[2])
        return Response.json({
          data: messages.get(`${sessionID}/${messageID}`) ?? messages.get(messageID) ?? assistantMessage(messageID),
        })
      }

      const permission = /^\/api\/session\/([^/]+)\/permission\/([^/]+)\/reply$/.exec(url.pathname)
      if (permission?.[1] && permission[2]) {
        const reply = stringField(body, "reply")
        if (!reply) return new Response(null, { status: 400 })
        await options.onPermissionReply?.({
          sessionID: decodeURIComponent(permission[1]),
          requestID: decodeURIComponent(permission[2]),
          reply,
          body,
          send,
        })
        return new Response(null, { status: 204 })
      }

      const form = /^\/api\/session\/([^/]+)\/form\/([^/]+)\/cancel$/.exec(url.pathname)
      if (form?.[1] && form[2]) {
        await options.onFormCancel?.({
          sessionID: decodeURIComponent(form[1]),
          formID: decodeURIComponent(form[2]),
          send,
        })
        return new Response(null, { status: 204 })
      }

      const formReply = /^\/api\/session\/([^/]+)\/form\/([^/]+)\/reply$/.exec(url.pathname)
      if (formReply?.[1] && formReply[2]) {
        await options.onFormReply?.({
          sessionID: decodeURIComponent(formReply[1]),
          formID: decodeURIComponent(formReply[2]),
          body,
          send,
        })
        return new Response(null, { status: 204 })
      }

      const interrupt = /^\/api\/session\/([^/]+)\/interrupt$/.exec(url.pathname)
      if (interrupt?.[1]) {
        await options.onInterrupt?.({ sessionID: decodeURIComponent(interrupt[1]), send })
        return new Response(null, { status: 204 })
      }

      return new Response(null, { status: 404 })
    },
  })

  return {
    client: OpenCode.make({ baseUrl: server.url.toString() }),
    messages,
    requests,
    send,
    async stop() {
      for (const stream of streams) {
        try {
          stream.close()
        } catch {}
      }
      streams.clear()
      await server.stop(true)
    },
  }
}

export async function withTimeout<Value>(promise: Promise<Value>, message: string, milliseconds = 2_000) {
  const timeout = Promise.withResolvers<never>()
  const timer = setTimeout(() => timeout.reject(new Error(message)), milliseconds)
  try {
    return await Promise.race([promise, timeout.promise])
  } finally {
    clearTimeout(timer)
  }
}

function stringField(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined
  const field = Reflect.get(value, key)
  return typeof field === "string" ? field : undefined
}

function assistantMessage(id: string) {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { providerID: "test", id: "test-model" },
    content: [],
    finish: "stop",
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, completed: 2 },
  } satisfies SessionMessageInfo
}

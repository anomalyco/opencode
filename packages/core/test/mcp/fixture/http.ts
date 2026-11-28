import {
  createMcpHandler,
  WebStandardStreamableHTTPServerTransport,
  type McpServer,
} from "@modelcontextprotocol/server"
import { isRecord } from "@opencode/util/record"
import { Deferred, Effect, Exit, Queue } from "effect"
import { make, type Spec, type State } from "./server"

export type Era = "modern" | "legacy"

type Interceptor = (
  request: Request,
  body: Record<string, unknown> | undefined,
) => Response | undefined | Promise<Response | undefined>

/**
 * Serves the fixture over Streamable HTTP in process. A modern fixture serves 2026-07-28 only; a legacy one runs a
 * sessionful 2025 transport per client, which `restart` forgets, as a restarted server does. `intercept` answers
 * requests before the server does, for refusals, outages, held requests and protocol quirks.
 */
export const serve = (spec: Spec & { readonly era: Era }) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const state: State = { added: [] }
      const seen = {
        initializations: 0,
        discovers: 0,
        lists: 0,
        calls: [] as string[],
        sessions: new Set<string>(),
        methods: [] as string[],
      }
      const streams = new Set<EventStream>()
      // Requests the server is still answering; an open event stream counts only until its response starts.
      const inflight = { count: 0 }
      const opened = yield* Queue.unbounded<EventStream>()
      const interceptors: Interceptor[] = []
      const sessions = new Map<string, { server: McpServer; transport: WebStandardStreamableHTTPServerTransport }>()
      const strays: McpServer[] = []
      const modern =
        spec.era === "modern"
          ? createMcpHandler(() => make(spec, state, () => modern?.notify.toolsChanged()), { legacy: "reject" })
          : undefined
      const changed = () => {
        for (const session of sessions.values()) void session.server.sendToolListChanged()
      }
      const legacy = async (request: Request) => {
        const id = request.headers.get("mcp-session-id")
        const known = id ? sessions.get(id) : undefined
        if (known) return known.transport.handleRequest(request)
        const server = make(spec, state, changed)
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (session) => void sessions.set(session, { server, transport }),
          onsessionclosed: (session) => void sessions.delete(session),
        })
        strays.push(server)
        await server.connect(transport)
        return transport.handleRequest(request)
      }
      // Every event emitted, which a stream opened from an older cursor replays.
      const log: Array<Record<string, unknown>> = []
      const http = Bun.serve({
        port: 0,
        // Event and listen streams stay open with nothing to send.
        idleTimeout: 0,
        fetch: async (request) => {
          inflight.count++
          try {
            return await handle(request)
          } finally {
            inflight.count--
          }
        },
      })
      async function handle(request: Request) {
        const body: unknown = request.method === "POST" ? await request.clone().json() : undefined
        const message = isRecord(body) ? body : undefined
        const session = request.headers.get("mcp-session-id")
        if (session) seen.sessions.add(session)
        if (typeof message?.method === "string") {
          seen.methods.push(message.method)
          if (message.method === "initialize") seen.initializations++
          if (message.method === "server/discover") seen.discovers++
          if (message.method === "tools/list") seen.lists++
          if (message.method === "tools/call" && isRecord(message.params)) seen.calls.push(String(message.params.name))
        }
        for (const intercept of interceptors) {
          const response = await intercept(request, message)
          if (response) return response
        }
        if (spec.events && message) {
          const answered = events(request, message, log, (stream) => {
            streams.add(stream)
            Queue.offerUnsafe(opened, stream)
          })
          if (answered) return answered
        }
        return modern ? modern.fetch(request) : legacy(request)
      }
      return {
        url: http.url.href,
        state,
        seen,
        /** Whether a request is still waiting for its response, so a test should not move its clock yet. */
        busy: () => inflight.count > 0,
        /** Legacy sessions the server still holds. */
        sessions: () => sessions.size,
        /** Event streams still open. */
        streams: () => Array.from(streams).filter((stream) => !stream.closed()),
        /** The next \`events/stream\` a client opens. */
        opened: Queue.take(opened),
        /** How many events were emitted so far; event `eN` is the Nth. */
        emitted: () => log.length,
        /** Sends one `job.finished` event on every open event stream, and returns its ID. */
        emit: () => {
          const eventId = `e${log.length + 1}`
          const event = {
            eventId,
            name: "job.finished",
            timestamp: "2026-11-11T00:00:00Z",
            data: { eventId },
            cursor: `c${log.length + 1}`,
          }
          log.push(event)
          for (const stream of streams) stream.send("notifications/events/event", event)
          return eventId
        },
        intercept: (interceptor: Interceptor) => {
          interceptors.push(interceptor)
          return () => void interceptors.splice(interceptors.indexOf(interceptor), 1)
        },
        /** Tells every legacy client that a URL elicitation finished out of band. */
        complete: (elicitationID: string) =>
          Effect.promise(() =>
            Promise.all(
              Array.from(sessions.values(), (session) =>
                session.server.server.createElicitationCompletionNotifier(elicitationID)(),
              ),
            ),
          ),
        /** Forgets every legacy session, so their next request finds the session gone. */
        restart: () =>
          Effect.promise(async () => {
            const closing = Array.from(sessions.values(), (session) => session.server.close().catch(() => {}))
            sessions.clear()
            await Promise.all(closing)
          }),
        close: async () => {
          await Promise.all([...strays.map((server) => server.close().catch(() => {})), modern?.close()])
          await http.stop(true)
        },
      }
    }),
    (fixture) => Effect.promise(fixture.close),
  )

export type Fixture = Effect.Success<ReturnType<typeof serve>>

/**
 * One open `events/stream`. It is active from the start and replays what was emitted after its cursor; the test sends
 * its notifications and closes it.
 */
export interface EventStream {
  readonly params: Record<string, unknown>
  readonly aborted: Effect.Effect<void>
  readonly closed: () => boolean
  readonly send: (method: string, params: Record<string, unknown>) => void
  readonly close: () => void
}

const encode = (message: Record<string, unknown>) =>
  new TextEncoder().encode(`data: ${JSON.stringify({ jsonrpc: "2.0", ...message })}\n\n`)

// MCP Events over the fixture: one push event type, `job.finished`, and every stream held open for the test.
function events(
  request: Request,
  body: Record<string, unknown>,
  log: ReadonlyArray<Record<string, unknown>>,
  open: (stream: EventStream) => void,
) {
  if (body.method === "events/list")
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        resultType: "complete",
        events: [{ name: "job.finished", delivery: ["push"], inputSchema: {}, payloadSchema: {} }],
      },
    })
  if (body.method !== "events/stream") return undefined
  const meta = { "io.modelcontextprotocol/subscriptionId": body.id }
  const params = isRecord(body.params) ? body.params : {}
  const aborted = Deferred.makeUnsafe<void>()
  const abort = () => void Deferred.doneUnsafe(aborted, Exit.void)
  request.signal.addEventListener("abort", abort)
  const from = typeof params.cursor === "string" ? Number(params.cursor.slice(1)) : log.length
  const pending: Uint8Array[] = [
    encode({
      method: "notifications/events/active",
      params: { cursor: params.cursor ?? `c${log.length}`, truncated: false, heartbeatMs: 30_000, _meta: meta },
    }),
    ...log
      .slice(from)
      .map((event) => encode({ method: "notifications/events/event", params: { ...event, _meta: meta } })),
  ]
  const state: { controller?: ReadableStreamDefaultController<Uint8Array>; done: boolean } = { done: false }
  const write = (chunk: Uint8Array) => {
    if (state.done || Deferred.isDoneUnsafe(aborted)) return
    if (state.controller) return state.controller.enqueue(chunk)
    pending.push(chunk)
  }
  open({
    params,
    aborted: Deferred.await(aborted),
    closed: () => state.done || Deferred.isDoneUnsafe(aborted),
    send: (method, params) => write(encode({ method, params: { ...params, _meta: meta } })),
    close: () => {
      write(encode({ id: body.id, result: { resultType: "complete", _meta: meta } }))
      state.done = true
      state.controller?.close()
    },
  })
  return new Response(
    new ReadableStream<Uint8Array>({
      start: (controller) => {
        state.controller = controller
        for (const chunk of pending.splice(0)) controller.enqueue(chunk)
      },
      cancel: abort,
    }),
    { headers: { "content-type": "text/event-stream" } },
  )
}

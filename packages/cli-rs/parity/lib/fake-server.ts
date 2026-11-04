// A fake OpenCode server for P-CLI and P-PTY: it serves a scenario's route table and logs every
// request, so both clients can run with `--server <url>` and never touch the user's service.

import { createEventStream, createFetch } from "../../../tui/test/fixture/tui-client"

export type Route = {
  method?: string
  // An exact path, or a pattern where `:name` matches one segment (`/api/session/:id`).
  path: string
  status?: number
  // Sent as `application/json`.
  json?: unknown
  // Sent as is, with `headers` (default `text/plain`).
  body?: string
  headers?: Record<string, string>
  // An event stream: each event is one `data:` frame. The stream stays open until the server stops.
  events?: unknown[]
}

export type Logged = {
  method: string
  path: string
  query: Record<string, string[]>
  body?: unknown
  authorization?: string
  // No route and no fallback answered; the server replied 404.
  unmatched?: true
}

export type Options = {
  routes?: Route[]
  // `/api/info` for a server with this version. `false` leaves `/api/info` to the routes.
  version?: string | false
  // `tui` answers the startup reads of the TUI with the defaults of `packages/tui/test/fixture/tui-client.ts`,
  // including the event stream, after the routes.
  fallback?: "tui"
}

export type FakeServer = Awaited<ReturnType<typeof startFakeServer>>

export async function startFakeServer(options: Options = {}) {
  const requests: Logged[] = []
  const routes = [...(options.routes ?? []), ...infoRoute(options.version ?? "local")]
  const events = options.fallback === "tui" ? createEventStream() : undefined
  const fallback = events ? createFetch(undefined, events).fetch : undefined
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const entry = await logEntry(request, url)
      requests.push(entry)
      const route = routes.find((route) => matches(route, request.method, url.pathname))
      if (route) return respond(route, streams)
      const fallen = await Promise.resolve(fallback?.(url, request)).catch(() => undefined)
      if (fallen) return fallen
      entry.unmatched = true
      return Response.json(
        { _tag: "NotFound", message: `fake server: no route for ${request.method} ${url.pathname}` },
        { status: 404 },
      )
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    // Pushes an event to the open `fallback: "tui"` stream.
    emit: (event: Parameters<NonNullable<typeof events>["emit"]>[0]) => events?.emit(event),
    async stop() {
      events?.disconnect()
      for (const controller of streams) controller.close()
      await server.stop(true)
    },
  }
}

function infoRoute(version: string | false): Route[] {
  if (version === false) return []
  return [
    {
      method: "GET",
      path: "/api/info",
      json: { version, pid: 0, urls: [], paths: { tmp: "/tmp" }, capabilities: { persistentPty: true } },
    },
  ]
}

function matches(route: Route, method: string, path: string) {
  if ((route.method ?? "GET").toUpperCase() !== method) return false
  const want = route.path.split("/")
  const have = path.split("/")
  return want.length === have.length && want.every((part, index) => part.startsWith(":") || part === have[index])
}

function respond(route: Route, streams: Set<ReadableStreamDefaultController<Uint8Array>>) {
  const status = route.status ?? 200
  if (route.events) {
    const frames = route.events.map((event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    let current: ReadableStreamDefaultController<Uint8Array> | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        current = controller
        streams.add(controller)
        frames.forEach((frame) => controller.enqueue(frame))
      },
      cancel() {
        if (current) streams.delete(current)
      },
    })
    return new Response(stream, { status, headers: { "content-type": "text/event-stream", ...route.headers } })
  }
  if (route.json !== undefined) return Response.json(route.json, { status, headers: route.headers })
  if (route.body !== undefined)
    return new Response(route.body, { status, headers: { "content-type": "text/plain", ...route.headers } })
  return new Response(null, { status: route.status ?? 204, headers: route.headers })
}

async function logEntry(request: Request, url: URL): Promise<Logged> {
  const query = [...url.searchParams.keys()]
    .toSorted()
    .reduce<Record<string, string[]>>((all, key) => ({ ...all, [key]: url.searchParams.getAll(key) }), {})
  // A clone, so the fallback can still read the body.
  const text = request.body ? await request.clone().text() : ""
  return {
    method: request.method,
    path: url.pathname,
    query,
    ...(text ? { body: parseBody(text) } : {}),
    ...(request.headers.get("authorization") ? { authorization: request.headers.get("authorization")! } : {}),
  }
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

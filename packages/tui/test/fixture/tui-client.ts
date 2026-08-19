import { OpenCode, type OpenCodeEvent } from "@opencode-ai/client"

export const worktree = "/tmp/opencode"
export const directory = `${worktree}/packages/tui`

export function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  if (!headers.has("content-type")) headers.set("content-type", "application/json")
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  })
}

export function createEventStream() {
  const encoder = new TextEncoder()
  const v2 = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const pending: Uint8Array[] = []
  const logs = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>()
  const logSeq = new Map<string, number>()
  const logHistory = new Map<string, Array<{ readonly seq: number; readonly event: unknown }>>()
  const response = (
    controllers: Set<ReadableStreamDefaultController<Uint8Array>>,
    queued: Uint8Array[],
    initial?: unknown,
  ) => {
    let current: ReadableStreamDefaultController<Uint8Array> | undefined
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          current = controller
          controllers.add(controller)
          const values = Array.isArray(initial) ? initial : initial ? [initial] : []
          for (const value of values) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
          for (const chunk of queued.splice(0)) controller.enqueue(chunk)
        },
        cancel() {
          if (current) controllers.delete(current)
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
  }
  const send = (
    controllers: Set<ReadableStreamDefaultController<Uint8Array>>,
    queued: Uint8Array[],
    event: unknown,
  ) => {
    const chunk = encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
    if (controllers.size === 0) {
      queued.push(chunk)
      return
    }
    for (const controller of controllers) controller.enqueue(chunk)
  }

  return {
    emit(event: OpenCodeEvent) {
      send(v2, pending, event)
      const sessionID =
        "durable" in event
          ? event.durable.aggregateID
          : "sessionID" in event.data && typeof event.data.sessionID === "string"
            ? event.data.sessionID
            : undefined
      if (!sessionID) return
      const seq = (logSeq.get(sessionID) ?? 0) + 1
      const item = "durable" in event ? { ...event, durable: { ...event.durable, seq } } : event
      if ("durable" in event) {
        logSeq.set(sessionID, seq)
        logHistory.set(sessionID, [...(logHistory.get(sessionID) ?? []), { seq, event: item }])
      }
      const controllers = logs.get(sessionID)
      if (controllers) send(controllers, [], item)
    },
    v2() {
      return response(v2, pending, { id: "evt_connected", type: "server.connected", data: {} })
    },
    log(sessionID: string, after: number) {
      const controllers = logs.get(sessionID) ?? new Set<ReadableStreamDefaultController<Uint8Array>>()
      logs.set(sessionID, controllers)
      return response(
        controllers,
        [],
        [
          ...(logHistory.get(sessionID) ?? []).filter((entry) => entry.seq > after).map((entry) => entry.event),
          { type: "log.synced", aggregateID: sessionID, seq: logSeq.get(sessionID) ?? 0 },
        ],
      )
    },
    seq(sessionID: string) {
      return logSeq.get(sessionID) ?? 0
    },
    disconnect() {
      for (const controller of v2) controller.close()
      v2.clear()
      for (const controllers of logs.values()) {
        for (const controller of controllers) controller.close()
        controllers.clear()
      }
    },
  }
}

export type FetchHandler = (url: URL, request: Request) => Response | undefined | Promise<Response | undefined>

export function createFetch(override?: FetchHandler, events?: ReturnType<typeof createEventStream>) {
  const session = [] as URL[]
  const sessionEvents = events ?? createEventStream()
  const snapshots = new Map<string, number>()
  async function fetch(input: RequestInfo | URL, init?: RequestInit) {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === "/session") session.push(url)
    const overridden = await override?.(url, request)
    if (overridden) return overridden
    if (url.pathname === "/api/event" && events) return events.v2()
    const snapshot = url.pathname.match(/^\/api\/session\/([^/]+)\/snapshot$/)
    if (snapshot) {
      const sessionID = decodeURIComponent(snapshot[1])
      const count = snapshots.get(sessionID) ?? 0
      snapshots.set(sessionID, count + 1)
      // Synthetic sub-reads reuse the test override as the data source but are
      // not app traffic; the marker header lets request-observing tests skip them.
      const read = async (path: string, fallback: unknown) => {
        const target = new URL(path, url)
        const response = await override?.(target, new Request(target, { headers: { "x-fixture-synthetic": "snapshot" } }))
        if (!response) return fallback
        const body = await response.json()
        if (typeof body !== "object" || body === null || !("data" in body)) return fallback
        return body.data
      }
      const children = await read(`/api/session?parentID=${encodeURIComponent(sessionID)}`, [])
      const messages = await read(`/api/session/${encodeURIComponent(sessionID)}/message`, [])
      return json({
        data: {
          session: await read(`/api/session/${encodeURIComponent(sessionID)}`, {
            id: sessionID,
            projectID: "proj_test",
            location: { directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
          }),
          children: Array.isArray(children)
            ? children.filter(
                (child) =>
                  typeof child === "object" && child !== null && "parentID" in child && child.parentID === sessionID,
              )
            : [],
          inbox: await read(`/api/session/${encodeURIComponent(sessionID)}/inbox`, []),
          messages: Array.isArray(messages) ? messages.toReversed() : [],
          seq: count === 0 ? 0 : sessionEvents.seq(sessionID),
        },
      })
    }
    const log = url.pathname.match(/^\/api\/experimental\/session\/([^/]+)\/log$/)
    if (log) return sessionEvents.log(decodeURIComponent(log[1]), Number(url.searchParams.get("after") ?? 0))

    if (
      [
        "/agent",
        "/command",
        "/experimental/workspace",
        "/experimental/workspace/status",
        "/formatter",
        "/lsp",
      ].includes(url.pathname)
    )
      return json([])
    if (["/config", "/experimental/resource", "/mcp", "/provider/auth", "/session/status"].includes(url.pathname))
      return json({})
    if (url.pathname === "/config/providers") return json({ providers: {}, default: {} })
    if (url.pathname === "/experimental/console") return json({ consoleManagedProviders: [], switchableOrgCount: 0 })
    if (url.pathname === "/experimental/capabilities") return json({ backgroundSubagents: true })
    if (url.pathname === "/path") return json({ home: "", state: "", config: "", worktree, directory })
    if (url.pathname === "/api/location")
      return json({ directory, project: { id: "proj_test", directory: worktree, canonical: worktree } })
    if (url.pathname === "/api/vcs")
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: { branch: { current: "main", default: "main" } },
      })
    if (url.pathname === "/api/fs/list")
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: [],
      })
    if (url.pathname === "/api/project/current") return json({ id: "proj_test", directory: worktree })
    if (url.pathname === "/api/project") return json([])
    if (url.pathname === "/api/worktree/proj_test") {
      if (request.method === "GET") return json([{ directory: worktree }])
      if (request.method === "POST") return json({ directory: `${worktree}/created` })
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/api/worktree/proj_test/refresh") return new Response(null, { status: 204 })
    if (url.pathname === "/api/shell")
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: [],
      })
    if (url.pathname === "/api/mcp")
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: [],
      })
    if (url.pathname === "/api/mcp/resource")
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: { resources: [], templates: [] },
      })
    if (url.pathname === "/api/session") return json({ data: [], cursor: {} })
    if (url.pathname === "/api/session/active") return json({ data: {} })
    if (url.pathname === "/api/permission/request")
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: [],
      })
    if (url.pathname === "/api/form/request")
      return json({ location: { directory, project: { id: "proj_test", directory: worktree } }, data: [] })
    if (/^\/api\/session\/[^/]+\/form$/.test(url.pathname)) return json({ data: [] })
    if (
      ["/api/agent", "/api/model", "/api/provider", "/api/integration", "/api/command", "/api/skill"].includes(
        url.pathname,
      )
    )
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
        data: [],
      })
    if (url.pathname === "/api/reference")
      return json({ location: { directory, project: { id: "proj_test", directory, canonical: directory } }, data: [] })
    if (url.pathname === "/api/websearch/provider") {
      return json({ location: { directory, project: { id: "proj_test", directory, canonical: directory } }, data: [] })
    }
    if (url.pathname === "/provider") return json({ all: [], default: {}, connected: [] })
    if (url.pathname === "/session") return json([])
    if (url.pathname === "/vcs") return json({ branch: "main" })
    if (url.pathname === "/api/experimental/migration/v1") return json({ status: "completed" })
    throw new Error(`unexpected request: ${url.pathname}`)
  }
  fetch.preconnect = () => {}
  return { fetch, session }
}

export function createApi(fetch: typeof globalThis.fetch) {
  return OpenCode.make({ baseUrl: "http://test", fetch })
}

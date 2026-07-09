import { OpenCode } from "@opencode-ai/client/promise"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { V2Event } from "@opencode-ai/sdk/v2"

export const worktree = "/tmp/opencode"
export const directory = `${worktree}/packages/tui`

export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
}

export function createEventStream() {
  const encoder = new TextEncoder()
  const v2 = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const pending: Uint8Array[] = []
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
          if (initial) controller.enqueue(encoder.encode(`data: ${JSON.stringify(initial)}\n\n`))
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
    emit(event: V2Event) {
      send(v2, pending, event)
    },
    v2() {
      return response(v2, pending, { id: "evt_connected", type: "server.connected", data: {} })
    },
    disconnect() {
      for (const controller of v2) controller.close()
      v2.clear()
    },
  }
}

export type FetchHandler = (url: URL) => Response | Promise<Response> | undefined

export function createFetch(override?: FetchHandler, events?: ReturnType<typeof createEventStream>) {
  const session = [] as URL[]
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === "/session") session.push(url)
    const overridden = await override?.(url)
    if (overridden) return overridden
    if (url.pathname === "/api/event" && events) return events.v2()

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
    if (url.pathname === "/api/location") return json({ directory, project: { id: "proj_test", directory: worktree } })
    if (url.pathname === "/api/fs/list")
      return json({ location: { directory, project: { id: "proj_test", directory: worktree } }, data: [] })
    if (url.pathname === "/api/project/current") return json({ id: "proj_test", directory: worktree })
    if (url.pathname === "/api/project/proj_test/directories") return json([{ directory: worktree }])
    if (url.pathname === "/api/shell")
      return json({ location: { directory, project: { id: "proj_test", directory: worktree } }, data: [] })
    if (url.pathname === "/api/mcp")
      return json({ location: { directory, project: { id: "proj_test", directory: worktree } }, data: [] })
    if (url.pathname === "/api/session") return json({ data: [], cursor: {} })
    if (url.pathname === "/api/session/active") return json({ data: {} })
    if (url.pathname === "/api/permission/request")
      return json({ location: { directory, project: { id: "proj_test", directory: worktree } }, data: [] })
    if (url.pathname === "/api/form/request")
      return json({ location: { directory, project: { id: "proj_test", directory: worktree } }, data: [] })
    if (/^\/api\/session\/[^/]+\/form$/.test(url.pathname)) return json({ data: [] })
    if (
      ["/api/agent", "/api/model", "/api/provider", "/api/integration", "/api/command", "/api/skill"].includes(
        url.pathname,
      )
    )
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree } },
        data: [],
      })
    if (url.pathname === "/api/reference")
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    if (url.pathname === "/provider") return json({ all: [], default: {}, connected: [] })
    if (url.pathname === "/session") return json([])
    if (url.pathname === "/vcs") return json({ branch: "main" })
    throw new Error(`unexpected request: ${url.pathname}`)
  }) as typeof globalThis.fetch
  return { fetch, session }
}

export function createClient(fetch: typeof globalThis.fetch) {
  return createOpencodeClient({ baseUrl: "http://test", fetch })
}

export function createApi(fetch: typeof globalThis.fetch) {
  return OpenCode.make({ baseUrl: "http://test", fetch })
}

import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import type { EventSource } from "../../src/context/sdk"

export const worktree = "/tmp/opencode"
export const directory = `${worktree}/packages/tui`

export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
}

export function eventSource(): EventSource {
  return { subscribe: async () => () => {} }
}

export function createEventSource() {
  let fn: ((event: GlobalEvent) => void) | undefined
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const pending: Uint8Array[] = []
  return {
    source: {
      subscribe: async (handler: (event: GlobalEvent) => void) => {
        fn = handler
        return () => {
          if (fn === handler) fn = undefined
        }
      },
    } satisfies EventSource,
    emit(event: GlobalEvent) {
      if (!fn) throw new Error("event source not ready")
      fn(event)
      if (!("properties" in event.payload)) return
      const chunk = new TextEncoder().encode(
        `data: ${JSON.stringify({
          ...event.payload,
          location: { directory: event.directory, workspaceID: event.workspace },
          data: event.payload.properties,
        })}\n\n`,
      )
      if (stream) return stream.enqueue(chunk)
      pending.push(chunk)
    },
    response() {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller
            for (const chunk of pending.splice(0)) controller.enqueue(chunk)
          },
          cancel() {
            stream = undefined
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  }
}

export type FetchHandler = (url: URL) => Response | Promise<Response> | undefined

export function createFetch(override?: FetchHandler, events?: ReturnType<typeof createEventSource>) {
  const session = [] as URL[]
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === "/session") session.push(url)
    const overridden = await override?.(url)
    if (overridden) return overridden
    if (url.pathname === "/api/event" && events) return events.response()

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
    if (url.pathname === "/experimental/capabilities") return json({ backgroundSubagents: false })
    if (url.pathname === "/path") return json({ home: "", state: "", config: "", worktree, directory })
    if (url.pathname === "/api/location") return json({ directory, project: { id: "proj_test", directory: worktree } })
    if (
      ["/api/agent", "/api/model", "/api/provider", "/api/integration", "/api/command", "/api/skill"].includes(
        url.pathname,
      )
    )
      return json({
        location: { directory, project: { id: "proj_test", directory: worktree } },
        data: [],
      })
    if (url.pathname === "/project/current") return json({ id: "proj_test" })
    if (url.pathname === "/api/reference")
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    if (url.pathname === "/provider") return json({ all: [], default: {}, connected: [] })
    if (url.pathname === "/session") return json([])
    if (url.pathname === "/vcs") return json({ branch: "main" })
    throw new Error(`unexpected request: ${url.pathname}`)
  }) as typeof globalThis.fetch
  return { fetch, session }
}

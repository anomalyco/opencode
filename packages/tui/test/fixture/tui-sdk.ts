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
    },
  }
}

export type FetchHandler = (url: URL) => Response | Promise<Response> | undefined

const SESSION_DETAIL = /^\/session\/[^/]+(\/[^/]+)?$/

export function createFetch(override?: FetchHandler) {
  const session = [] as URL[]
  // Per-session-detail fetches (session.get, messages, todo, diff) hit
  // /session/{id} and a few subpaths. Track them in their own array so
  // tests can assert how many re-syncs happened without parsing the
  // generic `session` (list) array.
  const sessionDetail = [] as URL[]
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === "/session") session.push(url)
    if (SESSION_DETAIL.test(url.pathname)) sessionDetail.push(url)
    const overridden = await override?.(url)
    if (overridden) return overridden

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
    if (url.pathname === "/path") return json({ home: "", state: "", config: "", worktree, directory })
    if (url.pathname === "/project/current") return json({ id: "proj_test" })
    if (url.pathname === "/provider") return json({ all: [], default: {}, connected: [] })
    if (url.pathname === "/session") return json([])
    if (url.pathname === "/vcs") return json({ branch: "main" })
    // Per-session detail endpoints: session.get, messages, todo, diff.
    // Return a minimal valid payload so callers that go on to render
    // the result don't crash, and tests can assert on sessionDetail
    // counts without standing up a full server.
    if (SESSION_DETAIL.test(url.pathname)) {
      // v1 messages endpoint is `/session/{id}/message` (singular).
      // The TUI's sync.session.sync reads `messages.data` as an array of
      // `{ info, parts }` envelopes, so return that shape (empty list).
      if (url.pathname.endsWith("/message")) return json([])
      if (url.pathname.endsWith("/messages")) return json([])
      if (url.pathname.endsWith("/todo")) return json([])
      if (url.pathname.endsWith("/diff")) return json([])
      // Bare /session/{id} — session.get
      return json({
        id: url.pathname.split("/").pop()!,
        slug: "",
        title: "",
        version: "",
        directory,
        parentID: null,
        time: { created: Date.now(), updated: Date.now() },
        share: { url: "" },
      })
    }
    throw new Error(`unexpected request: ${url.pathname}`)
  }) as typeof globalThis.fetch
  return { fetch, session, sessionDetail }
}

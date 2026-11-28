import { expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { OpenCode } from "@opencode/client/promise"
import { createRoot, createSignal, untrack } from "solid-js"
import { createGlobalQueries } from "@/runtime/server/global-sync/bootstrap"
import { ServerScope } from "@/runtime/server/scope"

function setup(connectedAtFirst: boolean) {
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(new Request(input, init).url)

        if (url.pathname === "/api/location")
          return Response.json({
            directory: "/Users/me/work",
            project: { id: "project", directory: "/Users/me/work", canonical: "/Users/me/work" },
          })
        throw new Error(`Unexpected request: ${url.pathname}`)
      },
      { preconnect() {} },
    ),
  })

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const [connected, setConnected] = createSignal(connectedAtFirst)

  return createRoot((dispose) => {
    const made: ReturnType<typeof createGlobalQueries>[] = []

    QueryClientProvider({
      client: queryClient,
      get children() {
        // Untracked, as a context is created once: the provider reads its children inside a memo.
        made.push(untrack(() => createGlobalQueries({ scope: ServerScope.local, location: api.location, connected })))

        return undefined
      },
    })

    const queries = made[0]

    if (!queries) throw new Error("queries required")

    return {
      queries,
      setConnected,
      dispose() {
        dispose()
        queryClient.clear()
      },
    }
  })
}

// Waits for the home folder with a bound, so a regression fails instead of hanging the runner.
async function home(queries: ReturnType<typeof createGlobalQueries>) {
  for (let attempt = 0; attempt < 50 && !queries.path().home; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  return queries.path().home
}

// Runs under the browser build: the server build of Solid never re-runs the queries when the status changes.
test("knows the server's home folder once a server that was still connecting has connected", async () => {
  const root = setup(false)

  try {
    expect(root.queries.path()).toEqual({ state: "", config: "", worktree: "", directory: "", home: "" })
    expect(root.queries.config()).toEqual({})

    root.setConnected(true)

    expect(await home(root.queries)).toBe("/Users/me")
    expect(root.queries.path()).toEqual({
      state: "",
      config: "",
      worktree: "/Users/me/work",
      directory: "/Users/me/work",
      home: "/Users/me",
    })
  } finally {
    root.dispose()
  }
})

test("keeps the server's home folder while the connection drops and returns", async () => {
  const root = setup(true)

  try {
    expect(await home(root.queries)).toBe("/Users/me")

    root.setConnected(false)
    expect(root.queries.path().home).toBe("/Users/me")

    root.setConnected(true)
    expect(await home(root.queries)).toBe("/Users/me")
  } finally {
    root.dispose()
  }
})

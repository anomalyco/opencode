import { afterEach, describe, expect, mock, test } from "bun:test"
import { createPluginFetch, resetPluginClientReachabilityForTests } from "@/plugin/client"

function asFetch(fn: (request: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return Object.assign(fn, { preconnect: globalThis.fetch.preconnect }) as unknown as typeof globalThis.fetch
}

afterEach(() => {
  resetPluginClientReachabilityForTests()
  mock.restore()
})

describe("plugin client transport", () => {
  test("uses live listener when probe succeeds", async () => {
    const liveFetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (new URL(request.url).pathname === "/session") return new Response("[]", { status: 200 })
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } })
    })
    const liveFetch = asFetch(liveFetchMock)
    const fallbackFetchMock = mock(async () => new Response("fallback", { status: 200 }))
    const fallbackFetch = asFetch(fallbackFetchMock)
    const previousFetch = globalThis.fetch
    globalThis.fetch = liveFetch

    try {
      const fetch = createPluginFetch({
        getServerUrl: () => new URL("http://127.0.0.1:7777"),
        fallbackFetch,
      })

      const result = await fetch(new Request("http://localhost/session"))
      expect(result.status).toBe(200)
      expect(fallbackFetchMock).not.toHaveBeenCalled()
      expect(liveFetchMock).toHaveBeenCalledTimes(2)
      const request = liveFetchMock.mock.calls[1]?.[0]
      const finalUrl = request instanceof Request ? request.url : String(request)
      expect(finalUrl.startsWith("http://127.0.0.1:7777/")).toBe(true)
    } finally {
      globalThis.fetch = previousFetch
    }
  })

  test("probe 401 falls back without second live request", async () => {
    const liveFetchMock = mock(async () => new Response("unauthorized", { status: 401 }))
    const liveFetch = asFetch(liveFetchMock)
    const fallbackFetchMock = mock(
      async () => new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }),
    )
    const fallbackFetch = asFetch(fallbackFetchMock)
    const previousFetch = globalThis.fetch
    globalThis.fetch = liveFetch

    try {
      const fetch = createPluginFetch({
        getServerUrl: () => new URL("http://127.0.0.1:7778"),
        fallbackFetch,
      })

      const result = await fetch(new Request("http://localhost/session"))
      expect(result.status).toBe(200)
      expect(liveFetchMock).toHaveBeenCalledTimes(1)
      expect(fallbackFetchMock).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = previousFetch
    }
  })

  test("live 401 demotes cache and retries fallback", async () => {
    const liveFetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (new URL(request.url).pathname === "/session") return new Response("[]", { status: 200 })
      return new Response("unauthorized", { status: 401 })
    })
    const liveFetch = asFetch(liveFetchMock)
    const fallbackFetchMock = mock(async () => new Response("fallback", { status: 200 }))
    const fallbackFetch = asFetch(fallbackFetchMock)
    const previousFetch = globalThis.fetch
    globalThis.fetch = liveFetch

    try {
      const fetch = createPluginFetch({
        getServerUrl: () => new URL("http://127.0.0.1:7779"),
        fallbackFetch,
      })

      const first = await fetch(new Request("http://localhost/app"))
      const second = await fetch(new Request("http://localhost/app"))

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(liveFetchMock).toHaveBeenCalledTimes(2)
      expect(fallbackFetchMock).toHaveBeenCalledTimes(2)
    } finally {
      globalThis.fetch = previousFetch
    }
  })

  test("POST body survives fallback retry after live 401", async () => {
    const liveFetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (new URL(request.url).pathname === "/session") return new Response("[]", { status: 200 })
      return new Response("unauthorized", { status: 401 })
    })
    const liveFetch = asFetch(liveFetchMock)
    const fallbackBodies: string[] = []
    const fallbackFetchMock = mock(async (request: Request) => {
      fallbackBodies.push(await request.text())
      return new Response("fallback", { status: 200 })
    })
    const fallbackFetch = asFetch(fallbackFetchMock as unknown as typeof globalThis.fetch)
    const previousFetch = globalThis.fetch
    globalThis.fetch = liveFetch

    try {
      const fetch = createPluginFetch({
        getServerUrl: () => new URL("http://127.0.0.1:7780"),
        fallbackFetch: fallbackFetch as unknown as (request: Request) => Promise<Response>,
      })

      const result = await fetch(
        new Request("http://localhost/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hello: "world" }),
        }),
      )

      expect(result.status).toBe(200)
      expect(fallbackBodies).toEqual([JSON.stringify({ hello: "world" })])
    } finally {
      globalThis.fetch = previousFetch
    }
  })

  test("rewrite preserves auth and directory headers on live success", async () => {
    const liveRequests: Request[] = []
    const liveFetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (new URL(request.url).pathname === "/session") return new Response("[]", { status: 200 })
      liveRequests.push(request)
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } })
    })
    const liveFetch = asFetch(liveFetchMock)
    const fallbackFetchMock = mock(async () => new Response("fallback", { status: 200 }))
    const fallbackFetch = asFetch(fallbackFetchMock)
    const previousFetch = globalThis.fetch
    globalThis.fetch = liveFetch

    try {
      const fetch = createPluginFetch({
        getServerUrl: () => new URL("http://127.0.0.1:7781"),
        fallbackFetch,
      })

      const result = await fetch(
        new Request("http://localhost/chat?foo=bar", {
          headers: {
            Authorization: "Bearer token",
            "x-opencode-directory": "/tmp/project",
          },
        }),
      )

      expect(result.status).toBe(200)
      expect(liveRequests).toHaveLength(1)
      expect(liveRequests[0]?.url).toBe("http://127.0.0.1:7781/chat?foo=bar")
      expect(liveRequests[0]?.headers.get("Authorization")).toBe("Bearer token")
      expect(liveRequests[0]?.headers.get("x-opencode-directory")).toBe("/tmp/project")
    } finally {
      globalThis.fetch = previousFetch
    }
  })

  test("falls back to in-process fetch when live listener probe fails", async () => {
    const liveFetchMock = mock(async () => new Response("missing", { status: 404 }))
    const liveFetch = asFetch(liveFetchMock)
    const fallbackFetchMock = mock(
      async () => new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }),
    )
    const fallbackFetch = asFetch(fallbackFetchMock)
    const previousFetch = globalThis.fetch
    globalThis.fetch = liveFetch

    try {
      const fetch = createPluginFetch({
        getServerUrl: () => new URL("http://127.0.0.1:8888"),
        fallbackFetch,
      })

      const result = await fetch(new Request("http://localhost/session"))
      expect(result.status).toBe(200)
      expect(liveFetchMock).toHaveBeenCalledTimes(1)
      expect(fallbackFetchMock).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = previousFetch
    }
  })
})

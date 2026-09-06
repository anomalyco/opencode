import { describe, expect, test } from "bun:test"
import { listPlugins, pluginInvoke, setPluginServer, type OfficePreviewResult } from "./plugin-invoke"

type Seen = { url: URL; init: RequestInit | undefined }

function fakeFetch(handler: (req: Request) => Response) {
  const seen: Seen[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const req = new Request(input, init)
    seen.push({ url, init })
    return handler(req)
  }) as unknown as typeof globalThis.fetch
  return { fetch, seen }
}

describe("plugin-invoke", () => {
  test("listPlugins GETs /api/plugin and parses entries", async () => {
    const { fetch, seen } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "office-preview", invokes: ["office.preview"] },
              { id: "other", invokes: [] },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    )
    setPluginServer({ url: "http://localhost:4096" })
    try {
      await expect(listPlugins(fetch)).resolves.toEqual([
        { id: "office-preview", invokes: ["office.preview"] },
        { id: "other", invokes: [] },
      ])
      expect(seen[0].url.pathname).toBe("/api/plugin")
      expect(seen[0].init?.method).toBeUndefined()
      expect(seen[0].init?.headers).toEqual({})
    } finally {
      setPluginServer(undefined)
    }
  })

  test("listPlugins sends Basic auth when credentials are set", async () => {
    const { fetch, seen } = fakeFetch(() => new Response(JSON.stringify({ data: [] })))
    setPluginServer({ url: "http://localhost:4096", username: "user", password: "secret" })
    try {
      await listPlugins(fetch)
      expect(seen[0].init?.headers).toEqual({ Authorization: `Basic ${btoa("user:secret")}` })
    } finally {
      setPluginServer(undefined)
    }
  })

  test("listPlugins throws an Error carrying the server message on non-2xx", async () => {
    const { fetch } = fakeFetch(() => new Response(JSON.stringify({ error: "plugins are disabled" }), { status: 403 }))
    setPluginServer({ url: "http://localhost:4096" })
    try {
      await expect(listPlugins(fetch)).rejects.toThrow("plugins are disabled")
    } finally {
      setPluginServer(undefined)
    }
  })

  test("listPlugins falls back to status when the error body is empty", async () => {
    const { fetch } = fakeFetch(() => new Response(undefined, { status: 500 }))
    setPluginServer({ url: "http://localhost:4096" })
    try {
      await expect(listPlugins(fetch)).rejects.toThrow("GET /api/plugin failed: 500")
    } finally {
      setPluginServer(undefined)
    }
  })

  test("listPlugins rejects when no server is configured", async () => {
    setPluginServer(undefined)
    await expect(listPlugins()).rejects.toThrow("No active server connection")
  })

  test("passes an abort timeout signal to both requests", async () => {
    const { fetch, seen } = fakeFetch(() => new Response(JSON.stringify({ data: [] })))
    setPluginServer({ url: "http://localhost:4096" })
    try {
      await listPlugins(fetch)
      await pluginInvoke("p", "n", {}, fetch)
      expect(seen[0].init?.signal).toBeInstanceOf(AbortSignal)
      expect(seen[1].init?.signal).toBeInstanceOf(AbortSignal)
    } finally {
      setPluginServer(undefined)
    }
  })

  test("pluginInvoke POSTs name and input to /api/plugin/:id/invoke", async () => {
    const { fetch, seen } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            result: {
              managed: true,
              source: "draft",
              filename: "a.docx",
              contentType: "markdown",
              comments: [],
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    )
    setPluginServer({ url: "http://localhost:4096", username: "user", password: "secret" })
    try {
      const result = await pluginInvoke<OfficePreviewResult>(
        "office preview",
        "office.preview",
        {
          filePath: "/tmp/a.docx",
          sessionID: "ses_1",
        },
        fetch,
      )
      expect(result?.managed).toBe(true)
      expect(seen[0].url.pathname).toBe("/api/plugin/office%20preview/invoke")
      expect(seen[0].init?.method).toBe("POST")
      expect((seen[0].init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json")
      expect((seen[0].init?.headers as Record<string, string>)["Authorization"]).toBe(`Basic ${btoa("user:secret")}`)
      expect(JSON.parse(String(seen[0].init?.body))).toEqual({
        name: "office.preview",
        input: { filePath: "/tmp/a.docx", sessionID: "ses_1" },
      })
    } finally {
      setPluginServer(undefined)
    }
  })

  test("pluginInvoke resolves undefined for 204 responses", async () => {
    const { fetch } = fakeFetch(() => new Response(undefined, { status: 204 }))
    setPluginServer({ url: "http://localhost:4096" })
    try {
      await expect(pluginInvoke("office-preview", "office.preview", {}, fetch)).resolves.toBeUndefined()
    } finally {
      setPluginServer(undefined)
    }
  })

  test("pluginInvoke throws an Error carrying the server message on non-2xx", async () => {
    const { fetch } = fakeFetch(() => new Response("server exploded", { status: 500 }))
    setPluginServer({ url: "http://localhost:4096" })
    try {
      await expect(pluginInvoke("x", "office.preview", {}, fetch)).rejects.toThrow("server exploded")
    } finally {
      setPluginServer(undefined)
    }
  })
})

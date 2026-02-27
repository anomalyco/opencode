import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { WebFetchTool } from "../../src/tool/webfetch"

const projectRoot = path.join(import.meta.dir, "../..")

const ctx = {
  sessionID: "test",
  messageID: "message",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

async function withFetch(
  mockFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch as unknown as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

describe("tool.webfetch accept headers", () => {
  test("markdown format sends text/markdown as highest priority", async () => {
    let captured: RequestInit | undefined
    await withFetch(
      async (_url, init) => {
        captured = init
        return new Response("# Hello", { status: 200, headers: { "content-type": "text/markdown" } })
      },
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            await webfetch.execute({ url: "https://example.com", format: "markdown" }, ctx)
            const accept = (captured?.headers as Record<string, string>)?.Accept ?? ""
            expect(accept).toStartWith("text/markdown")
          },
        })
      },
    )
  })

  test("text format sends text/plain as highest priority", async () => {
    let captured: RequestInit | undefined
    await withFetch(
      async (_url, init) => {
        captured = init
        return new Response("hello", { status: 200, headers: { "content-type": "text/plain" } })
      },
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            await webfetch.execute({ url: "https://example.com", format: "text" }, ctx)
            const accept = (captured?.headers as Record<string, string>)?.Accept ?? ""
            expect(accept).toStartWith("text/plain")
          },
        })
      },
    )
  })

  test("html format sends text/html as highest priority", async () => {
    let captured: RequestInit | undefined
    await withFetch(
      async (_url, init) => {
        captured = init
        return new Response("<p>hi</p>", { status: 200, headers: { "content-type": "text/html" } })
      },
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            await webfetch.execute({ url: "https://example.com", format: "html" }, ctx)
            const accept = (captured?.headers as Record<string, string>)?.Accept ?? ""
            expect(accept).toStartWith("text/html")
          },
        })
      },
    )
  })

  test("default accept header prioritizes text/markdown", async () => {
    let captured: RequestInit | undefined
    await withFetch(
      async (_url, init) => {
        captured = init
        return new Response("# Hello", { status: 200, headers: { "content-type": "text/markdown" } })
      },
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            // format defaults to "markdown" via zod, so we test the explicit markdown path
            await webfetch.execute({ url: "https://example.com", format: "markdown" }, ctx)
            const accept = (captured?.headers as Record<string, string>)?.Accept ?? ""
            expect(accept).toContain("text/markdown")
            expect(accept.indexOf("text/markdown")).toBeLessThan(accept.indexOf("text/html"))
          },
        })
      },
    )
  })

  test("markdown format returns server markdown without conversion", async () => {
    const md = "# Title\n\nSome **bold** text"
    await withFetch(
      async () => new Response(md, { status: 200, headers: { "content-type": "text/markdown; charset=utf-8" } }),
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            const result = await webfetch.execute({ url: "https://example.com/page", format: "markdown" }, ctx)
            expect(result.output).toBe(md)
          },
        })
      },
    )
  })

  test("markdown format converts html response to markdown", async () => {
    const html = "<h1>Title</h1><p>Hello world</p>"
    await withFetch(
      async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            const result = await webfetch.execute({ url: "https://example.com/page", format: "markdown" }, ctx)
            expect(result.output).toContain("Title")
            expect(result.output).toContain("Hello world")
            expect(result.output).not.toContain("<h1>")
          },
        })
      },
    )
  })
})

describe("tool.webfetch", () => {
  test("returns image responses as file attachments", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    await withFetch(
      async () => new Response(bytes, { status: 200, headers: { "content-type": "IMAGE/PNG; charset=binary" } }),
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            const result = await webfetch.execute({ url: "https://example.com/image.png", format: "markdown" }, ctx)
            expect(result.output).toBe("Image fetched successfully")
            expect(result.attachments).toBeDefined()
            expect(result.attachments?.length).toBe(1)
            expect(result.attachments?.[0].type).toBe("file")
            expect(result.attachments?.[0].mime).toBe("image/png")
            expect(result.attachments?.[0].url.startsWith("data:image/png;base64,")).toBe(true)
            expect(result.attachments?.[0]).not.toHaveProperty("id")
            expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
            expect(result.attachments?.[0]).not.toHaveProperty("messageID")
          },
        })
      },
    )
  })

  test("keeps svg as text output", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>hello</text></svg>'
    await withFetch(
      async () =>
        new Response(svg, {
          status: 200,
          headers: { "content-type": "image/svg+xml; charset=UTF-8" },
        }),
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            const result = await webfetch.execute({ url: "https://example.com/image.svg", format: "html" }, ctx)
            expect(result.output).toContain("<svg")
            expect(result.attachments).toBeUndefined()
          },
        })
      },
    )
  })

  test("keeps text responses as text output", async () => {
    await withFetch(
      async () =>
        new Response("hello from webfetch", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            const result = await webfetch.execute({ url: "https://example.com/file.txt", format: "text" }, ctx)
            expect(result.output).toBe("hello from webfetch")
            expect(result.attachments).toBeUndefined()
          },
        })
      },
    )
  })
})

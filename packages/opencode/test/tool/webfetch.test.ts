import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Installation } from "../../src/installation"
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

  test("sends opencode user-agent by default instead of browser UA", async () => {
    let capturedUA = ""
    await withFetch(
      async (_input: string | URL | Request, init?: RequestInit) => {
        capturedUA = (init?.headers as Record<string, string>)?.["User-Agent"] ?? ""
        return new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      },
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            await webfetch.execute({ url: "https://example.com", format: "text" }, ctx)
            expect(capturedUA).toBe(Installation.USER_AGENT)
            expect(capturedUA).not.toContain("Mozilla")
            expect(capturedUA).toStartWith("opencode/")
          },
        })
      },
    )
  })

  test("retries with browser UA when Cloudflare blocks the request", async () => {
    let callCount = 0
    let retryUA = ""
    await withFetch(
      async (_input: string | URL | Request, init?: RequestInit) => {
        callCount++
        const ua = (init?.headers as Record<string, string>)?.["User-Agent"] ?? ""
        if (callCount === 1) {
          // First call: simulate Cloudflare bot detection block
          return new Response("Blocked", {
            status: 403,
            headers: { "cf-mitigated": "challenge" },
          })
        }
        // Second call: capture the retry UA and return success
        retryUA = ua
        return new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      },
      async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const webfetch = await WebFetchTool.init()
            await webfetch.execute({ url: "https://example.com", format: "text" }, ctx)
            expect(callCount).toBe(2)
            expect(retryUA).toContain("Mozilla")
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

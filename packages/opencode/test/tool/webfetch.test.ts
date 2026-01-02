import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { WebFetchTool } from "../../src/tool/webfetch"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.webfetch", () => {
  let server: ReturnType<typeof Bun.serve> | undefined
  let base = ""

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === "/binary") {
          const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x1b, 0x5b, 0x3c])
          return new Response(body, {
            headers: {
              "content-type": "image/png",
              "content-length": String(body.byteLength),
            },
          })
        }

        if (url.pathname === "/text") {
          return new Response("hello\u001b[31m world\u001b[0m\r\nok\u0000bad\n", {
            headers: {
              "content-type": "text/plain; charset=utf-8",
            },
          })
        }

        return new Response("not found", { status: 404 })
      },
    })
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(() => server?.stop())

  test("omits binary responses", async () => {
    const webfetch = await WebFetchTool.init()
    const result = await webfetch.execute(
      {
        url: `${base}/binary`,
        format: "markdown",
      },
      ctx,
    )

    expect(result.output).toContain("Binary response omitted")
    expect(result.output).toContain("image/png")
    expect(result.output).not.toContain("\u001b")
  })

  test("sanitizes control characters in text responses", async () => {
    const webfetch = await WebFetchTool.init()
    const result = await webfetch.execute(
      {
        url: `${base}/text`,
        format: "text",
      },
      ctx,
    )

    expect(result.output).toContain("hello world")
    expect(result.output).toContain("ok")
    expect(result.output).not.toContain("\u001b")
    expect(result.output).not.toContain("\r")
    expect(result.output).not.toContain("\u0000")
  })
})


import { describe, expect, mock, test } from "bun:test"
import path from "path"
import { FetchUrlTool } from "../../src/tool/fetchurl"
import { Instance } from "../../src/project/instance"

const tool = await FetchUrlTool.init()
const projectRoot = path.join(__dirname, "../..")

const baseCtx = () => {
  const controller = new AbortController()
  return {
    controller,
    ctx: {
      sessionID: "test",
      messageID: "",
      callID: "",
      agent: "build",
      abort: controller.signal,
      metadata: mock(() => {}),
    },
  }
}

const useFetch = (handler: (input: RequestInfo, init?: RequestInit) => Promise<Response>) => {
  const original = globalThis.fetch
  const stub = ((input: RequestInfo, init?: RequestInit) => handler(input, init)) as typeof fetch
  if (typeof original.preconnect === "function") {
    stub.preconnect = original.preconnect.bind(original)
  }
  globalThis.fetch = stub
  return () => {
    globalThis.fetch = original
  }
}

describe("tool.fetchurl", () => {
  test("formats html as markdown", async () => {
    const restore = useFetch(async () =>
      new Response("<html><body><main><h1>Hello</h1><p>World</p></main></body></html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      }),
    )
    const { ctx } = baseCtx()
    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const result = await tool.execute(
            {
              url: "https://example.com/page",
            },
            ctx,
          )
          expect(result.metadata["integration"]).toBe("generic")
          expect(String(result.metadata["content_type"]).includes("text/html")).toBe(true)
          expect(result.output).toContain("# Content from https://example.com/page")
          expect(result.output).toContain("# Hello")
        },
      })
    } finally {
      restore()
    }
  })

  test("converts json to markdown summary", async () => {
    const payload = { title: "Ticket", state: "Todo", description: "Investigate" }
    const restore = useFetch(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    )
    const { ctx } = baseCtx()
    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const result = await tool.execute(
            {
              url: "https://linear.app/api",
            },
            ctx,
          )
          expect(result.metadata["integration"]).toBe("linear")
          expect(result.output).toContain("# LINEAR Content")
          expect(result.output).toContain("## Ticket")
          expect(result.output).toContain("**State:** Todo")
        },
      })
    } finally {
      restore()
    }
  })

  test("respects text format preference", async () => {
    const restore = useFetch(async () =>
      new Response('{"message":"ok"}', {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    )
    const { ctx } = baseCtx()
    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const result = await tool.execute(
            {
              url: "https://api.example.com/data",
              format: "text",
            },
            ctx,
          )
          expect(result.output).toBe('{"message":"ok"}')
        },
      })
    } finally {
      restore()
    }
  })
})

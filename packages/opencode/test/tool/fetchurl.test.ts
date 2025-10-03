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

const toUrlString = (input: RequestInfo) => {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return input.url
}

const useFetch = (handler: (input: RequestInfo, init?: RequestInit) => Promise<Response>) => {
  const original = globalThis.fetch
  const stub = (async (input: RequestInfo, init?: RequestInit) => handler(input, init)) as typeof fetch
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

  test("follows redirects", async () => {
    const calls: string[] = []
    const restore = useFetch(async (input) => {
      const url = toUrlString(input)
      calls.push(url)
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: {
            location: "/final",
          },
        })
      }
      return new Response("done", {
        status: 200,
        headers: {
          "content-type": "text/plain",
        },
      })
    })
    const { ctx } = baseCtx()
    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const result = await tool.execute(
            {
              url: "https://example.com/start",
            },
            ctx,
          )
          expect(result.metadata["final_url"]).toBe("https://example.com/final")
          expect(result.output).toContain("done")
          expect(calls.length).toBe(2)
        },
      })
    } finally {
      restore()
    }
  })

  test("injects auth headers", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const restore = useFetch(async (input, init) => {
      const headers = init?.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : ((init?.headers ?? {}) as Record<string, string>)
      calls.push({ url: toUrlString(input), headers })
      return new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    })
    const { ctx } = baseCtx()
    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          await tool.execute(
            {
              url: "https://api.example.com/secure",
              auth_type: "header",
              auth_header_name: "X-API-Key",
              auth_token: "secret",
            },
            ctx,
          )
          expect(calls[0].headers["X-API-Key"]).toBe("secret")
        },
      })
    } finally {
      restore()
    }
  })

  test("appends auth query token", async () => {
    const calls: string[] = []
    const restore = useFetch(async (input) => {
      calls.push(toUrlString(input))
      return new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    })
    const { ctx } = baseCtx()
    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          await tool.execute(
            {
              url: "https://api.example.com/data",
              auth_type: "query",
              auth_query_param: "token",
              auth_token: "abc",
            },
            ctx,
          )
          const target = new URL(calls[0])
          expect(target.searchParams.get("token")).toBe("abc")
        },
      })
    } finally {
      restore()
    }
  })
})

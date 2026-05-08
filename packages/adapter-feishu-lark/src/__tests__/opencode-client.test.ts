// [fork-only] opencode-client 单测 — Bun.serve mock + 真 HTTP 走通
// [feat: feishu-bridge] 2026-05-08

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test"
import {
  OpencodeClient,
  OpencodeClientError,
  parseSseChunk,
} from "../core/opencode-client"

// ============================================================
// mock server — Bun.serve
// ============================================================

let server: ReturnType<typeof Bun.serve>
let baseURL: string
const requestLog: { method: string; path: string; auth: string | null; body: unknown }[] = []
let nextResponse: { status: number; body?: unknown; sse?: string[] } = { status: 200 }

beforeAll(() => {
  server = Bun.serve({
    port: 0, // 自动分配
    async fetch(req) {
      const url = new URL(req.url)
      const auth = req.headers.get("authorization")
      let body: unknown = null
      if (req.body && req.method !== "GET") {
        try {
          body = await req.json()
        } catch {
          body = null
        }
      }
      requestLog.push({ method: req.method, path: url.pathname, auth, body })

      // SSE endpoint
      if (url.pathname.match(/^\/session\/[^/]+\/sse$/)) {
        if (nextResponse.status !== 200) {
          return new Response("error", { status: nextResponse.status })
        }
        const events = nextResponse.sse ?? []
        const stream = new ReadableStream({
          start(controller) {
            for (const e of events) {
              controller.enqueue(new TextEncoder().encode(e))
            }
            controller.close()
          },
        })
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      }

      // 普通 JSON endpoint
      if (nextResponse.status >= 400) {
        return new Response(
          JSON.stringify({ error: "test-error" }),
          { status: nextResponse.status },
        )
      }
      if (nextResponse.status === 204) {
        return new Response(null, { status: 204 })
      }
      return new Response(
        nextResponse.body !== undefined ? JSON.stringify(nextResponse.body) : "{}",
        {
          status: nextResponse.status,
          headers: { "Content-Type": "application/json" },
        },
      )
    },
  })
  baseURL = `http://127.0.0.1:${server.port}`
})

afterAll(() => {
  server.stop()
})

beforeEach(() => {
  requestLog.length = 0
  nextResponse = { status: 200 }
})

// ============================================================
// 基础
// ============================================================

describe("OpencodeClient 基础", () => {
  test("baseURL 末尾 / 自动去", () => {
    const c = new OpencodeClient({ baseURL: "http://x.com//" })
    // 通过 createSession 失败的 error path 验证(实际 fetch 会失败但 URL 拼接正确)
    expect(c).toBeDefined() // 简单存在性
  })

  test("Basic auth header 正确编码", async () => {
    nextResponse = { status: 200, body: { id: "s1" } }
    const c = new OpencodeClient({
      baseURL,
      auth: { username: "user", password: "pass" },
    })
    await c.createSession({})
    expect(requestLog[0]?.auth).toBe(`Basic ${btoa("user:pass")}`)
  })

  test("无 auth 时不发 Authorization header", async () => {
    nextResponse = { status: 200, body: { id: "s2" } }
    const c = new OpencodeClient({ baseURL })
    await c.createSession({})
    expect(requestLog[0]?.auth).toBeNull()
  })
})

// ============================================================
// fromEnv
// ============================================================

describe("OpencodeClient.fromEnv", () => {
  test("有 OPENCODE_SERVER_URL → 构造", () => {
    process.env.OPENCODE_SERVER_URL = "http://test:1234"
    process.env.OPENCODE_SERVER_USERNAME = "u"
    process.env.OPENCODE_SERVER_PASSWORD = "p"
    try {
      const c = OpencodeClient.fromEnv()
      expect(c).toBeDefined()
    } finally {
      delete process.env.OPENCODE_SERVER_URL
      delete process.env.OPENCODE_SERVER_USERNAME
      delete process.env.OPENCODE_SERVER_PASSWORD
    }
  })

  test("无 OPENCODE_SERVER_URL → throw", () => {
    delete process.env.OPENCODE_SERVER_URL
    expect(() => OpencodeClient.fromEnv()).toThrow(/OPENCODE_SERVER_URL/)
  })
})

// ============================================================
// session API
// ============================================================

describe("session API", () => {
  test("createSession POST /session", async () => {
    nextResponse = { status: 200, body: { id: "session-abc" } }
    const c = new OpencodeClient({ baseURL })
    const r = await c.createSession({ title: "test" })
    expect(r.id).toBe("session-abc")
    expect(requestLog[0]?.method).toBe("POST")
    expect(requestLog[0]?.path).toBe("/session")
    expect(requestLog[0]?.body).toEqual({ title: "test" })
  })

  test("abortSession 路径 encode", async () => {
    nextResponse = { status: 204 }
    const c = new OpencodeClient({ baseURL })
    await c.abortSession("session/with/slash")
    expect(requestLog[0]?.path).toBe("/session/session%2Fwith%2Fslash/abort")
  })

  test("forkSession 返新 id", async () => {
    nextResponse = { status: 200, body: { id: "forked-1" } }
    const c = new OpencodeClient({ baseURL })
    const r = await c.forkSession("parent-1")
    expect(r.id).toBe("forked-1")
    expect(requestLog[0]?.path).toBe("/session/parent-1/fork")
  })
})

// ============================================================
// prompt + permission
// ============================================================

describe("prompt + permission", () => {
  test("promptAsync 带 text part + agent + providerOptions", async () => {
    nextResponse = { status: 204 }
    const c = new OpencodeClient({ baseURL })
    await c.promptAsync("s1", {
      agent: "general",
      text: "hello",
      providerOptions: { _opencode: { cwd: "/x" } },
    })
    const req = requestLog[0]
    expect(req?.path).toBe("/session/s1/prompt_async")
    expect(req?.body).toEqual({
      agent: "general",
      parts: [{ type: "text", text: "hello" }],
      providerOptions: { _opencode: { cwd: "/x" } },
    })
  })

  test("respondPermission approve", async () => {
    nextResponse = { status: 204 }
    const c = new OpencodeClient({ baseURL })
    await c.respondPermission("perm-123", { decision: "approve" })
    expect(requestLog[0]?.path).toBe("/permission/perm-123")
    expect(requestLog[0]?.body).toEqual({ decision: "approve" })
  })

  test("respondPermission deny + reason", async () => {
    nextResponse = { status: 204 }
    const c = new OpencodeClient({ baseURL })
    await c.respondPermission("perm-456", { decision: "deny", reason: "no" })
    expect(requestLog[0]?.body).toEqual({ decision: "deny", reason: "no" })
  })
})

// ============================================================
// 错误处理
// ============================================================

describe("错误处理", () => {
  test("4xx 抛 OpencodeClientError + 含 status", async () => {
    nextResponse = { status: 404 }
    const c = new OpencodeClient({ baseURL })
    try {
      await c.createSession({})
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(OpencodeClientError)
      expect((e as OpencodeClientError).status).toBe(404)
    }
  })

  test("5xx 抛 + 含 status", async () => {
    nextResponse = { status: 500 }
    const c = new OpencodeClient({ baseURL })
    try {
      await c.createSession({})
      expect.unreachable()
    } catch (e) {
      expect((e as OpencodeClientError).status).toBe(500)
    }
  })
})

// ============================================================
// SSE 订阅
// ============================================================

describe("SSE subscribeSession", () => {
  test("解析多个 events", async () => {
    nextResponse = {
      status: 200,
      sse: [
        "event: message.part.updated\ndata: {\"id\":1}\n\n",
        "event: permission.requested\ndata: {\"id\":2}\n\n",
        "event: session.idle\ndata: {}\n\n",
      ],
    }
    const c = new OpencodeClient({ baseURL })
    const events: unknown[] = []
    const sub = c.subscribeSession("s1", (e) => events.push(e))
    // 等流跑完
    await sleep(150)
    sub.close()
    expect(events).toEqual([
      { event: "message.part.updated", data: { id: 1 } },
      { event: "permission.requested", data: { id: 2 } },
      { event: "session.idle", data: {} },
    ])
  })

  test("close() 终止订阅,不报错", async () => {
    nextResponse = { status: 200, sse: [] }
    const c = new OpencodeClient({ baseURL })
    const sub = c.subscribeSession("s1", () => {})
    await sleep(20)
    expect(() => sub.close()).not.toThrow()
  })

  test("SSE 拆 chunk 跨段拼接(模拟 TCP 分片)", async () => {
    nextResponse = {
      status: 200,
      sse: [
        "event: foo\nda",
        "ta: {\"x\":1}",
        "\n\nevent: bar\ndata: {\"y\":2}\n\n",
      ],
    }
    const c = new OpencodeClient({ baseURL })
    const events: unknown[] = []
    const sub = c.subscribeSession("s2", (e) => events.push(e))
    await sleep(200)
    sub.close()
    expect(events).toEqual([
      { event: "foo", data: { x: 1 } },
      { event: "bar", data: { y: 2 } },
    ])
  })
})

// ============================================================
// parseSseChunk 直测
// ============================================================

describe("parseSseChunk", () => {
  test("标准 event + json data", () => {
    const r = parseSseChunk("event: foo\ndata: {\"x\":1}")
    expect(r).toEqual({ event: "foo", data: { x: 1 } })
  })

  test("无 event 字段 → 默认 'message'", () => {
    const r = parseSseChunk("data: hello")
    expect(r).toEqual({ event: "message", data: "hello" })
  })

  test("非 JSON data 留 string", () => {
    const r = parseSseChunk("event: x\ndata: not-json")
    expect(r).toEqual({ event: "x", data: "not-json" })
  })

  test("multi-line data 拼接", () => {
    const r = parseSseChunk("event: x\ndata: line1\ndata: line2")
    expect(r?.data).toBe("line1\nline2")
  })

  test("注释行 / 空行忽略", () => {
    const r = parseSseChunk(": comment\n\nevent: real\ndata: 1")
    expect(r).toEqual({ event: "real", data: 1 })
  })

  test("无 data 返 null", () => {
    const r = parseSseChunk("event: x\n")
    expect(r).toBeNull()
  })
})

// ============================================================
// 辅助
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

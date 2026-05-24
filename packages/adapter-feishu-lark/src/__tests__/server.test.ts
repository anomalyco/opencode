// [fork-only] localhost server 单测
// [feat: feishu-bridge] 2026-05-08

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { startServer } from "../server"

// ============================================================
// mock fetch — 拦截所有 oauth 下游调用
// ============================================================

type Resp = { status: number; body: unknown }

function makeOauthMock(plan: Resp[]) {
  let i = 0
  const calls: { url: string; body: string }[] = []
  const fn = (async (input: string | Request | URL, init?: RequestInit) => {
    const r = plan[Math.min(i, plan.length - 1)]!
    i++
    calls.push({ url: String(input), body: String(init?.body ?? "") })
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof globalThis.fetch
  return { fn, calls, getIndex: () => i }
}

// ============================================================
// 启动 / 健康检查 / auth
// ============================================================

let h: ReturnType<typeof startServer>
let username = "test-u"
let password = "test-p"
let authHeader: string

beforeEach(() => {
  authHeader = `Basic ${btoa(`${username}:${password}`)}`
  h = startServer({
    username,
    password,
    gcIntervalMs: 1_000_000, // 测试期不 GC
    onReady: () => {}, // 静默
  })
})

afterEach(() => {
  h?.stop()
})

describe("server 启动", () => {
  test("ready 数据完整", () => {
    expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(h.port).toBeGreaterThan(0)
    expect(h.ready.username).toBe("test-u")
    expect(h.ready.password).toBe("test-p")
  })

  test("GET /healthz → ok(无需 auth)", async () => {
    const r = await fetch(`${h.url}/healthz`)
    expect(r.status).toBe(200)
    expect(await r.text()).toBe("ok")
  })

  test("404 路径", async () => {
    const r = await fetch(`${h.url}/nonexistent`, {
      headers: { Authorization: authHeader },
    })
    expect(r.status).toBe(404)
  })

  test("无 auth → 401", async () => {
    const r = await fetch(`${h.url}/oauth/start`, {
      method: "POST",
      body: JSON.stringify({ domain: "feishu" }),
    })
    expect(r.status).toBe(401)
  })

  test("错误 auth → 401", async () => {
    const r = await fetch(`${h.url}/oauth/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic wrong-token",
      },
      body: JSON.stringify({ domain: "feishu" }),
    })
    expect(r.status).toBe(401)
  })
})

// ============================================================
// /oauth/start
// ============================================================

describe("POST /oauth/start", () => {
  test("成功:init + begin → sessionId + DeviceCodeResponse", async () => {
    h.stop()
    const m = makeOauthMock([
      { status: 200, body: { nonce: "n1", supported_auth_methods: ["client_secret"] } },
      {
        status: 200,
        body: {
          device_code: "dev_xxx",
          user_code: "U-CODE",
          verification_uri: "https://open.feishu.cn/page/launcher",
          verification_uri_complete: "https://open.feishu.cn/page/launcher?u=U-CODE",
          expires_in: 3600,
          interval: 5,
        },
      },
    ])
    h = startServer({ username, password, oauthFetchImpl: m.fn, onReady: () => {} })

    const r = await fetch(`${h.url}/oauth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ domain: "feishu" }),
    })
    expect(r.status).toBe(200)
    const json = (await r.json()) as Record<string, unknown>
    expect(json.sessionId).toBeDefined()
    expect(json.deviceCode).toBe("dev_xxx")
    expect(json.userCode).toBe("U-CODE")
    expect(json.verificationUri).toBe("https://open.feishu.cn/page/launcher")
  })

  test("Lark 域名 → larksuite.com endpoint", async () => {
    h.stop()
    const m = makeOauthMock([
      { status: 200, body: { nonce: "n1" } },
      {
        status: 200,
        body: {
          device_code: "d",
          user_code: "u",
          verification_uri: "https://x",
          expires_in: 3600,
          interval: 5,
        },
      },
    ])
    h = startServer({ username, password, oauthFetchImpl: m.fn, onReady: () => {} })

    await fetch(`${h.url}/oauth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ domain: "lark" }),
    })
    expect(m.calls.length).toBe(2)
    expect(m.calls[0]?.url).toContain("larksuite.com")
  })

  test("非法 domain → 400 invalid_domain", async () => {
    const r = await fetch(`${h.url}/oauth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ domain: "wechat" }),
    })
    expect(r.status).toBe(400)
    const json = (await r.json()) as { error: string }
    expect(json.error).toBe("invalid_domain")
  })

  test("非 JSON body → 400 invalid_json", async () => {
    const r = await fetch(`${h.url}/oauth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: "not-a-json",
    })
    expect(r.status).toBe(400)
    const json = (await r.json()) as { error: string }
    expect(json.error).toBe("invalid_json")
  })

  test("init 失败 → 502 oauth_start_failed", async () => {
    h.stop()
    const m = makeOauthMock([{ status: 500, body: { error: "server_error" } }])
    h = startServer({ username, password, oauthFetchImpl: m.fn, onReady: () => {} })

    const r = await fetch(`${h.url}/oauth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ domain: "feishu" }),
    })
    expect(r.status).toBe(502)
    const json = (await r.json()) as { error: string }
    expect(json.error).toBe("oauth_start_failed")
  })
})

// ============================================================
// /oauth/poll
// ============================================================

describe("POST /oauth/poll", () => {
  async function startSession(m: ReturnType<typeof makeOauthMock>): Promise<string> {
    const r = await fetch(`${h.url}/oauth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ domain: "feishu" }),
    })
    const json = (await r.json()) as { sessionId: string }
    return json.sessionId
  }

  test("session 不存在 → 404", async () => {
    const r = await fetch(`${h.url}/oauth/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ sessionId: "nonexistent" }),
    })
    expect(r.status).toBe(404)
    const json = (await r.json()) as { error: string }
    expect(json.error).toBe("session_not_found")
  })

  test("缺 sessionId → 400", async () => {
    const r = await fetch(`${h.url}/oauth/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({}),
    })
    expect(r.status).toBe(400)
  })

  test("pending → 透传", async () => {
    h.stop()
    const m = makeOauthMock([
      { status: 200, body: { nonce: "n" } },
      {
        status: 200,
        body: {
          device_code: "d",
          user_code: "u",
          verification_uri: "https://x",
          expires_in: 3600,
          interval: 5,
        },
      },
      { status: 200, body: { error: "authorization_pending" } },
    ])
    h = startServer({ username, password, oauthFetchImpl: m.fn, onReady: () => {} })

    const sid = await startSession(m)
    const r = await fetch(`${h.url}/oauth/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ sessionId: sid }),
    })
    expect(r.status).toBe(200)
    const json = (await r.json()) as { status: string }
    expect(json.status).toBe("pending")
  })

  test("success → 透传 + session 清理", async () => {
    h.stop()
    const m = makeOauthMock([
      { status: 200, body: { nonce: "n" } },
      {
        status: 200,
        body: {
          device_code: "d",
          user_code: "u",
          verification_uri: "https://x",
          expires_in: 3600,
          interval: 5,
        },
      },
      {
        status: 200,
        body: {
          app_id: "cli_a",
          app_secret: "sec_a",
          open_id: "ou_a",
        },
      },
      // 二次 poll 应 404(session 已清)
    ])
    h = startServer({ username, password, oauthFetchImpl: m.fn, onReady: () => {} })

    const sid = await startSession(m)
    const r1 = await fetch(`${h.url}/oauth/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ sessionId: sid }),
    })
    const json1 = (await r1.json()) as { status: string; appId: string }
    expect(json1.status).toBe("success")
    expect(json1.appId).toBe("cli_a")

    // 二次 poll → 404(session 已清)
    const r2 = await fetch(`${h.url}/oauth/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ sessionId: sid }),
    })
    expect(r2.status).toBe(404)
  })

  test("session 超时(expiresIn 模拟极短)→ expired + session 清理", async () => {
    h.stop()
    const m = makeOauthMock([
      { status: 200, body: { nonce: "n" } },
      {
        status: 200,
        body: {
          device_code: "d",
          user_code: "u",
          verification_uri: "https://x",
          expires_in: 0, // 立刻过期
          interval: 5,
        },
      },
    ])
    h = startServer({ username, password, oauthFetchImpl: m.fn, onReady: () => {} })

    const sid = await startSession(m)
    // 等 10ms 让 0 秒 expiresIn 过期判断生效
    await new Promise((r) => setTimeout(r, 10))
    const r = await fetch(`${h.url}/oauth/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ sessionId: sid }),
    })
    expect(r.status).toBe(200)
    const json = (await r.json()) as { status: string }
    expect(json.status).toBe("expired")
  })
})

// ============================================================
// onReady callback
// ============================================================

describe("onReady callback", () => {
  test("被调一次 + 含 url/username/password", () => {
    h.stop()
    let captured: unknown = null
    h = startServer({
      username,
      password,
      onReady: (info) => {
        captured = info
      },
    })
    expect(captured).toEqual({
      url: h.url,
      username: "test-u",
      password: "test-p",
    })
  })

  test("无 onReady 走 console.log(默认行为不报)", () => {
    h.stop()
    // 静默 console.log 防止污染输出
    const orig = console.log
    let captured = ""
    console.log = (...args: unknown[]) => {
      captured = args.map(String).join(" ")
    }
    try {
      h = startServer({ username, password })
      expect(captured.length).toBeGreaterThan(0)
      expect(captured).toContain("127.0.0.1")
    } finally {
      console.log = orig
    }
  })
})


// ============================================================
// 随机端口 + 默认随机 password
// ============================================================

describe("默认值", () => {
  test("默认 username = deskfox", () => {
    h.stop()
    h = startServer({ password: "p", onReady: () => {} })
    expect(h.ready.username).toBe("deskfox")
    expect(h.ready.password).toBe("p")
  })

  test("默认随机 password 长度 ≥ 24 hex", () => {
    h.stop()
    h = startServer({ onReady: () => {} })
    expect(h.ready.password.length).toBeGreaterThanOrEqual(24)
    expect(h.ready.password).toMatch(/^[0-9a-f]+$/)
  })
})

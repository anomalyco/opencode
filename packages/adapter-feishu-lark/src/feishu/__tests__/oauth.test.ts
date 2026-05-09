// [fork-only] OAuth Device Flow 单测 — mock fetch 模拟飞书响应
// [feat: feishu-bridge] 2026-05-08
//
// 覆盖三步骤(init / begin / poll)+ 错误码映射 + 字段名兼容(snake/camel/data wrap)。

import { describe, expect, test } from "bun:test"
import {
  init,
  begin,
  poll,
  endpointFor,
  OauthError,
  type DeviceCodeResponse,
  type PollResult,
} from "../oauth"

// ============================================================
// mock fetch helper
// ============================================================

type Resp = { status: number; body: unknown }

function mockFetch(plan: Resp | Resp[]) {
  const list = Array.isArray(plan) ? plan : [plan]
  let i = 0
  const calls: { url: string; body: string }[] = []
  const fn = async (url: string, init: RequestInit) => {
    const r = list[Math.min(i, list.length - 1)]!
    i++
    calls.push({ url, body: String(init.body ?? "") })
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    })
  }
  return { fn, calls }
}

// ============================================================
// endpointFor
// ============================================================

describe("endpointFor", () => {
  test("feishu → accounts.feishu.cn", () => {
    expect(endpointFor("feishu")).toBe("https://accounts.feishu.cn")
  })
  test("lark → accounts.larksuite.com", () => {
    expect(endpointFor("lark")).toBe("https://accounts.larksuite.com")
  })
})

// ============================================================
// init
// ============================================================

describe("init", () => {
  test("成功 → nonce + supportedAuthMethods", async () => {
    const m = mockFetch({
      status: 200,
      body: { nonce: "v1:eyJxxx", supported_auth_methods: ["client_secret"] },
    })
    const r = await init("feishu", { fetchImpl: m.fn })
    expect(r.nonce).toBe("v1:eyJxxx")
    expect(r.supportedAuthMethods).toEqual(["client_secret"])
    expect(m.calls[0]?.url).toBe("https://accounts.feishu.cn/oauth/v1/app/registration")
    expect(m.calls[0]?.body).toContain("action=init")
  })

  test("Lark 域名走 larksuite.com", async () => {
    const m = mockFetch({ status: 200, body: { nonce: "x" } })
    await init("lark", { fetchImpl: m.fn })
    expect(m.calls[0]?.url).toBe("https://accounts.larksuite.com/oauth/v1/app/registration")
  })

  test("supportedAuthMethods 缺失 → 默认空数组", async () => {
    const m = mockFetch({ status: 200, body: { nonce: "x" } })
    const r = await init("feishu", { fetchImpl: m.fn })
    expect(r.supportedAuthMethods).toEqual([])
  })

  test("nonce 缺失 → throw", async () => {
    const m = mockFetch({ status: 200, body: { supported_auth_methods: [] } })
    await expect(init("feishu", { fetchImpl: m.fn })).rejects.toThrow(/nonce/)
  })

  test("非 200 → throw 含 status", async () => {
    const m = mockFetch({ status: 500, body: { error: "server_error" } })
    await expect(init("feishu", { fetchImpl: m.fn })).rejects.toThrow(/HTTP 500/)
  })

  test("data wrap 兼容(飞书可能 data 嵌套)", async () => {
    const m = mockFetch({
      status: 200,
      body: { code: 0, data: { nonce: "wrapped", supported_auth_methods: ["x"] } },
    })
    const r = await init("feishu", { fetchImpl: m.fn })
    expect(r.nonce).toBe("wrapped")
    expect(r.supportedAuthMethods).toEqual(["x"])
  })
})

// ============================================================
// begin
// ============================================================

describe("begin", () => {
  const validBody = {
    device_code: "v1:dev_xxx",
    user_code: "R5U9-P8GC",
    verification_uri: "https://open.feishu.cn/page/launcher",
    verification_uri_complete: "https://open.feishu.cn/page/launcher?user_code=R5U9-P8GC",
    expires_in: 3600,
    interval: 5,
  }

  test("成功 → DeviceCodeResponse 字段全", async () => {
    const m = mockFetch({ status: 200, body: validBody })
    const r = await begin("feishu", "v1:nonce_xxx", { fetchImpl: m.fn })
    expect(r.deviceCode).toBe("v1:dev_xxx")
    expect(r.userCode).toBe("R5U9-P8GC")
    expect(r.verificationUri).toBe("https://open.feishu.cn/page/launcher")
    expect(r.verificationUriComplete).toContain("user_code=R5U9-P8GC")
    expect(r.expiresIn).toBe(3600)
    expect(r.interval).toBe(5)
  })

  test("提交 form 含 archetype + auth_method + nonce", async () => {
    const m = mockFetch({ status: 200, body: validBody })
    await begin("feishu", "the-nonce", { fetchImpl: m.fn })
    const sent = m.calls[0]!.body
    expect(sent).toContain("action=begin")
    expect(sent).toContain("archetype=PersonalAgent")
    expect(sent).toContain("auth_method=client_secret")
    expect(sent).toContain("request_user_info=open_id")
    expect(sent).toContain("nonce=the-nonce")
  })

  test("verification_uri_complete 缺 → 用 verification_uri + user_code 拼", async () => {
    const m = mockFetch({
      status: 200,
      body: { ...validBody, verification_uri_complete: undefined },
    })
    const r = await begin("feishu", "n", { fetchImpl: m.fn })
    expect(r.verificationUriComplete).toBe(
      "https://open.feishu.cn/page/launcher?user_code=R5U9-P8GC",
    )
  })

  test("expires_in / interval 缺 → 用默认 3600 / 5", async () => {
    const m = mockFetch({
      status: 200,
      body: {
        device_code: "d",
        user_code: "u",
        verification_uri: "https://x",
      },
    })
    const r = await begin("feishu", "n", { fetchImpl: m.fn })
    expect(r.expiresIn).toBe(3600)
    expect(r.interval).toBe(5)
  })

  test("缺 device_code → throw", async () => {
    const m = mockFetch({ status: 200, body: { user_code: "u", verification_uri: "v" } })
    await expect(begin("feishu", "n", { fetchImpl: m.fn })).rejects.toThrow(/缺关键字段/)
  })

  test("缺 verification_uri → throw", async () => {
    const m = mockFetch({ status: 200, body: { device_code: "d", user_code: "u" } })
    await expect(begin("feishu", "n", { fetchImpl: m.fn })).rejects.toThrow(/缺关键字段/)
  })

  test("非 200 → throw 含 status", async () => {
    const m = mockFetch({ status: 400, body: { error: "invalid_request" } })
    await expect(begin("feishu", "n", { fetchImpl: m.fn })).rejects.toThrow(/HTTP 400/)
  })

  test("camelCase 字段名兼容", async () => {
    const m = mockFetch({
      status: 200,
      body: {
        deviceCode: "d",
        userCode: "U",
        verificationUri: "https://x",
        verificationUriComplete: "https://x?u=U",
        expiresIn: 7200,
        interval: 10,
      },
    })
    const r = await begin("feishu", "n", { fetchImpl: m.fn })
    expect(r.deviceCode).toBe("d")
    expect(r.expiresIn).toBe(7200)
    expect(r.interval).toBe(10)
  })

  test("Lark 域名 → larksuite.com endpoint", async () => {
    const m = mockFetch({ status: 200, body: validBody })
    await begin("lark", "n", { fetchImpl: m.fn })
    expect(m.calls[0]?.url).toBe("https://accounts.larksuite.com/oauth/v1/app/registration")
  })
})

// ============================================================
// poll
// ============================================================

describe("poll", () => {
  test("success → 返 appId/appSecret/openId", async () => {
    const m = mockFetch({
      status: 200,
      body: {
        app_id: "cli_xxx",
        app_secret: "sec_xxx",
        open_id: "ou_xxx",
        access_token: "tok_xxx",
        refresh_token: "ref_xxx",
        expires_in: 7200,
      },
    })
    const r = await poll("feishu", "device-code", "nonce", { fetchImpl: m.fn })
    expect(r.status).toBe("success")
    if (r.status === "success") {
      expect(r.appId).toBe("cli_xxx")
      expect(r.appSecret).toBe("sec_xxx")
      expect(r.openId).toBe("ou_xxx")
      expect(r.accessToken).toBe("tok_xxx")
      expect(r.expiresIn).toBe(7200)
    }
  })

  test("authorization_pending → pending", async () => {
    const m = mockFetch({ status: 200, body: { error: "authorization_pending" } })
    const r = await poll("feishu", "d", "n", { fetchImpl: m.fn })
    expect(r.status).toBe("pending")
  })

  test("slow_down → slow_down", async () => {
    const m = mockFetch({ status: 200, body: { error: "slow_down" } })
    const r = await poll("feishu", "d", "n", { fetchImpl: m.fn })
    expect(r.status).toBe("slow_down")
  })

  test("access_denied → denied + 含 message", async () => {
    const m = mockFetch({
      status: 200,
      body: { error: "access_denied", error_description: "user rejected" },
    })
    const r = await poll("feishu", "d", "n", { fetchImpl: m.fn })
    expect(r.status).toBe("denied")
    if (r.status === "denied") expect(r.message).toBe("user rejected")
  })

  test("expired_token → expired", async () => {
    const m = mockFetch({ status: 200, body: { error: "expired_token" } })
    const r = await poll("feishu", "d", "n", { fetchImpl: m.fn })
    expect(r.status).toBe("expired")
  })

  test("未知 error code → error 含原 code", async () => {
    const m = mockFetch({ status: 400, body: { error: "weird_error_xyz", message: "huh" } })
    const r = await poll("feishu", "d", "n", { fetchImpl: m.fn })
    expect(r.status).toBe("error")
    if (r.status === "error") {
      expect(r.code).toBe("weird_error_xyz")
      expect(r.message).toBe("huh")
    }
  })

  test("无 error 字段 + 200 但凭证缺 → 视作 pending", async () => {
    const m = mockFetch({ status: 200, body: { code: 102, msg: "not yet" } })
    const r = await poll("feishu", "d", "n", { fetchImpl: m.fn })
    expect(r.status).toBe("pending")
  })

  test("非 200 + 无 error 字段 → error 含 http_status code", async () => {
    const m = mockFetch({ status: 503, body: "service unavailable" })
    const r = await poll("feishu", "d", "n", { fetchImpl: m.fn })
    expect(r.status).toBe("error")
    if (r.status === "error") expect(r.code).toBe("http_503")
  })

  test("camelCase 字段兼容 success", async () => {
    const m = mockFetch({
      status: 200,
      body: { appId: "a", appSecret: "s", openId: "o" },
    })
    const r = await poll("feishu", "d", "n", { fetchImpl: m.fn })
    expect(r.status).toBe("success")
    if (r.status === "success") expect(r.appId).toBe("a")
  })

  test("data wrap 兼容 success", async () => {
    const m = mockFetch({
      status: 200,
      body: {
        code: 0,
        data: { app_id: "wa", app_secret: "ws", open_id: "wo" },
      },
    })
    const r = await poll("feishu", "d", "n", { fetchImpl: m.fn })
    expect(r.status).toBe("success")
    if (r.status === "success") expect(r.appId).toBe("wa")
  })

  test("飞书真实响应:client_id/client_secret + user_info.open_id 嵌套", async () => {
    // 这是 OpenClaw install-prompts.js 处理的真实 PollResponse 形状
    const m = mockFetch({
      status: 200,
      body: {
        client_id: "cli_real",
        client_secret: "sec_real",
        user_info: {
          open_id: "ou_real",
          tenant_brand: "feishu",
        },
      },
    })
    const r = await poll("feishu", "d", "n", { fetchImpl: m.fn })
    expect(r.status).toBe("success")
    if (r.status === "success") {
      expect(r.appId).toBe("cli_real")
      expect(r.appSecret).toBe("sec_real")
      expect(r.openId).toBe("ou_real")
    }
  })

  test("飞书真实响应:open_id 缺失也算 success(best-effort)", async () => {
    const m = mockFetch({
      status: 200,
      body: {
        client_id: "cli_only",
        client_secret: "sec_only",
        // 没 user_info 也没 open_id
      },
    })
    const r = await poll("feishu", "d", "n", { fetchImpl: m.fn })
    expect(r.status).toBe("success")
    if (r.status === "success") {
      expect(r.appId).toBe("cli_only")
      expect(r.openId).toBe("")
    }
  })

  test("提交 form 含 device_code + nonce + action=poll", async () => {
    const m = mockFetch({ status: 200, body: { error: "authorization_pending" } })
    await poll("feishu", "the-device-code", "the-nonce", { fetchImpl: m.fn })
    const sent = m.calls[0]!.body
    expect(sent).toContain("action=poll")
    expect(sent).toContain("device_code=the-device-code")
    expect(sent).toContain("nonce=the-nonce")
  })

  test("alternate error key error_code 兼容", async () => {
    const m = mockFetch({ status: 200, body: { error_code: "authorization_pending" } })
    const r = await poll("feishu", "d", "n", { fetchImpl: m.fn })
    expect(r.status).toBe("pending")
  })
})

// ============================================================
// 综合 happy path
// ============================================================

describe("综合 happy path", () => {
  test("init + begin + poll(pending → success)三段连跑", async () => {
    // mock 4 次响应:init / begin / poll(pending) / poll(success)
    const m = mockFetch([
      { status: 200, body: { nonce: "n1", supported_auth_methods: ["client_secret"] } },
      {
        status: 200,
        body: {
          device_code: "dev",
          user_code: "U-CODE",
          verification_uri: "https://open.feishu.cn/page/launcher",
          expires_in: 3600,
          interval: 5,
        },
      },
      { status: 200, body: { error: "authorization_pending" } },
      {
        status: 200,
        body: {
          app_id: "cli_a",
          app_secret: "sec_a",
          open_id: "ou_a",
        },
      },
    ])

    const r1 = await init("feishu", { fetchImpl: m.fn })
    const r2 = await begin("feishu", r1.nonce, { fetchImpl: m.fn })
    const r3 = await poll("feishu", r2.deviceCode, r1.nonce, { fetchImpl: m.fn })
    expect(r3.status).toBe("pending")
    const r4 = await poll("feishu", r2.deviceCode, r1.nonce, { fetchImpl: m.fn })
    expect(r4.status).toBe("success")
    if (r4.status === "success") {
      expect(r4.appId).toBe("cli_a")
      expect(r4.openId).toBe("ou_a")
    }
    expect(m.calls.length).toBe(4)
  })
})

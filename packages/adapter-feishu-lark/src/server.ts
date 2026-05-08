// [fork-only] adapter-feishu-lark localhost HTTP server
// [feat: feishu-bridge] 2026-05-08
//
// 由 Tauri 主进程 spawn 此 adapter sidecar 后调用。绑随机端口 + 随机 Basic auth
// token,把 ServerReadyData 一行 JSON 打到 stdout(跟 opencode-cli 同模式):
//   {"url": "http://127.0.0.1:54321", "username": "...", "password": "..."}
//
// 路由(MVP):
//   GET  /healthz                — liveness
//   POST /oauth/start             body {domain} → 内部 init+begin → {sessionId, deviceCode...}
//   POST /oauth/poll              body {sessionId} → 用内存 stash 调 poll → PollResult
//
// session 5 分钟自动 GC(超 expiresIn)。process 结束时 server.stop()。

import {
  begin as oauthBegin,
  init as oauthInit,
  poll as oauthPoll,
  type DeviceCodeResponse,
  type FeishuDomain,
  type PollResult,
} from "./feishu/oauth"

// ============================================================
// 类型
// ============================================================

export interface ServerReadyData {
  url: string
  username: string
  password: string
}

export interface ServerOptions {
  /** 绑定端口,0 = 随机 */
  port?: number
  /** Basic auth 凭证;省 = 随机生成 */
  username?: string
  password?: string
  /** session GC 周期(ms),省 = 60_000 */
  gcIntervalMs?: number
  /** 测试用:打 ServerReadyData 到自定义 logger,默认 console.log */
  onReady?: (info: ServerReadyData) => void
  /** 测试用:fetchImpl 注入下游 OAuth 调用 */
  oauthFetchImpl?: typeof globalThis.fetch
}

interface ServerHandle {
  url: string
  port: number
  ready: ServerReadyData
  stop: () => void
}

interface OauthSession {
  domain: FeishuDomain
  deviceCode: string
  nonce: string
  /** 创建时间(ms epoch),GC 用 */
  createdAt: number
  /** expiresIn(ms),用于判断是否过期 */
  expiresInMs: number
}

// ============================================================
// 工具
// ============================================================

function randomToken(len = 24): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

function randomSessionId(): string {
  return randomToken(16)
}

function checkAuth(req: Request, expected: string): boolean {
  const got = req.headers.get("authorization")
  return got === expected
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

// ============================================================
// public API
// ============================================================

export function startServer(options: ServerOptions = {}): ServerHandle {
  const username = options.username ?? "deskfox"
  const password = options.password ?? randomToken()
  const authHeader = `Basic ${btoa(`${username}:${password}`)}`
  const sessions = new Map<string, OauthSession>()

  const oauthOpts = options.oauthFetchImpl
    ? { fetchImpl: options.oauthFetchImpl }
    : {}

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url)

    // GET /healthz — liveness 检查,无需 auth
    if (req.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok", { status: 200 })
    }

    if (!checkAuth(req, authHeader)) {
      return jsonResponse({ error: "unauthorized" }, 401)
    }

    if (req.method === "POST" && url.pathname === "/oauth/start") {
      let body: { domain?: string }
      try {
        body = (await req.json()) as { domain?: string }
      } catch {
        return jsonResponse({ error: "invalid_json" }, 400)
      }
      if (body.domain !== "feishu" && body.domain !== "lark") {
        return jsonResponse({ error: "invalid_domain", message: "domain must be feishu|lark" }, 400)
      }
      try {
        const initRes = await oauthInit(body.domain, oauthOpts)
        const beginRes = await oauthBegin(body.domain, initRes.nonce, oauthOpts)
        const sessionId = randomSessionId()
        sessions.set(sessionId, {
          domain: body.domain,
          deviceCode: beginRes.deviceCode,
          nonce: initRes.nonce,
          createdAt: Date.now(),
          expiresInMs: beginRes.expiresIn * 1000,
        })
        const payload: { sessionId: string } & DeviceCodeResponse = {
          sessionId,
          ...beginRes,
        }
        return jsonResponse(payload, 200)
      } catch (err) {
        return jsonResponse(
          { error: "oauth_start_failed", message: (err as Error).message },
          502,
        )
      }
    }

    if (req.method === "POST" && url.pathname === "/oauth/poll") {
      let body: { sessionId?: string }
      try {
        body = (await req.json()) as { sessionId?: string }
      } catch {
        return jsonResponse({ error: "invalid_json" }, 400)
      }
      const sessionId = body.sessionId
      if (!sessionId) {
        return jsonResponse({ error: "missing_session_id" }, 400)
      }
      const sess = sessions.get(sessionId)
      if (!sess) {
        return jsonResponse({ error: "session_not_found" }, 404)
      }
      if (Date.now() - sess.createdAt > sess.expiresInMs) {
        sessions.delete(sessionId)
        const expired: PollResult = { status: "expired", message: "device_code 已过期" }
        return jsonResponse(expired, 200)
      }
      try {
        const r = await oauthPoll(sess.domain, sess.deviceCode, sess.nonce, oauthOpts)
        // success / denied / expired 终态:清理 session
        if (r.status === "success" || r.status === "denied" || r.status === "expired") {
          sessions.delete(sessionId)
        }
        return jsonResponse(r, 200)
      } catch (err) {
        return jsonResponse(
          { error: "oauth_poll_failed", message: (err as Error).message },
          502,
        )
      }
    }

    return jsonResponse({ error: "not_found" }, 404)
  }

  const server = Bun.serve({
    port: options.port ?? 0,
    fetch: handler,
  })

  // session GC
  const gcTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, s] of sessions) {
      if (now - s.createdAt > s.expiresInMs) {
        sessions.delete(id)
      }
    }
  }, options.gcIntervalMs ?? 60_000)
  // GC 不应阻塞 process 退出
  if (typeof gcTimer === "object" && gcTimer && "unref" in gcTimer) {
    ;(gcTimer as { unref?: () => void }).unref?.()
  }

  const port = server.port ?? 0
  const ready: ServerReadyData = {
    url: `http://127.0.0.1:${port}`,
    username,
    password,
  }

  // 打 ServerReadyData 给 Tauri 主进程读
  if (options.onReady) {
    options.onReady(ready)
  } else {
    console.log(JSON.stringify(ready))
  }

  return {
    url: ready.url,
    port,
    ready,
    stop: () => {
      clearInterval(gcTimer)
      server.stop()
      sessions.clear()
    },
  }
}

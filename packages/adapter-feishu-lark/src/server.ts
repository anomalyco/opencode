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
import {
  deleteAccount,
  listAccounts,
  saveAccount,
  updateAccountModel,
  updateAccountSettings,
  type SaveAccountInput,
} from "./feishu/account-store"
import { fetchBotName } from "./feishu/bot-info"

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
  /**
   * 账号 save / delete 后触发(plugin 模式 hot-reload WSS 用)。
   * server 端只负责通知,具体 sync 逻辑由调用方决定(通常 = listAccounts + wssManager.sync)。
   */
  onAccountsChanged?: () => void | Promise<void>
  /**
   * 列 opencode 已配置的 LLM providers + models(给 GUI 选 per-account model 用)。
   * plugin 模式下传一个 callback 用 input.client.config.providers() 拿;
   * 不传时 server `/providers` endpoint 返 503。
   */
  onListProviders?: () => Promise<unknown>
  /**
   * 测试 / debug:模拟飞书消息直接进 pipeline,不需要真飞书发消息。
   * body { accountId, chatId, chatType, messageType, content } → 调对应 pipeline.testHandle。
   * plugin 模式下传一个 callback,内部转给 pipelines.get(accountId).testHandle(event)。
   */
  onSimulateMessage?: (event: {
    accountId: string
    chatId: string
    chatType: string
    messageType: string
    messageId: string
    content: string
  }) => Promise<void>
  /** debug:调 SDK session.messages,返 raw response 详情(查 401 等错) */
  onDebugFetchMessages?: (accountId: string, sessionID: string) => Promise<unknown>
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

    // ============================================================
    // 账户 CRUD(C1.6)
    // ============================================================

    if (req.method === "POST" && url.pathname === "/accounts/save") {
      let body: Partial<SaveAccountInput>
      try {
        body = (await req.json()) as Partial<SaveAccountInput>
      } catch {
        return jsonResponse({ error: "invalid_json" }, 400)
      }
      if (!body.appId || !body.appSecret || !body.openId) {
        return jsonResponse(
          { error: "missing_fields", message: "appId / appSecret / openId required" },
          400,
        )
      }
      if (body.domain !== "feishu" && body.domain !== "lark") {
        return jsonResponse(
          { error: "invalid_domain", message: "domain must be feishu|lark" },
          400,
        )
      }
      try {
        // 拉一次 bot 名(best-effort,失败为空字符串,不阻断 saveAccount)
        const botName = await fetchBotName(body.domain, body.appId, body.appSecret).catch(
          (err) => {
            console.warn("[server] bot info fetch failed during save:", err)
            return ""
          },
        )

        const r = saveAccount({
          accountId: body.accountId,
          domain: body.domain,
          appId: body.appId,
          appSecret: body.appSecret,
          openId: body.openId,
          botName: botName || undefined,
        })
        // 触发 hot-reload(plugin 内 listAccounts + wssManager.sync)
        try {
          await options.onAccountsChanged?.()
        } catch (err) {
          console.warn("[server] onAccountsChanged after save:", err)
        }
        // 返回 account 时去除 SecretRef 内部细节,仅给 GUI 显示用的安全摘要
        return jsonResponse(
          {
            accountId: r.accountId,
            appId: r.account.appId,
            openId: r.account.openId,
            domain: r.account.domain,
            agent: r.account.agent,
            botName: r.account.botName ?? "",
          },
          200,
        )
      } catch (err) {
        return jsonResponse(
          { error: "save_failed", message: (err as Error).message },
          500,
        )
      }
    }

    if (req.method === "GET" && url.pathname === "/accounts") {
      try {
        const list = listAccounts().map(({ accountId, account }) => ({
          accountId,
          appId: account.appId,
          openId: account.openId,
          domain: account.domain,
          agent: account.agent,
          enabled: account.enabled,
          model: account.model ?? null,
          botName: account.botName ?? "",
          // [feat: feishu-create-group-toggle-gui] 2026-05-24 暴露当前 flag 给 GUI 显示
          enableAutoGroupCreate: account.enableAutoGroupCreate,
        }))
        return jsonResponse({ accounts: list }, 200)
      } catch (err) {
        return jsonResponse(
          { error: "list_failed", message: (err as Error).message },
          500,
        )
      }
    }

    // POST /accounts/update-model — body: { accountId, model: {providerID, modelID} | null }
    // 向后兼容旧 callsite(Tauri feishu_update_account_model 等)— 委派给 /accounts/update-settings。
    if (req.method === "POST" && url.pathname === "/accounts/update-model") {
      let body: {
        accountId?: string
        model?: { providerID?: string; modelID?: string } | null
      }
      try {
        body = (await req.json()) as typeof body
      } catch {
        return jsonResponse({ error: "invalid_json" }, 400)
      }
      if (!body.accountId) {
        return jsonResponse({ error: "missing_account_id" }, 400)
      }
      const model = body.model
      const cleanModel =
        model && model.providerID && model.modelID
          ? { providerID: model.providerID, modelID: model.modelID }
          : null
      const r = updateAccountModel(body.accountId, cleanModel)
      if (!r) {
        return jsonResponse({ error: "account_not_found" }, 404)
      }
      // 触发 onAccountsChanged,plugin 重建 MessagePipeline 让新 model hot 生效
      try {
        await options.onAccountsChanged?.()
      } catch (err) {
        console.warn("[server] onAccountsChanged after update-model:", err)
      }
      return jsonResponse({ updated: true, model: cleanModel }, 200)
    }

    // POST /accounts/update-settings — body: { accountId, model?, enableAutoGroupCreate? }
    // [feat: feishu-create-group-toggle-gui] 2026-05-24
    // partial update:任一字段子集都接受,空 patch reject 防 noop,未知字段 reject 防 schema injection。
    if (req.method === "POST" && url.pathname === "/accounts/update-settings") {
      let body: {
        accountId?: string
        model?: { providerID?: string; modelID?: string } | null
        enableAutoGroupCreate?: boolean
      } & Record<string, unknown>
      try {
        body = (await req.json()) as typeof body
      } catch {
        return jsonResponse({ error: "invalid_json" }, 400)
      }
      if (!body.accountId) {
        return jsonResponse({ error: "missing_account_id" }, 400)
      }
      // 白名单字段校验 — 拒绝未知字段防 schema injection
      const allowed = new Set(["accountId", "model", "enableAutoGroupCreate"])
      const unknown = Object.keys(body).filter((k) => !allowed.has(k))
      if (unknown.length > 0) {
        return jsonResponse(
          { error: "unknown_fields", fields: unknown },
          400,
        )
      }
      // partial:必须至少一项 settings(单 accountId 不算改动)
      const hasModel = "model" in body
      const hasFlag = "enableAutoGroupCreate" in body
      if (!hasModel && !hasFlag) {
        return jsonResponse(
          { error: "empty_patch", message: "至少需要 model 或 enableAutoGroupCreate 之一" },
          400,
        )
      }
      // 类型校验
      if (hasFlag && typeof body.enableAutoGroupCreate !== "boolean") {
        return jsonResponse(
          { error: "invalid_field", field: "enableAutoGroupCreate", expected: "boolean" },
          400,
        )
      }
      const patch: Parameters<typeof updateAccountSettings>[1] = {}
      if (hasModel) {
        const m = body.model
        patch.model =
          m && m.providerID && m.modelID
            ? { providerID: m.providerID, modelID: m.modelID }
            : null
      }
      if (hasFlag) {
        patch.enableAutoGroupCreate = body.enableAutoGroupCreate!
      }
      const r = updateAccountSettings(body.accountId, patch)
      if (!r) {
        return jsonResponse({ error: "account_not_found" }, 404)
      }
      // 触发 onAccountsChanged,plugin 重建 MessagePipeline 让新 settings hot 生效
      try {
        await options.onAccountsChanged?.()
      } catch (err) {
        console.warn("[server] onAccountsChanged after update-settings:", err)
      }
      return jsonResponse({ updated: true, patch }, 200)
    }

    // GET /debug/fetch-messages?accountId=xxx&sessionID=ses_xxx — 调 SDK session.messages
    if (req.method === "GET" && url.pathname === "/debug/fetch-messages") {
      if (!options.onDebugFetchMessages) {
        return jsonResponse({ error: "debug_unavailable" }, 503)
      }
      const accountId = url.searchParams.get("accountId")
      const sessionID = url.searchParams.get("sessionID")
      if (!accountId || !sessionID) {
        return jsonResponse({ error: "missing_params" }, 400)
      }
      try {
        const r = await options.onDebugFetchMessages(accountId, sessionID)
        return jsonResponse({ ok: true, debug: r }, 200)
      } catch (err) {
        return jsonResponse(
          { error: "debug_failed", message: (err as Error).message },
          500,
        )
      }
    }

    // POST /debug/simulate-message — 测试 / debug 入口,模拟飞书消息进 pipeline
    if (req.method === "POST" && url.pathname === "/debug/simulate-message") {
      if (!options.onSimulateMessage) {
        return jsonResponse({ error: "simulate_unavailable" }, 503)
      }
      let body: {
        accountId?: string
        chatId?: string
        chatType?: string
        messageType?: string
        messageId?: string
        text?: string
      }
      try {
        body = (await req.json()) as typeof body
      } catch {
        return jsonResponse({ error: "invalid_json" }, 400)
      }
      if (!body.accountId || !body.chatId || !body.text) {
        return jsonResponse({ error: "missing_fields" }, 400)
      }
      try {
        await options.onSimulateMessage({
          accountId: body.accountId,
          chatId: body.chatId,
          chatType: body.chatType ?? "p2p",
          messageType: body.messageType ?? "text",
          messageId: body.messageId ?? `om_simulate_${Date.now()}`,
          content: JSON.stringify({ text: body.text }),
        })
        return jsonResponse({ ok: true }, 200)
      } catch (err) {
        return jsonResponse(
          { error: "simulate_failed", message: (err as Error).message },
          500,
        )
      }
    }

    // POST /bot-info — 用 (domain, appId, appSecret) 调 lark/飞书 API 拿 bot 名字
    if (req.method === "POST" && url.pathname === "/bot-info") {
      let body: { domain?: FeishuDomain; appId?: string; appSecret?: string }
      try {
        body = (await req.json()) as typeof body
      } catch {
        return jsonResponse({ error: "invalid_json" }, 400)
      }
      if (!body.domain || !body.appId || !body.appSecret) {
        return jsonResponse({ error: "missing_fields" }, 400)
      }
      try {
        const botName = await fetchBotName(body.domain, body.appId, body.appSecret)
        return jsonResponse({ botName }, 200)
      } catch (err) {
        return jsonResponse(
          { error: "bot_info_failed", message: (err as Error).message },
          502,
        )
      }
    }

    // GET /providers — 转发 opencode 已配 providers / models 列表(给 GUI 选)
    if (req.method === "GET" && url.pathname === "/providers") {
      if (!options.onListProviders) {
        return jsonResponse({ error: "providers_unavailable" }, 503)
      }
      try {
        const data = await options.onListProviders()
        return jsonResponse({ data }, 200)
      } catch (err) {
        return jsonResponse(
          { error: "list_providers_failed", message: (err as Error).message },
          502,
        )
      }
    }

    if (req.method === "POST" && url.pathname === "/accounts/delete") {
      let body: { accountId?: string }
      try {
        body = (await req.json()) as { accountId?: string }
      } catch {
        return jsonResponse({ error: "invalid_json" }, 400)
      }
      if (!body.accountId) {
        return jsonResponse({ error: "missing_account_id" }, 400)
      }
      const r = deleteAccount(body.accountId)
      if (r) {
        try {
          await options.onAccountsChanged?.()
        } catch (err) {
          console.warn("[server] onAccountsChanged after delete:", err)
        }
      }
      return jsonResponse({ deleted: r }, 200)
    }

    return jsonResponse({ error: "not_found" }, 404)
  }

  const server = Bun.serve({
    port: options.port ?? 0,
    // 显式绑 loopback — Bun.serve 默认 hostname 为 "0.0.0.0"(所有接口),会让 Win Firewall
    // 弹"是否允许公网访问"提示(标 "Bun"+publisher "Oven",对 user 困惑且看起来像恶意软件)
    // 同时把 plugin server 暴露到 LAN — 虽然有 basic auth 但攻击面应降到 0。
    // (2026-05-10 加;参考 feishu-server-loopback-bind feat-id)
    hostname: "127.0.0.1",
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

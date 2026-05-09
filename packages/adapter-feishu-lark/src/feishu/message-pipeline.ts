// [fork-only] message-pipeline — 飞书消息 → opencode plugin client → 飞书回写
// [feat: feishu-bridge] 2026-05-09 v3(plugin 模式)
//
// v3 切到 opencode plugin 架构(对齐 OpenClaw channel plugin):
//   - opencodeClient 来自 PluginInput.client(in-process,自动 attach instance)
//   - LLM 响应通过 PromptDispatcher(plugin event hook 推送),不再手写 SSE
//   - 0 修改 opencode / DeskFox 主程序
//
// 流程:
//   1. WSS 收到 ImMessageEvent(messageType="text")
//   2. 解析 text + chatId → opencode session map(threadSession 1:1)
//   3. opencodeClient.session.create({ title })— 首次
//   4. dispatcher.register(sessionID) → 拿到 reply Promise
//   5. opencodeClient.session.promptAsync({ sessionID, agent, parts })
//   6. await replyPromise(dispatcher 累积 token,session.idle 时 resolve)
//   7. lark Client.im.v1.message.create 发回飞书

import { homedir } from "node:os"
import { join } from "node:path"
import { Client } from "@larksuiteoapi/node-sdk"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { FeishuAccount } from "../core/config-schema"
import { readSecret } from "../core/secret-ref"
import type { ChatSessionStore } from "./chat-session-store"
import type { PromptDispatcher } from "./prompt-dispatcher"
import type { ImMessageEvent } from "./wss-client"

/** opencode SDK v1 client 类型(plugin PluginInput.client 类型) */
export type OpencodeSDKClient = ReturnType<typeof createOpencodeClient>

/**
 * 飞书桥接专用 workspace directory — 所有 plugin 创建的 session 都在这个
 * 目录下,跟 user 主窗口的项目隔离。GUI sidebar 不会显示(因为 archive),
 * 也不污染 user 实际项目环境。
 */
const FEISHU_WORKSPACE = join(homedir(), ".opencode", "feishu-workspace")

const FEISHU_OPEN_API_DOMAIN: Record<"feishu" | "lark", string> = {
  feishu: "https://open.feishu.cn",
  lark: "https://open.larksuite.com",
}

export interface PipelineOptions {
  account: FeishuAccount
  accountId: string
  /** opencode SDK v1 client(plugin PluginInput.client,in-process,自动 attach instance) */
  opencodeClient: OpencodeSDKClient
  /** event hook → waiter 路由器 */
  dispatcher: PromptDispatcher
  /** chatId → sessionID 持久化映射(plugin 重启后同 chat 仍能复用 session)*/
  chatSessionStore: ChatSessionStore
  /** 单次 prompt 超时(ms),默认 5min */
  promptTimeoutMs?: number
}

export class MessagePipeline {
  private readonly opts: PipelineOptions
  private readonly larkClient: Client
  /** chatId → opencode sessionID(in-memory cache,真持久化在 chatSessionStore)*/
  private readonly chatToSession = new Map<string, string>()

  constructor(opts: PipelineOptions) {
    this.opts = opts
    const appSecret = readSecret(opts.account.appSecret)
    this.larkClient = new Client({
      appId: opts.account.appId,
      appSecret,
      domain: FEISHU_OPEN_API_DOMAIN[opts.account.domain],
    })
  }

  async handle(event: ImMessageEvent): Promise<void> {
    if (event.messageType !== "text") {
      console.log(
        `[pipeline ${this.opts.accountId}] skip non-text message: type=${event.messageType}`,
      )
      return
    }

    let text: string
    try {
      const parsed = JSON.parse(event.content) as { text?: string }
      text = (parsed.text ?? "").trim()
    } catch {
      console.warn(`[pipeline ${this.opts.accountId}] invalid content json:`, event.content)
      return
    }
    if (!text) return

    console.log(
      `[pipeline ${this.opts.accountId}] msg from chat=${event.chatId}: "${text.slice(0, 100)}"`,
    )

    // 仅复用 *本 sidecar lifecycle 内* 创建的 session(in-memory cache)。
    // 历史 session(sidecar 上次启动前创建的)因 opencode 内部 InstanceState 不预 load
    // 而对 GET /session/{id}/message 路由返 401,导致拉不到 reply。
    // 短期 trade-off:sidecar 重启后所有 chat 第一条消息开新 session(无跨重启 multi-turn memory),
    // 但同 sidecar lifetime 内 chat 仍 multi-turn 复用 session。
    // FUTURE:让旧 session 也能拉(可能改走 /api/session/{id}/message 或 reload state)
    let sessionID = this.chatToSession.get(event.chatId)
    if (!sessionID) {
      try {
        const res = await this.opts.opencodeClient.session.create({
          query: { directory: FEISHU_WORKSPACE },
          body: {
            title: `Feishu ${event.chatType}/${event.chatId.slice(-8)}`,
          },
        })
        const id = (res as { data?: { id?: string } }).data?.id
        if (!id) throw new Error("session.create returned no id")
        sessionID = id
        this.chatToSession.set(event.chatId, sessionID)
        // 落盘:plugin 重启后同 chat 仍能复用此 session
        this.opts.chatSessionStore.set(this.opts.accountId, event.chatId, sessionID)
        // 🚨 立即 archive 飞书 plugin 创建的 session,user GUI sidebar 不显示
        await this.archiveSession(sessionID).catch((archErr) => {
          console.warn(
            `[pipeline ${this.opts.accountId}] archive session ${sessionID} failed (会显示在 GUI):`,
            archErr,
          )
        })
        console.log(
          `[pipeline ${this.opts.accountId}] new opencode session ${sessionID} (archived,持久化) for chat=${event.chatId}`,
        )
      } catch (err) {
        console.error(`[pipeline ${this.opts.accountId}] createSession failed:`, err)
        await this.sendFeishuText(
          event.chatId,
          `❌ DeskFox 创建会话失败:${(err as Error).message}`,
        )
        return
      }
    }

    let reply: string
    try {
      reply = await this.runOpencode(sessionID, text, this.opts.account.agent)
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] opencode error:`, err)
      await this.sendFeishuText(
        event.chatId,
        `❌ DeskFox 处理出错:${(err as Error).message}`,
      )
      return
    }

    if (!reply.trim()) {
      console.warn(`[pipeline ${this.opts.accountId}] empty reply for chat=${event.chatId}`)
      return
    }

    console.log(
      `[pipeline ${this.opts.accountId}] reply (len=${reply.length}) preview: "${reply.slice(0, 200)}"`,
    )
    try {
      await this.sendFeishuText(event.chatId, reply)
      console.log(
        `[pipeline ${this.opts.accountId}] sent reply to chat=${event.chatId}: "${reply.slice(0, 100)}"`,
      )
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] sendFeishuText failed:`, err)
    }
  }

  /**
   * 启动 prompt + 等 dispatcher 拿 reply。
   *
   * register waiter 必须在 promptAsync **之前**(防错过早期 events)。
   *
   * !! 已知 bug:dispatcher 累积所有 text part(包括 user prompt 的 part)→ reply echo user 输入。
   *    修需要按 message role 区分(part 没 role 字段,得通过 message.updated event 反查)。
   *    留 followup,先保证有 reply(echo)优于 empty reply。
   */
  private async runOpencode(sessionID: string, text: string, agent: string): Promise<string> {
    const timeoutMs = this.opts.promptTimeoutMs ?? 5 * 60 * 1000

    const idlePromise = this.opts.dispatcher.register(sessionID, timeoutMs)

    const accountModel = this.opts.account.model
    void this.opts.opencodeClient.session
      .promptAsync({
        path: { id: sessionID },
        query: { directory: FEISHU_WORKSPACE },
        body: {
          agent,
          ...(accountModel
            ? { model: { providerID: accountModel.providerID, modelID: accountModel.modelID } }
            : {}),
          parts: [{ type: "text", text }],
        },
      })
      .catch((err) => {
        console.error(`[pipeline ${this.opts.accountId}] promptAsync error:`, err)
      })

    // 等 idle 信号(不依赖 dispatcher 累积 part — race condition 见 dispatcher 注释)
    await idlePromise

    // setImmediate 跳出当前 event hook 的 microtask scope,确保 server 端 message/part db 写完 + auth context 正常
    await new Promise<void>((resolve) => setImmediate(resolve))

    // 直接拉 messages 取 last assistant text(role 准确,不会 echo user prompt)
    const msgsRes = await this.opts.opencodeClient.session.messages({
      path: { id: sessionID },
      query: { directory: FEISHU_WORKSPACE },
    })
    const wrap = msgsRes as {
      data?: Array<{
        info: {
          role?: string
          error?: { message?: string; data?: { message?: string } }
        }
        parts: Array<{ type?: string; text?: string; synthetic?: boolean; ignored?: boolean }>
      }>
      error?: unknown
      response?: { status?: number }
    }
    if (!wrap.data) {
      console.warn(
        `[pipeline ${this.opts.accountId}] messages fetch failed status=${wrap.response?.status}, fallback ""`,
      )
      return ""
    }
    const data = wrap.data
    if (data.length === 0) return ""

    let assistantEntry: (typeof data)[number] | undefined
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i]!.info.role === "assistant") {
        assistantEntry = data[i]
        break
      }
    }
    if (!assistantEntry) return ""

    // 检查 LLM 错误(opencode 把 LLM API error 存进 assistant message.error)
    const err = assistantEntry.info.error
    if (err) {
      const errMsg =
        (err as { data?: { message?: string } }).data?.message ?? err.message ?? "opencode LLM error"
      throw new Error(errMsg)
    }

    // 拼 text parts(skip step-start / step-finish / reasoning / tool 等;只取 type=text)
    const texts: string[] = []
    for (const p of assistantEntry.parts) {
      if (p.type === "text" && typeof p.text === "string" && !p.synthetic && !p.ignored) {
        texts.push(p.text)
      }
    }
    return texts.join("").trim()
  }

  /** 测试 / debug 入口:外部调用直接驱动 handle(传 ImMessageEvent 模拟飞书消息) */
  async testHandle(event: ImMessageEvent): Promise<void> {
    return this.handle(event)
  }

  /** 测试 / debug:直接调 SDK session.messages 并打 raw response 详情(不走 pipeline) */
  async debugFetchMessages(sessionID: string): Promise<unknown> {
    const r = await this.opts.opencodeClient.session.messages({
      path: { id: sessionID },
      query: { directory: FEISHU_WORKSPACE },
    })
    const wrap = r as {
      data?: unknown
      error?: unknown
      response?: { status?: number; statusText?: string; url?: string }
      request?: { url?: string; method?: string; headers?: { get?: (k: string) => string | null } }
    }
    const auth = wrap.request?.headers?.get?.("Authorization") ?? null
    return {
      hasData: !!wrap.data,
      dataLen: Array.isArray(wrap.data) ? wrap.data.length : "not-array",
      errorPreview: JSON.stringify(wrap.error)?.slice(0, 200),
      status: wrap.response?.status,
      statusText: wrap.response?.statusText,
      requestUrl: wrap.request?.url,
      requestMethod: wrap.request?.method,
      authHeader: auth ? `${auth.slice(0, 20)}...` : "(none)",
    }
  }

  /**
   * Archive 一个 opencode session(plugin 创建的 system session 用,GUI sidebar 默认不显)。
   *
   * 通过 v1 SDK 的 raw `_client.patch`(其 update 类型 schema stale 不含 time.archived,
   * 但 server 端实际接受 — 用 cast 绕过 type 限制)。
   */
  private async archiveSession(sessionID: string): Promise<void> {
    const rawClient = (this.opts.opencodeClient as unknown as { _client?: unknown })._client
    if (!rawClient || typeof (rawClient as { patch?: unknown }).patch !== "function") {
      throw new Error("opencode SDK client missing internal _client.patch")
    }
    await (rawClient as { patch: (req: unknown) => Promise<unknown> }).patch({
      url: "/session/{id}",
      path: { id: sessionID },
      query: { directory: FEISHU_WORKSPACE },
      body: {
        time: { archived: Date.now() },
      },
    })
  }

  private async sendFeishuText(chatId: string, text: string): Promise<void> {
    await this.larkClient.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    })
  }
}

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

/**
 * 给飞书 user 的友好错误回复 — 把技术性 opencode error message 翻译成 user 可操作的指引。
 * 只识别 happy-path 阻塞性错误(没配 default model / provider key 无效),其他原样返回。
 *
 * 触发关键字来源(opencode source verified 2026-05-10):
 *   - "no providers found"  → packages/opencode/src/provider/provider.ts:1706
 *   - "no models found"     → packages/opencode/src/provider/provider.ts:1708
 *   - "Invalid model"       → CLI/github.ts;形态 `Invalid model ${x}. Model must be ...`
 *   - "API key"             → upstream provider SDK 抛 401 时常含 "API key" / "api key"
 *
 * exported for unit testing.
 */
export function friendlyErrorReply(err: Error): string {
  const msg = err.message ?? String(err)
  const lower = msg.toLowerCase()
  if (
    lower.includes("no providers found") ||
    lower.includes("no models found") ||
    lower.includes("no model configured") ||
    lower.includes("invalid model")
  ) {
    return (
      "❌ DeskFox 未配置默认 LLM model。\n" +
      "请打开 DeskFox 主程序 → Settings → Providers,给任一 provider 添加 API key,build agent 默认 model 会自动设置好。\n" +
      `(原始错误:${msg})`
    )
  }
  if (lower.includes("api key") || lower.includes("api_key") || lower.includes("401")) {
    return (
      "❌ DeskFox 调用 LLM 失败 — API key 可能无效或额度不足。\n" +
      "请到 DeskFox 主程序 → Settings → Providers 检查对应 provider 的 key。\n" +
      `(原始错误:${msg})`
    )
  }
  return `❌ DeskFox 处理出错:${msg}`
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

    // 立即给 user 消息加 reaction(表情回复),让 user 知道"消息已收到正在响应"
    // best-effort fire-and-forget,失败不阻断主流程
    void this.ackMessage(event.messageId).catch((err) =>
      console.warn(
        `[pipeline ${this.opts.accountId}] ack reaction failed:`,
        (err as Error).message,
      ),
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
        await this.sendFeishuText(event.chatId, friendlyErrorReply(err as Error))
        return
      }
    }

    let reply: string
    try {
      reply = await this.runOpencode(sessionID, text, this.opts.account.agent)
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] opencode error:`, err)
      await this.sendFeishuText(event.chatId, friendlyErrorReply(err as Error))
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
   * v2(2026-05-10 起):走 dispatcher 的强完成信号 — `message.updated` 事件里
   * `info.time.completed` 字段。dispatcher 锁定 first 新 assistant message id +
   * 累积该 message 的 text parts → 完成时直接 resolve 文本,不再调 session.messages
   * 兜底查询。
   *
   * register waiter 必须在 promptAsync **之前**(防错过早期 events)。
   *
   * timeout 默认 30 分钟,作为**事件丢失的最终兜底**(opencode-cli 崩 / 网络抖动等
   * 极端场景),不是主信号。正常情况下 message.updated 完成时直接 resolve,远早于
   * timeout。
   */
  private async runOpencode(sessionID: string, text: string, agent: string): Promise<string> {
    const timeoutMs = this.opts.promptTimeoutMs ?? 30 * 60 * 1000

    const completionPromise = this.opts.dispatcher.register(sessionID, timeoutMs)

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

    const result = await completionPromise

    if (result.kind === "error") {
      const errMsg =
        result.error.data?.message ?? result.error.message ?? "opencode LLM error"
      throw new Error(errMsg)
    }
    if (result.kind === "no-message") {
      console.warn(
        `[pipeline ${this.opts.accountId}] no assistant message captured: ${result.reason}`,
      )
      return ""
    }
    return result.text
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

  /**
   * 给 user 的消息加 emoji reaction,告诉 user "消息收到、正在响应"。
   * 同 OpenClaw 飞书桥接默认 ack 行为(避免 LLM 慢响应时 user 不知 plugin 是不是死了)。
   * "OK" 是飞书内置 emoji_type 之一,显示成 ✅ 类似的勾选标记。
   */
  private async ackMessage(messageId: string): Promise<void> {
    await this.larkClient.im.v1.messageReaction.create({
      data: { reaction_type: { emoji_type: "OK" } },
      path: { message_id: messageId },
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

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

import { Client } from "@larksuiteoapi/node-sdk"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { FeishuAccount } from "../core/config-schema"
import { readSecret } from "../core/secret-ref"
import type { PromptDispatcher } from "./prompt-dispatcher"
import type { ImMessageEvent } from "./wss-client"

/** opencode SDK v1 client 类型(plugin PluginInput.client 类型) */
export type OpencodeSDKClient = ReturnType<typeof createOpencodeClient>

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
  /** 单次 prompt 超时(ms),默认 5min */
  promptTimeoutMs?: number
}

export class MessagePipeline {
  private readonly opts: PipelineOptions
  private readonly larkClient: Client
  /** chatId → opencode sessionID(threadSession,内存里维护)*/
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

    let sessionID = this.chatToSession.get(event.chatId)
    if (!sessionID) {
      try {
        const res = await this.opts.opencodeClient.session.create({
          body: {
            title: `Feishu ${event.chatType}/${event.chatId.slice(-8)}`,
          },
        })
        const id = (res as { data?: { id?: string } }).data?.id
        if (!id) throw new Error("session.create returned no id")
        sessionID = id
        this.chatToSession.set(event.chatId, sessionID)
        console.log(
          `[pipeline ${this.opts.accountId}] new opencode session ${sessionID} for chat=${event.chatId}`,
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
   */
  private async runOpencode(sessionID: string, text: string, agent: string): Promise<string> {
    const timeoutMs = this.opts.promptTimeoutMs ?? 5 * 60 * 1000

    // 先 register waiter
    const replyPromise = this.opts.dispatcher.register(sessionID, timeoutMs)

    // 触发 prompt(fire-and-forget,响应靠 dispatcher 推送 events)
    // 不传 model — plugin 内 client 已 attach instance,opencode 用 user 全局 default model
    void this.opts.opencodeClient.session
      .promptAsync({
        path: { id: sessionID },
        body: {
          agent,
          parts: [{ type: "text", text }],
        },
      })
      .catch((err) => {
        console.error(`[pipeline ${this.opts.accountId}] promptAsync error:`, err)
      })

    return await replyPromise
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

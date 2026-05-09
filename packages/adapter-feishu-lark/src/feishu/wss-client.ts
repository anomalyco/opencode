// [fork-only] FeishuWSSClient — 飞书 WSS 长连接 + 事件订阅(C2.WSS)
// [feat: feishu-bridge] 2026-05-08
//
// 用 @larksuiteoapi/node-sdk 的 WSClient + EventDispatcher 包装,接 im.message.receive_v1
// 事件,经 dedup + chatQueue 串行处理,转给调用方注入的 onMessage handler。
//
// SDK autoReconnect 自带断线重连,我们不再手动 retry。
// SDK domain 参数:`https://open.feishu.cn`(国内) / `https://open.larksuite.com`(国际)。

import { EventDispatcher, WSClient } from "@larksuiteoapi/node-sdk"
import type { FeishuAccount } from "../core/config-schema"
import { readSecret } from "../core/secret-ref"
import { ChatQueue } from "./chat-queue"
import { DedupCache, makeDedupKey } from "./dedup"

// SDK 接受 domain 字符串 — 飞书国内 / Lark 国际
const FEISHU_OPEN_API_DOMAIN: Record<"feishu" | "lark", string> = {
  feishu: "https://open.feishu.cn",
  lark: "https://open.larksuite.com",
}

/** 标准化后的消息事件(adapter 内部用) */
export interface ImMessageEvent {
  accountId: string
  /** 飞书 message_id(`om_xxx`) */
  messageId: string
  /** chat_id(`oc_xxx`,私聊也是),chatQueue 串行 key */
  chatId: string
  chatType: string
  /** 消息类型:text / interactive / image / ... */
  messageType: string
  /** 消息内容(JSON 字符串,需根据 messageType 解析) */
  content: string
  /** 发送者 openId(私聊白名单 / 群级权限校验用) */
  senderOpenId?: string
  /** 飞书 create_time(ms timestamp string) */
  ts: string
  /** 群消息中 @ 列表(检测是否 @bot 触发) */
  mentions: Array<{ key: string; name: string; openId?: string }>
}

export type OnMessageHandler = (event: ImMessageEvent) => Promise<void> | void

export interface WssClientOptions {
  account: FeishuAccount
  accountId: string
  onMessage: OnMessageHandler
}

export class FeishuWSSClient {
  private readonly wsClient: WSClient
  private readonly dispatcher: EventDispatcher
  private readonly chatQueue = new ChatQueue()
  private readonly dedup = new DedupCache()
  private readonly opts: WssClientOptions
  private started = false

  constructor(opts: WssClientOptions) {
    this.opts = opts
    const account = opts.account
    const appSecret = readSecret(account.appSecret)

    this.wsClient = new WSClient({
      appId: account.appId,
      appSecret,
      domain: FEISHU_OPEN_API_DOMAIN[account.domain],
      autoReconnect: true,
    })

    this.dispatcher = new EventDispatcher({})
    this.dispatcher.register({
      "im.message.receive_v1": async (data) => {
        const msg = data.message
        const sender = data.sender
        const event: ImMessageEvent = {
          accountId: opts.accountId,
          messageId: msg.message_id,
          chatId: msg.chat_id,
          chatType: msg.chat_type,
          messageType: msg.message_type,
          content: msg.content,
          senderOpenId: sender?.sender_id?.open_id,
          ts: msg.create_time,
          mentions: (msg.mentions ?? []).map((m) => ({
            key: m.key,
            name: m.name,
            openId: m.id?.open_id,
          })),
        }

        // dedup:同 messageId + ts 重放过滤
        const dedupKey = makeDedupKey(event.messageId, event.ts)
        if (this.dedup.hasAndMark(dedupKey)) {
          console.log(`[wss ${opts.accountId}] dedup skip ${event.messageId}`)
          return
        }

        // chatQueue:同 chat 串行处理
        await this.chatQueue.enqueue(event.chatId, async () => {
          try {
            await opts.onMessage(event)
          } catch (err) {
            console.error(`[wss ${opts.accountId}] onMessage error:`, err)
          }
        })
      },
    })
  }

  /** 启动连接(SDK 自带 autoReconnect,start 一次即可) */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    try {
      await this.wsClient.start({ eventDispatcher: this.dispatcher })
      console.log(
        `[wss] connected: account=${this.opts.accountId} domain=${this.opts.account.domain}`,
      )
    } catch (err) {
      this.started = false
      throw err
    }
  }

  get isStarted(): boolean {
    return this.started
  }

  get accountId(): string {
    return this.opts.accountId
  }
}

// ============================================================
// Manager — 按 accounts 列表起多个 WSSClient,saveAccount 后可 refresh
// ============================================================

export class WSSClientManager {
  private readonly clients = new Map<string, FeishuWSSClient>()
  private readonly onMessage: OnMessageHandler

  constructor(onMessage: OnMessageHandler) {
    this.onMessage = onMessage
  }

  /** 同步当前 accounts 列表:新 account 起 WSS,失败 account silently 跳过 */
  async sync(accounts: Array<{ accountId: string; account: FeishuAccount }>): Promise<void> {
    for (const { accountId, account } of accounts) {
      if (!account.enabled) continue
      if (this.clients.has(accountId)) continue
      const client = new FeishuWSSClient({
        account,
        accountId,
        onMessage: this.onMessage,
      })
      try {
        await client.start()
        this.clients.set(accountId, client)
      } catch (err) {
        console.error(`[wss-manager] start failed ${accountId}:`, err)
      }
    }
    // FUTURE:account.enabled=false 或 account 已删 → close & remove
    // SDK 没暴露 stop,目前只在 process restart 时清理
  }

  get size(): number {
    return this.clients.size
  }

  has(accountId: string): boolean {
    return this.clients.has(accountId)
  }
}

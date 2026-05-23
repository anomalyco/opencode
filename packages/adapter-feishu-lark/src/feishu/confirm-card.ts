// [fork-only] ConfirmCard — 通用 yes/no 确认卡片(复用 permission-card 模式)
// [feat: feishu-bridge-light] 2026-05-23
//
// 跟 permission-card 比:
//   - permission-card 处理 opencode `permission.asked` event,reply 固定 (once|always|reject)
//     → 路由到 opencodeClient.postSessionIdPermissionsPermissionId
//   - confirm-card 处理本 adapter 自发的"AI 想做 X 是否同意?" 二次确认,reply 是 yes|no
//     → 路由到调用方注入的 onConfirm/onReject 回调
//
// 当前使用方:Phase 3 自动建群 — AI reply 含 [CREATE_GROUP:name] marker 时,先发 confirm
// 卡片让 user 二次确认,user 点【✅ 确认】才真调 chat.create。
// 未来其他"AI 想做敏感操作让 user yes/no"也复用此 controller。

import type { Client } from "@larksuiteoapi/node-sdk"
import type { InteractiveCard } from "./permission-card"

const DEFAULT_CONFIRM_TIMEOUT_MS = 10 * 60 * 1000 // 10 分钟(比 permission 30min 短;二次确认场景更应快速决策)

export type ConfirmReply = "yes" | "no"

/** action.value schema — encode confirm reply 信息 */
interface ConfirmCardActionValue {
  kind: "confirm_reply"
  requestID: string
  reply: ConfirmReply
}

/** 飞书 card.action.trigger 事件解析后的子集(confirm 卡片专用) */
export interface ParsedConfirmAction {
  requestID: string
  reply: ConfirmReply
  cardMessageId?: string
  openId?: string
}

export interface ConfirmCardSpec {
  /** 标题(header.title),如 "🆕 创建群【需求讨论】?" */
  title: string
  /** 正文 markdown(div.text.content),向 user 解释 AI 要做什么 */
  body: string
  /** 卡片 header 配色 — blue 中性确认 / orange 提示 / red 危险 */
  template?: "blue" | "orange" | "red"
}

/**
 * 构建 confirm 卡片 JSON。纯函数,易测。
 */
export function buildConfirmCard(spec: ConfirmCardSpec, requestID: string): InteractiveCard {
  const yesValue: ConfirmCardActionValue = { kind: "confirm_reply", requestID, reply: "yes" }
  const noValue: ConfirmCardActionValue = { kind: "confirm_reply", requestID, reply: "no" }
  return {
    config: { update_multi: true, wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: spec.title },
      template: spec.template ?? "blue",
    },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: spec.body } },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "✅ 确认" },
            value: yesValue,
            type: "primary",
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: "❌ 拒绝" },
            value: noValue,
            type: "danger",
          },
        ],
      },
    ],
  }
}

/**
 * 已结算的卡片 — user 点选后用此渲染替代原卡片(去掉 action 按钮,user 无法再点)。
 */
export function buildSettledConfirmCard(
  spec: ConfirmCardSpec,
  reply: ConfirmReply | "timeout",
): InteractiveCard {
  const settled = {
    yes: { suffix: "已确认 ✅", template: "green" as const },
    no: { suffix: "已拒绝 ❌", template: "grey" as const },
    timeout: { suffix: "超时未响应,默认拒绝 ⏱️", template: "grey" as const },
  }[reply]
  return {
    config: { update_multi: true, wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `${spec.title} — ${settled.suffix}` },
      template: settled.template,
    },
    elements: [{ tag: "div", text: { tag: "lark_md", content: spec.body } }],
  }
}

/**
 * 解析飞书 card.action.trigger 事件,提取 confirm reply。
 * 返 null 表示不是 confirm 卡片(其它卡片应跳过)。
 */
export function parseConfirmAction(event: unknown): ParsedConfirmAction | null {
  if (!event || typeof event !== "object") return null
  const e = event as Record<string, unknown>
  const action = e.action as Record<string, unknown> | undefined
  if (!action || typeof action !== "object") return null
  const value = action.value as Record<string, unknown> | undefined
  if (!value || value.kind !== "confirm_reply") return null
  const requestID = value.requestID
  const reply = value.reply
  if (typeof requestID !== "string") return null
  if (reply !== "yes" && reply !== "no") return null
  return {
    requestID,
    reply,
    cardMessageId: typeof e.open_message_id === "string" ? e.open_message_id : undefined,
    openId: typeof e.open_id === "string" ? e.open_id : undefined,
  }
}

interface PendingConfirm {
  chatId: string
  spec: ConfirmCardSpec
  cardMessageId?: string
  timeoutHandle: ReturnType<typeof setTimeout>
  /** user 点确认时 caller 要做的事(true 表确认,false 表拒绝) */
  callback: (confirmed: boolean) => Promise<void> | void
}

export interface ConfirmCardOptions {
  larkClient: Client
  /** 超时 ms,默认 10 min */
  timeoutMs?: number
}

/**
 * 管理 pending confirm 卡片生命周期。
 *
 * 一个 instance 即可服务多个 confirm 请求(按 requestID 去重),调用方负责生成唯一 requestID。
 */
export class ConfirmCardController {
  private readonly pending = new Map<string, PendingConfirm>()
  private readonly opts: ConfirmCardOptions

  constructor(opts: ConfirmCardOptions) {
    this.opts = opts
  }

  get size(): number {
    return this.pending.size
  }

  /**
   * 发 confirm 卡片到 chatId,等 user 点选触发 callback。
   *
   * - 重复 requestID:第二次警告 + skip(不重发卡片)
   * - 发送失败:直接 callback(false) 解锁,避免悬挂
   * - 超时:自动 callback(false) 渲染 settled timeout 卡片
   */
  async start(
    requestID: string,
    chatId: string,
    spec: ConfirmCardSpec,
    callback: (confirmed: boolean) => Promise<void> | void,
  ): Promise<void> {
    if (this.pending.has(requestID)) {
      console.warn(`[confirm-card] duplicate start for ${requestID}, skipping`)
      return
    }
    const card = buildConfirmCard(spec, requestID)
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS
    const timeoutHandle = setTimeout(() => {
      void this.handleTimeout(requestID)
    }, timeoutMs)

    this.pending.set(requestID, {
      chatId,
      spec,
      cardMessageId: undefined,
      timeoutHandle,
      callback,
    })

    try {
      const res = await this.opts.larkClient.im.v1.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          msg_type: "interactive",
          content: JSON.stringify(card),
        },
      })
      const cardMessageId = (res as { data?: { message_id?: string } }).data?.message_id
      if (cardMessageId) {
        const entry = this.pending.get(requestID)
        if (entry) entry.cardMessageId = cardMessageId
      }
      console.log(
        `[confirm-card] sent for ${requestID} to chat ${chatId} cardMessageId=${cardMessageId ?? "MISSING"}`,
      )
    } catch (err) {
      console.error(`[confirm-card] send failed for ${requestID}:`, err)
      this.cleanup(requestID)
      try {
        await callback(false)
      } catch (cbErr) {
        console.error(`[confirm-card] callback(false) on send-fail also failed:`, cbErr)
      }
    }
  }

  /** user 点【✅ 确认】或【❌ 拒绝】触发 */
  async handleReply(parsed: ParsedConfirmAction): Promise<void> {
    const entry = this.pending.get(parsed.requestID)
    if (!entry) {
      // 已 expired / 重复点击 / 不属于本 controller
      console.log(`[confirm-card] handleReply unknown requestID ${parsed.requestID}, noop`)
      return
    }
    const confirmed = parsed.reply === "yes"
    console.log(
      `[confirm-card] user replied ${parsed.reply} for ${parsed.requestID} (chat=${entry.chatId})`,
    )
    this.cleanup(parsed.requestID)
    // 撤回原卡片 + 发 settled 卡片(同 permission-card 体验)
    void this.replaceWithSettled(entry, confirmed ? "yes" : "no")
    try {
      await entry.callback(confirmed)
    } catch (err) {
      console.error(`[confirm-card] callback for ${parsed.requestID} threw:`, err)
    }
  }

  /** 超时自动拒绝 */
  private async handleTimeout(requestID: string): Promise<void> {
    const entry = this.pending.get(requestID)
    if (!entry) return
    console.warn(`[confirm-card] ${requestID} timed out, auto-reject`)
    this.cleanup(requestID)
    void this.replaceWithSettled(entry, "timeout")
    try {
      await entry.callback(false)
    } catch (err) {
      console.error(`[confirm-card] callback(false) on timeout failed:`, err)
    }
  }

  private async replaceWithSettled(
    entry: PendingConfirm,
    reply: ConfirmReply | "timeout",
  ): Promise<void> {
    if (entry.cardMessageId) {
      try {
        await this.opts.larkClient.im.v1.message.delete({
          path: { message_id: entry.cardMessageId },
        })
      } catch (err) {
        console.warn(
          `[confirm-card] delete original card ${entry.cardMessageId} failed:`,
          (err as Error).message,
        )
      }
    }
    const settled = buildSettledConfirmCard(entry.spec, reply)
    try {
      await this.opts.larkClient.im.v1.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: entry.chatId,
          msg_type: "interactive",
          content: JSON.stringify(settled),
        },
      })
    } catch (err) {
      console.warn(`[confirm-card] send settled card failed:`, (err as Error).message)
    }
  }

  private cleanup(requestID: string): void {
    const entry = this.pending.get(requestID)
    if (!entry) return
    clearTimeout(entry.timeoutHandle)
    this.pending.delete(requestID)
  }

  /** 析构 — plugin 卸载时清所有 pending 不留 dangling timer */
  abortAll(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timeoutHandle)
    }
    this.pending.clear()
  }
}

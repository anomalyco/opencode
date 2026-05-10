// [fork-only] PromptDispatcher v2 — opencode plugin event hook ↔ pipeline waiter 桥梁
// [feat: feishu-bridge-completion-signal-rewire] 2026-05-10
//
// 跟 v1(2026-05-08)的本质不同:
//   v1 等 `session.idle` 事件 = session 整体空闲 = 启发式信号,跟某条 reply 完成不严格 1:1。
//       工具调用 / 多步回复尾部出现 ghost placeholder 时,对应不到具体 message。
//       5min 硬超时是兜底,长任务(>5min)被误杀。
//   v2 等 `message.updated` 里 `info.time.completed` 字段 = 这条 reply 显式完成。
//       按 user msg 触发的 first 新 assistant 锁定 messageID,后续 ghost / 干扰 message
//       自然被忽略;text 通过 `message.part.updated` 累积 + 按 messageID 过滤 — 全程
//       事件驱动,不再调 session.messages API,告别启发式 + race condition。
//
// 类比 OpenClaw CardPhase 状态机的 `streaming → completed` transition,但因我们处于
// opencode-cli 沙盒(不是 OpenClaw 主进程内嵌),只能通过事件订阅观察,不能直接调用
// agent runtime。这是沙盒约束下能做到的最强完成信号。

/** opencode plugin event 形状(对齐 Bus event payload)*/
export interface OpencodeEventLike {
  type: string
  properties?: Record<string, unknown>
}

/** dispatcher 完成结果 — 显式区分 ok / error / 无消息 */
export type CompletionResult =
  | { kind: "ok"; text: string; messageID: string }
  | { kind: "error"; error: AssistantErrorLike; messageID: string }
  | { kind: "no-message"; reason: string }

/** opencode 内部 AssistantError 形状的子集(只取 plugin 实际用到的字段) */
export interface AssistantErrorLike {
  message?: string
  data?: { message?: string }
}

/** 从 message.updated event payload 提取的 assistant info 子集 */
interface AssistantInfo {
  id: string
  sessionID: string
  role?: string
  time?: { created?: number; completed?: number }
  error?: AssistantErrorLike
}

/** 从 message.part.updated event payload 提取的 part 子集 */
interface PartInfo {
  id: string
  sessionID: string
  messageID: string
  type?: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
}

interface Waiter {
  /** 注册 register 后捕获的 first 新 assistant message id;ghost / 干扰 message 凭此过滤 */
  capturedAssistantID: string | undefined
  /** 已捕获 assistant 的 text parts 累积(partID → cumulative text)*/
  textBuffer: Map<string, string>
  /** 累积顺序(用于按到达顺序拼接)*/
  partOrder: string[]
  /** 锁定 assistantID 之前到达的 parts,按 messageID 暂存,锁定时迁移对应 messageID 的进 textBuffer */
  pendingByMessage: Map<string, Map<string, string>>
  pendingOrderByMessage: Map<string, string[]>
  /** 已经 resolve/reject 过的 guard flag — 防 double-finalize(supersede 路径下 map 已 delete,
   *  不能用 map.get 来判,改用本 flag)*/
  finalized: boolean
  resolve: (r: CompletionResult) => void
  reject: (e: Error) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

export class PromptDispatcher {
  private readonly waiters = new Map<string, Waiter>()

  /**
   * 注册一个 sessionID 的 prompt waiter。
   *
   * Promise resolve 形态:
   *   { kind: "ok", text, messageID }     — assistant 显式完成 + 有 text
   *   { kind: "error", error, messageID } — assistant 显式完成 + 有 error
   *   { kind: "no-message", reason }      — timeout 兜底(没等到任何 assistant)
   *
   * 同 sessionID 重复 register → 旧 waiter 被 reject("superseded")并清掉。
   */
  register(sessionID: string, timeoutMs: number): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve, reject) => {
      const existing = this.waiters.get(sessionID)
      if (existing) {
        this.waiters.delete(sessionID)
        // existing.reject 用 finalize wrapper 走 finalized flag 防 double-finalize;
        // map 已先 delete → 新 waiter set 时不会冲突
        existing.reject(new Error("superseded by new prompt on same session"))
      }

      // forward decl:waiter 引用在闭包内被 finalize 用,先 let 后 set
      let waiter: Waiter

      const finalize = (kind: "resolve" | "reject", value: CompletionResult | Error) => {
        if (!waiter || waiter.finalized) return
        waiter.finalized = true
        clearTimeout(waiter.timeoutHandle)
        this.waiters.delete(sessionID)
        if (kind === "resolve") resolve(value as CompletionResult)
        else reject(value as Error)
      }

      const timeoutHandle = setTimeout(() => {
        if (!waiter || waiter.finalized) return
        // timeout 兜底:有捕获到的 assistant 就返已积累的 partial text(标 ok),
        // 没捕获到任何 assistant 就 no-message — caller 自己决定怎么处理空字符串。
        if (waiter.capturedAssistantID) {
          const text = collectText(waiter)
          finalize("resolve", {
            kind: "ok",
            text,
            messageID: waiter.capturedAssistantID,
          })
        } else {
          finalize("resolve", {
            kind: "no-message",
            reason: `timeout (${timeoutMs}ms),没等到任何 assistant message`,
          })
        }
      }, timeoutMs)

      waiter = {
        capturedAssistantID: undefined,
        textBuffer: new Map(),
        partOrder: [],
        pendingByMessage: new Map(),
        pendingOrderByMessage: new Map(),
        finalized: false,
        resolve: (r) => finalize("resolve", r),
        reject: (e) => finalize("reject", e),
        timeoutHandle,
      }
      this.waiters.set(sessionID, waiter)
    })
  }

  dispatch(event: OpencodeEventLike): void {
    if (event.type === "message.updated") {
      this.handleMessageUpdated(event)
      return
    }
    if (event.type === "message.part.updated") {
      this.handlePartUpdated(event)
      return
    }
    if (event.type === "session.error") {
      const props = event.properties as { sessionID?: string; error?: AssistantErrorLike }
      const sid = props?.sessionID
      if (!sid) return
      const w = this.waiters.get(sid)
      if (!w) return
      const errMsg = props.error?.data?.message ?? props.error?.message ?? "opencode session error"
      w.reject(new Error(errMsg))
      return
    }
    // 其他事件(session.idle / step-* 等)v2 主动忽略 — 不再用 session.idle 当完成信号
  }

  private handleMessageUpdated(event: OpencodeEventLike): void {
    const props = event.properties as { info?: AssistantInfo } | undefined
    const info = props?.info
    if (!info?.sessionID || !info.id) return
    const w = this.waiters.get(info.sessionID)
    if (!w) return
    if (info.role !== "assistant") return

    const msgID = info.id

    // 第一次见 assistant message → 锁定为本次 reply,迁移已暂存的 parts
    if (w.capturedAssistantID === undefined) {
      w.capturedAssistantID = msgID
      const pendingParts = w.pendingByMessage.get(msgID)
      const pendingOrder = w.pendingOrderByMessage.get(msgID)
      if (pendingParts && pendingOrder) {
        for (const partID of pendingOrder) {
          const text = pendingParts.get(partID)
          if (text !== undefined) {
            if (!w.textBuffer.has(partID)) w.partOrder.push(partID)
            w.textBuffer.set(partID, text)
          }
        }
      }
      w.pendingByMessage.clear()
      w.pendingOrderByMessage.clear()
    } else if (msgID !== w.capturedAssistantID) {
      // 不同 assistant message(典型 case:ghost placeholder),忽略
      return
    }

    // 锁定的 assistant message 显式标完成 → resolve
    const completed = info.time?.completed
    if (completed !== undefined && completed !== null) {
      if (info.error) {
        w.resolve({ kind: "error", error: info.error, messageID: msgID })
      } else {
        w.resolve({ kind: "ok", text: collectText(w), messageID: msgID })
      }
    }
  }

  private handlePartUpdated(event: OpencodeEventLike): void {
    const props = event.properties as { part?: PartInfo } | undefined
    const part = props?.part
    if (!part?.sessionID || !part.id || !part.messageID) return
    const w = this.waiters.get(part.sessionID)
    if (!w) return
    if (part.type !== "text") return
    if (part.synthetic || part.ignored) return

    const text = typeof part.text === "string" ? part.text : ""
    const msgID = part.messageID
    const partID = part.id

    if (w.capturedAssistantID === undefined) {
      // 还没锁定 assistant — 按 messageID 暂存,等 message.updated 到了再迁移
      let parts = w.pendingByMessage.get(msgID)
      let order = w.pendingOrderByMessage.get(msgID)
      if (!parts || !order) {
        parts = new Map()
        order = []
        w.pendingByMessage.set(msgID, parts)
        w.pendingOrderByMessage.set(msgID, order)
      }
      if (!parts.has(partID)) order.push(partID)
      parts.set(partID, text)
      return
    }

    if (msgID !== w.capturedAssistantID) return // 不属于本次 reply,忽略(ghost / 历史轮)

    if (!w.textBuffer.has(partID)) w.partOrder.push(partID)
    w.textBuffer.set(partID, text)
  }

  get pending(): number {
    return this.waiters.size
  }

  abortAll(): void {
    // snapshot waiters before iterating(reject 走 finalize 会 delete map,避免在 iterate 时改 map)
    const snapshot = Array.from(this.waiters.values())
    this.waiters.clear()
    for (const w of snapshot) {
      w.reject(new Error("dispatcher aborted"))
    }
  }
}

/** 按 partOrder 拼 textBuffer,过滤空段(纯空白)*/
function collectText(w: Waiter): string {
  return w.partOrder
    .map((id) => w.textBuffer.get(id) ?? "")
    .filter((t) => t.trim().length > 0)
    .join("\n")
    .trim()
}

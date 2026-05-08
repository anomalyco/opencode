// [fork-only] PromptDispatcher — opencode plugin event hook ↔ pipeline waiter 桥梁
// [feat: feishu-bridge] 2026-05-09
//
// plugin 注册 `event` hook 后,所有 opencode events 都通过 hook 推过来。
// 每个进行中的 prompt 注册一个 waiter,dispatcher 按 sessionID 路由 events
// 到对应 waiter,累积 message.part.delta(text)token,session.idle 时 resolve。
//
// 设计动机:plugin 内 hook 是同步触发(opencode 直接 invoke),延迟 ~0,比手写 SSE 简洁。

interface Waiter {
  buffer: Map<string, string> // partID → cumulative text
  partOrder: string[]
  resolve: (reply: string) => void
  reject: (err: Error) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

/** opencode plugin event 形状(对齐 Bus event payload)*/
export interface OpencodeEventLike {
  type: string
  properties?: Record<string, unknown>
}

export class PromptDispatcher {
  private readonly waiters = new Map<string, Waiter>()

  /**
   * 注册一个 sessionID 的 prompt waiter。
   *
   * @returns Promise<reply> — session.idle 时 resolve 累积 text;timeoutMs 后 reject(或 resolve partial)。
   */
  register(sessionID: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // 已存在的 waiter 先清(罕见情况:同 session 重复 prompt)
      const existing = this.waiters.get(sessionID)
      if (existing) {
        clearTimeout(existing.timeoutHandle)
        this.waiters.delete(sessionID)
        existing.reject(new Error("superseded by new prompt on same session"))
      }

      const buffer = new Map<string, string>()
      const partOrder: string[] = []

      const finalize = (kind: "resolve" | "reject", value: string | Error) => {
        const w = this.waiters.get(sessionID)
        if (!w) return
        clearTimeout(w.timeoutHandle)
        this.waiters.delete(sessionID)
        if (kind === "resolve") resolve(value as string)
        else reject(value as Error)
      }

      const timeoutHandle = setTimeout(() => {
        const w = this.waiters.get(sessionID)
        if (!w) return
        const partial = collectText(w)
        if (partial) {
          console.warn(`[dispatcher] timeout for ${sessionID},返 partial`)
          finalize("resolve", partial)
        } else {
          finalize("reject", new Error(`opencode prompt timeout (${timeoutMs}ms)`))
        }
      }, timeoutMs)

      this.waiters.set(sessionID, {
        buffer,
        partOrder,
        resolve: (reply) => finalize("resolve", reply),
        reject: (err) => finalize("reject", err),
        timeoutHandle,
      })
    })
  }

  /**
   * 把 opencode event 路由到对应 sessionID 的 waiter。
   *
   * 不属于任何 waiter 的 event 静默丢弃(plugin 拿到所有 events,不只我们触发的)。
   *
   * v1 event 形状对齐(`@opencode-ai/sdk` Event union):
   *   - `message.part.updated`:`properties.part.sessionID` + `properties.part.id`
   *     + `properties.part.text`(cumulative,文本类 part)+ optional `properties.delta`(增量)
   *   - `session.idle`:`properties.sessionID`
   *   - `session.error`:`properties.sessionID` + `error`
   */
  dispatch(event: OpencodeEventLike): void {
    if (event.type === "message.part.updated") {
      const p = event.properties as
        | {
            part?: { id?: string; sessionID?: string; type?: string; text?: string }
            delta?: string
          }
        | undefined
      const part = p?.part
      const sid = part?.sessionID
      if (!sid) return
      const w = this.waiters.get(sid)
      if (!w) return
      if (part.type !== "text") return
      const partID = part.id
      if (!partID) return
      // v1 message.part.updated 的 part.text 是 cumulative(覆盖)
      if (typeof part.text === "string") {
        if (!w.buffer.has(partID)) {
          w.partOrder.push(partID)
        }
        w.buffer.set(partID, part.text)
      } else if (typeof p?.delta === "string") {
        // 兼容增量风格(如有)
        if (!w.buffer.has(partID)) {
          w.buffer.set(partID, "")
          w.partOrder.push(partID)
        }
        w.buffer.set(partID, (w.buffer.get(partID) ?? "") + p.delta)
      }
      return
    }

    // session.idle / session.error 路由 by properties.sessionID
    const props = event.properties as { sessionID?: string } | undefined
    const sessionID = props?.sessionID
    if (!sessionID) return
    const w = this.waiters.get(sessionID)
    if (!w) return

    if (event.type === "session.idle") {
      w.resolve(collectText(w))
      return
    }
    if (event.type === "session.error") {
      const p = event.properties as { error?: { message?: string } }
      w.reject(new Error(p.error?.message ?? "opencode session error"))
      return
    }
  }

  /** 当前活跃 waiter 数 */
  get pending(): number {
    return this.waiters.size
  }

  /** 清所有 waiter(plugin 卸载时用) */
  abortAll(): void {
    for (const [, w] of this.waiters) {
      clearTimeout(w.timeoutHandle)
      w.reject(new Error("dispatcher aborted"))
    }
    this.waiters.clear()
  }
}

function collectText(w: Waiter): string {
  return w.partOrder
    .map((id) => w.buffer.get(id) ?? "")
    .filter((t) => t.length > 0)
    .join("\n")
    .trim()
}

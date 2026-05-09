// [fork-only] PromptDispatcher — opencode plugin event hook ↔ pipeline waiter 桥梁
// [feat: feishu-bridge] 2026-05-08
//
// plugin 注册 `event` hook 后,所有 opencode events 都通过 hook 推过来。
// 每个进行中的 prompt 注册一个 waiter,dispatcher 按 sessionID 路由 events
// 到对应 waiter,累积 message.part.delta(text)token,session.idle 时 resolve。
//
// !! 已知 bug(2026-05-09 待修)— 此累积也包括 user message 自己 prompt 的 text part,
// 导致 reply echo user 自己的输入。修复需要按 message role 区分,留 followup commit。
// 短期:接受 echo,以确保 user 至少能看到 reply(总比 empty reply 好)。

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
        if (!w.buffer.has(partID)) {
          w.buffer.set(partID, "")
          w.partOrder.push(partID)
        }
        w.buffer.set(partID, (w.buffer.get(partID) ?? "") + p.delta)
      }
      return
    }

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

  get pending(): number {
    return this.waiters.size
  }

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

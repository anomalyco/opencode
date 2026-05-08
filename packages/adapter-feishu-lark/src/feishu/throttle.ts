// [fork-only] FlushController — CardKit / Patch 双路径节流(spec G3)
// [feat: feishu-bridge] 2026-05-08
//
// 飞书消息流式更新场景:opencode 流式 token 高频(数十次/秒)进来,飞书 API
// 接受不了如此高频。本控制器按"双路径 + long-gap"策略聚合:
//
//   - **CardKit 路径**(initial,首次发送占位卡片):interval 100ms 快速首响应
//   - **Patch 路径**(已发出 → 后续 update):interval 1500ms 降频
//   - **long-gap 检测**:距上次 flush > longGapMs 时,新 token 立即 flush
//     (LLM 卡 tool 调用 N 秒没新 token,期间积累的内容应立即推,不再等 1500ms)
//
// 互斥:flush 进行中再来的 push 不开新 timer,等本次 flush 完成后回检 buffer。

export interface FlushControllerOptions {
  /** CardKit 首次发送 interval(ms),默认 100 */
  cardkitIntervalMs?: number
  /** Patch 后续更新 interval(ms),默认 1500 */
  patchIntervalMs?: number
  /** Long-gap 阈值(ms),超此值新 push 立即 flush,默认 30_000 */
  longGapMs?: number
}

export type FlushMode = "cardkit" | "patch"

/** 实际推送函数 — 调用方注入(写飞书 API)*/
export type Flusher = (content: string, mode: FlushMode) => Promise<void>

interface FlushControllerState {
  buffer: string
  hasInitialCard: boolean
  lastFlushedAt: number
  /** 'idle' | 'scheduled' | 'flushing' */
  phase: "idle" | "scheduled" | "flushing"
  timer: ReturnType<typeof setTimeout> | null
  /** 已 dispose,后续 push 静默丢弃 */
  disposed: boolean
}

export class FlushController {
  private readonly opts: Required<FlushControllerOptions>
  private readonly state: FlushControllerState
  private readonly flusher: Flusher

  constructor(flusher: Flusher, options: FlushControllerOptions = {}) {
    this.opts = {
      cardkitIntervalMs: options.cardkitIntervalMs ?? 100,
      patchIntervalMs: options.patchIntervalMs ?? 1500,
      longGapMs: options.longGapMs ?? 30_000,
    }
    this.flusher = flusher
    this.state = {
      buffer: "",
      hasInitialCard: false,
      lastFlushedAt: 0,
      phase: "idle",
      timer: null,
      disposed: false,
    }
  }

  /** 累积内容到 buffer + 调度 flush */
  push(content: string): void {
    if (this.state.disposed) return
    this.state.buffer += content
    this.schedule()
  }

  /** 立即 flush(强制,忽略 interval)— 通常在 LLM 完成时调一次保尾 */
  async flushNow(): Promise<void> {
    if (this.state.disposed) return
    this.cancelTimer()
    await this.doFlush()
  }

  /** 销毁:清 timer,后续 push 静默丢弃。**不**自动 flush 残余 buffer */
  dispose(): void {
    this.cancelTimer()
    this.state.disposed = true
  }

  /** 当前 buffer 大小 */
  get pending(): number {
    return this.state.buffer.length
  }

  /** 已发送过首张卡片 */
  get hasFirstCard(): boolean {
    return this.state.hasInitialCard
  }

  // ============================================================
  // 内部
  // ============================================================

  private schedule(): void {
    if (this.state.phase === "flushing") {
      // 进行中,等本次 flush 完会回检 buffer
      return
    }
    if (this.state.phase === "scheduled") {
      // 已经有 timer 在排队
      return
    }

    const now = Date.now()
    const gap = now - this.state.lastFlushedAt

    // long-gap:距上次 flush 太久,且确实有过 flush(lastFlushedAt > 0)
    // → 立即 flush
    if (
      this.state.lastFlushedAt > 0 &&
      gap > this.opts.longGapMs
    ) {
      void this.doFlush().catch((err) => this.onAutoFlushError(err))
      return
    }

    const interval = this.state.hasInitialCard
      ? this.opts.patchIntervalMs
      : this.opts.cardkitIntervalMs

    this.state.phase = "scheduled"
    this.state.timer = setTimeout(() => {
      void this.doFlush().catch((err) => this.onAutoFlushError(err))
    }, interval)
  }

  /**
   * 内部 timer / long-gap 触发的 flush 失败:silent(避免 unhandled rejection),
   * 内容已通过 doFlush 的 finally 回填 buffer,下次 push / flushNow 自然重试。
   * flushNow 显式调用的失败才直接冒泡给调用方。
   */
  private onAutoFlushError(err: unknown): void {
    console.warn("[FlushController] auto-flush failed:", err)
  }

  private async doFlush(): Promise<void> {
    if (this.state.buffer.length === 0) {
      this.state.phase = "idle"
      return
    }
    if (this.state.phase === "flushing") {
      return // 重入保护
    }

    const content = this.state.buffer
    this.state.buffer = ""
    this.cancelTimer()
    this.state.phase = "flushing"

    const mode: FlushMode = this.state.hasInitialCard ? "patch" : "cardkit"

    try {
      await this.flusher(content, mode)
      this.state.hasInitialCard = true
      this.state.lastFlushedAt = Date.now()
    } catch (err) {
      // flusher 抛错:回填内容到 buffer 头部(下次重试)+ 透传错误给调用方
      // 注意:已经被处理过的 content 整体回填,可能造成局部重复推送 —
      // 调用方可在 flusher 内部做幂等 / 或 wrap 失败处理
      this.state.buffer = content + this.state.buffer
      throw err
    } finally {
      this.state.phase = "idle"
      // 在 flush 期间又来了新内容 → 调度下次
      if (this.state.buffer.length > 0 && !this.state.disposed) {
        this.schedule()
      }
    }
  }

  private cancelTimer(): void {
    if (this.state.timer) {
      clearTimeout(this.state.timer)
      this.state.timer = null
    }
    if (this.state.phase === "scheduled") {
      this.state.phase = "idle"
    }
  }
}

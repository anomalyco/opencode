// [fork-only] ChatQueue — 同会话串行,不同会话并行(spec G3 / Phase 2)
// [feat: feishu-bridge] 2026-05-08
//
// 飞书消息处理场景:同一 chat 内的消息必须**严格按到达顺序**处理(用户连发"问 A"
// "再问 B" → 必须 A 完成响应再处 B,否则 LLM 上下文乱),不同 chat 之间则**并行**
// (避免一个 slow chat 拖垮所有人)。
//
// 实现:Map<chatKey, Promise> 链式追加。每个 chat 维护一条 promise chain,
// enqueue 时把新 task .then() 到链尾;链尾完成时若仍是自己则清理 map。
//
// 参考:OpenClaw chatQueue ~68 行实现(plan §C2.4 出处)。

export class ChatQueue {
  private readonly chains = new Map<string, Promise<unknown>>()

  /**
   * 排队任务到 key 对应的 chat。
   *
   * - 同 key 新任务等前一个完成才跑(无论前者 success / fail,链不断)
   * - 不同 key 完全独立
   *
   * @returns task 自身的 promise(reject 时调用方收到错误)
   */
  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve()
    // 链不断:前一个无论成败都跑下一个 task
    const next = prev.then(
      () => task(),
      () => task(),
    )

    // 链尾追踪用 promise(swallow 错误,不污染 chain 链)
    const tracked: Promise<unknown> = next.then(
      () => undefined,
      () => undefined,
    )
    this.chains.set(key, tracked)

    // tracked 结束后,如果链尾仍是自己 → 清理 map(防内存泄漏)
    void tracked.finally(() => {
      if (this.chains.get(key) === tracked) {
        this.chains.delete(key)
      }
    })

    return next
  }

  /**
   * 等单个 key / 所有 key 完成。
   *
   * @param key 指定 key 等;省 = 全部
   */
  async drain(key?: string): Promise<void> {
    if (key !== undefined) {
      const chain = this.chains.get(key)
      if (chain) {
        await chain
      }
      return
    }
    // 全部 — 取快照,避免迭代时 map 变化
    const snapshot = Array.from(this.chains.values())
    if (snapshot.length === 0) return
    await Promise.all(snapshot)
  }

  /** 当前活跃 chat 数(链未空的 key 数) */
  get size(): number {
    return this.chains.size
  }

  /** 是否有任何 key 在 pending */
  get isEmpty(): boolean {
    return this.chains.size === 0
  }
}

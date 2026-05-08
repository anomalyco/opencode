// [fork-only] DedupCache — 消息去重 TTL Map(spec G3 / Phase 2)
// [feat: feishu-bridge] 2026-05-08
//
// 用途:WSS 长连接断线重连后,飞书会重放未确认的消息。本 cache 用 msgId+ts 作 key,
// 已处理过的消息再来时跳过,避免双响应。
//
// 设计:
//   - 默认 ttlMs = 12h(spec 推荐)
//   - 默认 maxEntries = 5000(防内存膨胀)
//   - LRU 淘汰:超 maxEntries 删最早插入(Map insertion order)
//   - lazy 过期:has / hasAndMark 检查时如已过期 → 删 + 返 false
//
// 不内置定时器 GC — lazy expire 配合 LRU 淘汰已足够,且省 timer。

export interface DedupCacheOptions {
  /** TTL 毫秒,默认 12h = 43_200_000 */
  ttlMs?: number
  /** 最大 entries 数,默认 5000 */
  maxEntries?: number
}

interface Entry {
  expireAt: number
}

export class DedupCache {
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly map = new Map<string, Entry>()

  constructor(options: DedupCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 12 * 60 * 60 * 1000
    this.maxEntries = options.maxEntries ?? 5000
    if (this.maxEntries < 1) {
      throw new Error("DedupCache: maxEntries must be >= 1")
    }
  }

  /**
   * 标记 key 已处理。已存在则刷新 TTL(LRU touch)。
   *
   * 超 maxEntries 时淘汰最早插入(Map insertion order 头部)。
   */
  mark(key: string): void {
    // LRU touch:删后 set 让其位置移到 Map 末尾(最新)
    if (this.map.has(key)) {
      this.map.delete(key)
    }
    this.map.set(key, { expireAt: Date.now() + this.ttlMs })

    // LRU 淘汰
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  /**
   * 是否已处理过(且未过期)。lazy 删过期 entry。
   */
  has(key: string): boolean {
    const entry = this.map.get(key)
    if (!entry) return false
    if (entry.expireAt <= Date.now()) {
      this.map.delete(key)
      return false
    }
    return true
  }

  /**
   * 原子 check-and-mark:返之前是否已存在(已处理过)。
   * 是 → return true(调用方应跳过此消息);否 → mark + return false。
   *
   * 这是 dedup 的标准用法 — 一次调用代替 has + mark 两步,避免竞态。
   */
  hasAndMark(key: string): boolean {
    const seen = this.has(key)
    this.mark(key) // 无论 seen 与否都 mark(seen 时是 LRU touch)
    return seen
  }

  /** 当前 entries 数(含尚未过期清理)。size 不主动 GC,仅返 Map.size */
  get size(): number {
    return this.map.size
  }

  /** 清空 */
  clear(): void {
    this.map.clear()
  }
}

/**
 * 工具:把飞书事件的 (messageId, eventTime) 拼成 dedup key。
 *
 * eventTime 用来防 messageId 偶发碰撞(理论上不应该,但防御性处理)。
 */
export function makeDedupKey(messageId: string, eventTime: number | string): string {
  return `${messageId}:${eventTime}`
}

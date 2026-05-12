// [fork-only] DedupCache — 消息去重 TTL Map(spec G3 / Phase 2)
// [feat: feishu-bridge] 2026-05-08
// [feat: dedup-cache-persist] 2026-05-12 — 加 persistPath option 让 sidecar 重启后能识别之前 mark 的 key
//
// 用途:WSS 长连接断线重连后,飞书会重放未确认的消息。本 cache 用 msgId+ts 作 key,
// 已处理过的消息再来时跳过,避免双响应。
//
// 设计:
//   - 默认 ttlMs = 12h(spec 推荐)
//   - 默认 maxEntries = 5000(防内存膨胀)
//   - LRU 淘汰:超 maxEntries 删最早插入(Map insertion order)
//   - lazy 过期:has / hasAndMark 检查时如已过期 → 删 + 返 false
//   - **可选持久化**:配 persistPath 时启动 load + mark 时 debounce 100ms flush;
//     sidecar 重启后老 message_id 仍能识别,防飞书 WSS 重连 server 重推过期 message。
//
// 不内置定时器 GC — lazy expire 配合 LRU 淘汰已足够,且省 timer。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export interface DedupCacheOptions {
  /** TTL 毫秒,默认 12h = 43_200_000 */
  ttlMs?: number
  /** 最大 entries 数,默认 5000 */
  maxEntries?: number
  /** 可选:持久化到此文件路径(JSON);sidecar 重启时 load 防失忆。
   *  flush 用 100ms debounce 防高频写。过期 entry 不写出。 */
  persistPath?: string
  /** flush debounce 毫秒(测试可调小);默认 100ms */
  flushDebounceMs?: number
}

interface Entry {
  expireAt: number
}

export class DedupCache {
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly map = new Map<string, Entry>()
  private readonly persistPath: string | undefined
  private readonly flushDebounceMs: number
  private flushTimer: ReturnType<typeof setTimeout> | undefined

  constructor(options: DedupCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 12 * 60 * 60 * 1000
    this.maxEntries = options.maxEntries ?? 5000
    if (this.maxEntries < 1) {
      throw new Error("DedupCache: maxEntries must be >= 1")
    }
    this.persistPath = options.persistPath
    this.flushDebounceMs = options.flushDebounceMs ?? 100
    if (this.persistPath) this.loadFromDisk()
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

    // 持久化:debounce 100ms flush
    if (this.persistPath) this.scheduleFlush()
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

  /** 清空(也会清掉落盘内容,若有)*/
  clear(): void {
    this.map.clear()
    if (this.persistPath) this.scheduleFlush()
  }

  // ─── 持久化(可选)─────────────────────────────────────────────

  /** 立即 flush(不等 debounce);测试 / 优雅退出时用。 */
  flushNow(): void {
    if (!this.persistPath) return
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    try {
      const now = Date.now()
      const out: Record<string, number> = {}
      for (const [k, e] of this.map.entries()) {
        if (e.expireAt > now) out[k] = e.expireAt // 过期项不写出
      }
      const tmp = `${this.persistPath}.tmp`
      mkdirSync(dirname(this.persistPath), { recursive: true })
      writeFileSync(tmp, JSON.stringify(out), { encoding: "utf-8" })
      // 原子 rename 防部分写
      renameSync(tmp, this.persistPath)
    } catch (err) {
      // 落盘失败不阻断 dedup 内存功能(下次 sidecar 重启会失忆,但当前 session 仍 OK)
      console.warn(`[dedup] persist flush failed: ${(err as Error).message}`)
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flushNow()
    }, this.flushDebounceMs)
    // node setTimeout 默认 keep process alive — wss 模式 fine
    // 测试场景可调 flushDebounceMs=10 + flushNow() 强制同步
  }

  private loadFromDisk(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return
    try {
      const raw = readFileSync(this.persistPath, "utf-8")
      const data = JSON.parse(raw) as Record<string, number>
      const now = Date.now()
      let loaded = 0
      for (const [k, expireAt] of Object.entries(data)) {
        if (typeof expireAt === "number" && expireAt > now) {
          this.map.set(k, { expireAt }) // 保留原 expireAt,不重置 TTL
          loaded++
        }
      }
      // 触发 LRU 淘汰(若 load 后超 maxEntries — 罕见,但防御)
      while (this.map.size > this.maxEntries) {
        const oldest = this.map.keys().next().value
        if (oldest === undefined) break
        this.map.delete(oldest)
      }
      if (loaded > 0) {
        console.log(`[dedup] loaded ${loaded} entries from ${this.persistPath}`)
      }
    } catch (err) {
      // corrupt JSON 或 IO 错 → 当作空 cache 启动(不阻断 sidecar)
      console.warn(`[dedup] persist load failed (starting empty): ${(err as Error).message}`)
    }
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

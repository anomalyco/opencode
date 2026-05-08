// [fork-only] DedupCache 单测
// [feat: feishu-bridge] 2026-05-08

import { describe, expect, test } from "bun:test"
import { DedupCache, makeDedupKey } from "../dedup"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ============================================================
// 基础 mark + has
// ============================================================

describe("基础 mark + has", () => {
  test("mark 后 has → true", () => {
    const c = new DedupCache()
    expect(c.has("k1")).toBe(false)
    c.mark("k1")
    expect(c.has("k1")).toBe(true)
  })

  test("未 mark 的 key has → false", () => {
    const c = new DedupCache()
    expect(c.has("nonexistent")).toBe(false)
  })

  test("size 反映 mark 数", () => {
    const c = new DedupCache()
    expect(c.size).toBe(0)
    c.mark("a")
    c.mark("b")
    c.mark("c")
    expect(c.size).toBe(3)
  })

  test("clear 清空 size 归 0", () => {
    const c = new DedupCache()
    c.mark("a")
    c.mark("b")
    c.clear()
    expect(c.size).toBe(0)
    expect(c.has("a")).toBe(false)
  })

  test("重复 mark 不增加 size(LRU touch)", () => {
    const c = new DedupCache()
    c.mark("a")
    c.mark("a")
    c.mark("a")
    expect(c.size).toBe(1)
  })
})

// ============================================================
// TTL 过期
// ============================================================

describe("TTL 过期", () => {
  test("ttlMs 后 has → false + 自动从 map 删除", async () => {
    const c = new DedupCache({ ttlMs: 20 })
    c.mark("expired-soon")
    expect(c.has("expired-soon")).toBe(true)
    await sleep(40)
    expect(c.has("expired-soon")).toBe(false)
    // lazy 删除 → size 归 0
    expect(c.size).toBe(0)
  })

  test("mark 刷新 TTL", async () => {
    const c = new DedupCache({ ttlMs: 30 })
    c.mark("refresh-me")
    await sleep(20) // 还没过期
    c.mark("refresh-me") // 刷新
    await sleep(20) // 距 mark 又过 20ms,但距刷新只 20ms
    expect(c.has("refresh-me")).toBe(true)
  })

  test("过期前后 size 行为", async () => {
    const c = new DedupCache({ ttlMs: 15 })
    c.mark("a")
    c.mark("b")
    expect(c.size).toBe(2)
    await sleep(30)
    // size 不主动 GC,但 has 调用会 lazy 删
    c.has("a") // 触发 lazy 删
    expect(c.size).toBe(1)
    c.has("b")
    expect(c.size).toBe(0)
  })
})

// ============================================================
// LRU 淘汰
// ============================================================

describe("LRU 淘汰", () => {
  test("超 maxEntries 时淘汰最早插入", () => {
    const c = new DedupCache({ maxEntries: 3 })
    c.mark("a")
    c.mark("b")
    c.mark("c")
    expect(c.size).toBe(3)
    c.mark("d") // 超出,淘汰 a
    expect(c.size).toBe(3)
    expect(c.has("a")).toBe(false)
    expect(c.has("b")).toBe(true)
    expect(c.has("c")).toBe(true)
    expect(c.has("d")).toBe(true)
  })

  test("LRU touch:重 mark 把 key 推到尾,不被淘汰", () => {
    const c = new DedupCache({ maxEntries: 3 })
    c.mark("a")
    c.mark("b")
    c.mark("c")
    c.mark("a") // touch a → a 推到尾,b 变最早
    c.mark("d") // 淘汰 b(不是 a)
    expect(c.has("a")).toBe(true)
    expect(c.has("b")).toBe(false)
    expect(c.has("c")).toBe(true)
    expect(c.has("d")).toBe(true)
  })

  test("maxEntries=1 边界", () => {
    const c = new DedupCache({ maxEntries: 1 })
    c.mark("a")
    c.mark("b")
    expect(c.size).toBe(1)
    expect(c.has("a")).toBe(false)
    expect(c.has("b")).toBe(true)
  })

  test("maxEntries < 1 throw", () => {
    expect(() => new DedupCache({ maxEntries: 0 })).toThrow(/maxEntries/)
    expect(() => new DedupCache({ maxEntries: -5 })).toThrow(/maxEntries/)
  })
})

// ============================================================
// hasAndMark 原子
// ============================================================

describe("hasAndMark", () => {
  test("首次返 false + 标记", () => {
    const c = new DedupCache()
    expect(c.hasAndMark("k")).toBe(false)
    expect(c.has("k")).toBe(true)
  })

  test("第二次返 true + 仍存在", () => {
    const c = new DedupCache()
    c.hasAndMark("k")
    expect(c.hasAndMark("k")).toBe(true)
  })

  test("过期后再 hasAndMark → 视作首次(false)+ 重新 mark", async () => {
    const c = new DedupCache({ ttlMs: 15 })
    c.hasAndMark("k")
    await sleep(30)
    expect(c.hasAndMark("k")).toBe(false)
    expect(c.has("k")).toBe(true)
  })

  test("hasAndMark 走 LRU touch(seen=true 也刷新 TTL)", async () => {
    const c = new DedupCache({ ttlMs: 30 })
    c.hasAndMark("k") // 首次 mark
    await sleep(20) // 还没过期
    c.hasAndMark("k") // seen=true,但 mark 刷新 TTL
    await sleep(20) // 距首次已 40ms > ttl,但距刷新 20ms < ttl
    expect(c.has("k")).toBe(true)
  })
})

// ============================================================
// makeDedupKey
// ============================================================

describe("makeDedupKey", () => {
  test("拼接 messageId + ts", () => {
    expect(makeDedupKey("msg_abc", 1700000000)).toBe("msg_abc:1700000000")
    expect(makeDedupKey("msg_xyz", "1700000001")).toBe("msg_xyz:1700000001")
  })

  test("不同 ts 同 messageId 算不同 key(防偶发碰撞)", () => {
    const k1 = makeDedupKey("m", 100)
    const k2 = makeDedupKey("m", 200)
    expect(k1).not.toBe(k2)
  })
})

// ============================================================
// 综合
// ============================================================

describe("综合 dedup 场景", () => {
  test("WSS 重放场景:同 msgId 第二次 hasAndMark → 跳过", () => {
    const c = new DedupCache()
    const events = [
      { msgId: "m1", ts: 100, content: "你好" },
      { msgId: "m1", ts: 100, content: "你好" }, // WSS 重放
      { msgId: "m2", ts: 200, content: "再问" },
      { msgId: "m2", ts: 200, content: "再问" }, // WSS 重放
    ]
    const processed: string[] = []
    for (const e of events) {
      const key = makeDedupKey(e.msgId, e.ts)
      if (!c.hasAndMark(key)) {
        processed.push(e.content)
      }
    }
    expect(processed).toEqual(["你好", "再问"])
  })
})

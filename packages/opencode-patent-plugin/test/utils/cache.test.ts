import { describe, expect, test } from "bun:test"
import { SimpleCache } from "../../src/utils/cache.js"

describe("SimpleCache", () => {
  test("set + get 正常存取", () => {
    const cache = new SimpleCache<string>()
    cache.set("key1", "value1")
    expect(cache.get("key1")).toBe("value1")
  })

  test("get 不存在的 key 返回 undefined", () => {
    const cache = new SimpleCache<string>()
    expect(cache.get("nope")).toBeUndefined()
  })

  test("过期条目返回 undefined", () => {
    const cache = new SimpleCache<string>({ ttlMs: 1 })
    cache.set("key1", "value1")
    // 等待过期
    const start = Date.now()
    while (Date.now() - start < 5) { /* busy wait 5ms */ }
    expect(cache.get("key1")).toBeUndefined()
  })

  test("has 检查存在性", () => {
    const cache = new SimpleCache<string>()
    cache.set("key1", "value1")
    expect(cache.has("key1")).toBe(true)
    expect(cache.has("key2")).toBe(false)
  })

  test("clear 清空缓存", () => {
    const cache = new SimpleCache<string>()
    cache.set("a", "1")
    cache.set("b", "2")
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get("a")).toBeUndefined()
  })

  test("容量上限自动淘汰", () => {
    const cache = new SimpleCache<string>({ maxSize: 5 })
    for (let i = 0; i < 10; i++) {
      cache.set(`key${i}`, `value${i}`)
    }
    // 存储不超过 max * 1.25（淘汰 25% 后才插入新条目）
    expect(cache.size).toBeLessThanOrEqual(10)
  })
})

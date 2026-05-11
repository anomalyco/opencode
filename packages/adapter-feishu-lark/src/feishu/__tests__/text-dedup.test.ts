// [fork-only] makeTextDedupKey + DedupCache 集成单测
// [feat: wss-text-dedup] 2026-05-12
//
// 覆盖 wss-client.ts 第二层 text dedup 行为(同 chatId+text 10s 内 skip)。
// makeTextDedupKey 是纯函数,DedupCache 已有 19 个单测 — 这里测两者合用。

import { describe, expect, test } from "bun:test"
import { DedupCache } from "../dedup"
import { makeTextDedupKey } from "../wss-client"

describe("makeTextDedupKey — 纯函数", () => {
  test("text 消息正常 → 返 chatId::text 格式 key", () => {
    const k = makeTextDedupKey("text", "oc_aaa", JSON.stringify({ text: "hello" }))
    expect(k).toBe("oc_aaa::hello")
  })

  test("text 前后空白 trim", () => {
    const k = makeTextDedupKey("text", "oc_aaa", JSON.stringify({ text: "  hello  " }))
    expect(k).toBe("oc_aaa::hello")
  })

  test("text 中间空白保留", () => {
    const k = makeTextDedupKey("text", "oc_aaa", JSON.stringify({ text: "hello world  foo" }))
    expect(k).toBe("oc_aaa::hello world  foo")
  })

  test("不同 chatId 给同 text → 不同 key", () => {
    const a = makeTextDedupKey("text", "oc_aaa", JSON.stringify({ text: "ping" }))
    const b = makeTextDedupKey("text", "oc_bbb", JSON.stringify({ text: "ping" }))
    expect(a).not.toBe(b)
  })

  test("messageType=image → 返 null(不走 text dedup)", () => {
    const k = makeTextDedupKey("image", "oc_aaa", JSON.stringify({ image_key: "xxx" }))
    expect(k).toBe(null)
  })

  test("messageType=file → 返 null", () => {
    expect(makeTextDedupKey("file", "oc_aaa", "{}")).toBe(null)
  })

  test("messageType=sticker → 返 null", () => {
    expect(makeTextDedupKey("sticker", "oc_aaa", "{}")).toBe(null)
  })

  test("content 不是 JSON → 返 null(防御性)", () => {
    const k = makeTextDedupKey("text", "oc_aaa", "not-json-content")
    expect(k).toBe(null)
  })

  test("content 是 JSON 但没 text 字段 → 返 null", () => {
    const k = makeTextDedupKey("text", "oc_aaa", JSON.stringify({ other: "field" }))
    expect(k).toBe(null)
  })

  test("text 字段空字符串 → 返 null", () => {
    const k = makeTextDedupKey("text", "oc_aaa", JSON.stringify({ text: "" }))
    expect(k).toBe(null)
  })

  test("text 全是空白 trim 后空 → 返 null", () => {
    const k = makeTextDedupKey("text", "oc_aaa", JSON.stringify({ text: "    " }))
    expect(k).toBe(null)
  })
})

describe("makeTextDedupKey + DedupCache 集成 — 模拟 wss handler 路径", () => {
  test("同 chat 同 text 10s 内重复 → 第二条 skip", () => {
    const cache = new DedupCache({ ttlMs: 10_000 })
    const event = { chatId: "oc_aaa", text: "看 ~/.ssh/known_hosts" }
    const content = JSON.stringify({ text: event.text })

    const k1 = makeTextDedupKey("text", event.chatId, content)!
    expect(cache.hasAndMark(k1)).toBe(false) // 首次,不 skip

    const k2 = makeTextDedupKey("text", event.chatId, content)!
    expect(k1).toBe(k2)
    expect(cache.hasAndMark(k2)).toBe(true) // 第二次,skip ✅
  })

  test("同 chat 不同 text → 不 skip", () => {
    const cache = new DedupCache({ ttlMs: 10_000 })
    const k1 = makeTextDedupKey("text", "oc_aaa", JSON.stringify({ text: "你好" }))!
    const k2 = makeTextDedupKey("text", "oc_aaa", JSON.stringify({ text: "再见" }))!

    expect(cache.hasAndMark(k1)).toBe(false)
    expect(cache.hasAndMark(k2)).toBe(false) // 不同 text,不 skip ✅
  })

  test("不同 chat 同 text → 不 skip", () => {
    const cache = new DedupCache({ ttlMs: 10_000 })
    const content = JSON.stringify({ text: "ping" })
    const k1 = makeTextDedupKey("text", "oc_aaa", content)!
    const k2 = makeTextDedupKey("text", "oc_bbb", content)!

    expect(cache.hasAndMark(k1)).toBe(false)
    expect(cache.hasAndMark(k2)).toBe(false) // 不同 chat,不 skip ✅
  })

  test("TTL 过期后同 chat 同 text → 不 skip(允许 user 主动重发)", async () => {
    const cache = new DedupCache({ ttlMs: 50 }) // 50ms 模拟过期
    const k1 = makeTextDedupKey("text", "oc_aaa", JSON.stringify({ text: "ping" }))!
    expect(cache.hasAndMark(k1)).toBe(false) // 首次

    // 立即重发 → skip
    expect(cache.hasAndMark(k1)).toBe(true)

    // 等过 TTL
    await new Promise((r) => setTimeout(r, 80))
    expect(cache.hasAndMark(k1)).toBe(false) // 过期了,不 skip ✅
  })

  test("text 消息触发,image 消息绕过 — 不影响后续 text dedup", () => {
    const cache = new DedupCache({ ttlMs: 10_000 })

    // text 消息
    const text1 = makeTextDedupKey("text", "oc_aaa", JSON.stringify({ text: "hi" }))!
    expect(cache.hasAndMark(text1)).toBe(false)

    // image 消息 → returns null,wss handler 跳过 dedup 调用,直接进 pipeline
    const imageKey = makeTextDedupKey("image", "oc_aaa", JSON.stringify({ image_key: "xxx" }))
    expect(imageKey).toBe(null) // image 不进 dedup

    // 再来同 text → skip
    expect(cache.hasAndMark(text1)).toBe(true)
  })
})

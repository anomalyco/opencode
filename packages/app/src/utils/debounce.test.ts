// FORK: debounce helper 单测 [feat: auto-save-debounce-flush] 2026-05-21

import { describe, expect, test } from "bun:test"
import { createDebounced } from "./debounce"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("createDebounced", () => {
  test("trigger 后 delayMs 内不调 fn,delayMs 后调", async () => {
    let count = 0
    const d = createDebounced(() => {
      count++
    }, 100)
    d.trigger()
    expect(count).toBe(0)
    await sleep(50)
    expect(count).toBe(0)
    await sleep(80) // 总 130ms,>100ms
    expect(count).toBe(1)
  })

  test("trigger 多次重置计时器,只最后一次后 delayMs 触发", async () => {
    let count = 0
    const d = createDebounced(() => {
      count++
    }, 100)
    d.trigger()
    await sleep(50)
    d.trigger() // reset
    await sleep(50)
    d.trigger() // reset
    await sleep(50)
    expect(count).toBe(0) // 累计 150ms 但每次 trigger 重置,还没到 100ms
    await sleep(80) // 最后 trigger 后 130ms
    expect(count).toBe(1)
  })

  test("flush 立即执行待执行 fn,清计时器", async () => {
    let count = 0
    const d = createDebounced(() => {
      count++
    }, 100)
    d.trigger()
    expect(count).toBe(0)
    d.flush()
    // flush 后微任务队列执行 void fn(),给一个 microtask 让它跑
    await sleep(0)
    expect(count).toBe(1)
    expect(d.pending()).toBe(false)
    // flush 后 delayMs 不再触发
    await sleep(150)
    expect(count).toBe(1)
  })

  test("flush 无挂起任务时 noop", async () => {
    let count = 0
    const d = createDebounced(() => {
      count++
    }, 100)
    d.flush() // 无挂起
    await sleep(0)
    expect(count).toBe(0)
    expect(d.pending()).toBe(false)
  })

  test("cancel 清计时器不执行", async () => {
    let count = 0
    const d = createDebounced(() => {
      count++
    }, 100)
    d.trigger()
    expect(d.pending()).toBe(true)
    d.cancel()
    expect(d.pending()).toBe(false)
    await sleep(150)
    expect(count).toBe(0)
  })

  test("重复 cancel 安全", async () => {
    let count = 0
    const d = createDebounced(() => {
      count++
    }, 100)
    d.cancel() // 无挂起,no-op
    d.trigger()
    d.cancel()
    d.cancel() // 再 cancel,no-op
    await sleep(150)
    expect(count).toBe(0)
  })

  test("pending() 状态正确反映", async () => {
    const d = createDebounced(() => {}, 100)
    expect(d.pending()).toBe(false)
    d.trigger()
    expect(d.pending()).toBe(true)
    await sleep(150)
    expect(d.pending()).toBe(false) // 触发后清 timer
  })

  test("async fn 不 await(fire-and-forget)", async () => {
    let started = 0
    let finished = 0
    const d = createDebounced(async () => {
      started++
      await sleep(50)
      finished++
    }, 50)
    d.trigger()
    await sleep(60)
    expect(started).toBe(1)
    // finished 可能还没,debounce 不 await
    expect(d.pending()).toBe(false) // timer 已经触发了
    await sleep(80)
    expect(finished).toBe(1)
  })

  test("delayMs=0 edge case — 微任务次拍触发", async () => {
    let count = 0
    const d = createDebounced(() => {
      count++
    }, 0)
    d.trigger()
    expect(count).toBe(0) // 同步未跑
    await sleep(0)
    expect(count).toBe(1)
  })
})

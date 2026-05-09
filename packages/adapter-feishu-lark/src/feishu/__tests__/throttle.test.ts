// [fork-only] FlushController 单测
// [feat: feishu-bridge] 2026-05-08
//
// 用真 timer + 短 interval(测试期 5/15ms),配合 await sleep 验证状态转移。

import { describe, expect, test } from "bun:test"
import { FlushController, type FlushMode } from "../throttle"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface FlushCall {
  content: string
  mode: FlushMode
  ts: number
}

function makeRecorder(opts: { failTimes?: number } = {}) {
  const calls: FlushCall[] = []
  let toFail = opts.failTimes ?? 0
  const flusher = async (content: string, mode: FlushMode) => {
    if (toFail > 0) {
      toFail--
      throw new Error("simulated flush error")
    }
    calls.push({ content, mode, ts: Date.now() })
  }
  return { flusher, calls }
}

// ============================================================
// 基础:单次 push → 一次 cardkit flush
// ============================================================

describe("FlushController 基础", () => {
  test("单次 push → cardkit interval 后 flush(mode=cardkit)", async () => {
    const r = makeRecorder()
    const ctrl = new FlushController(r.flusher, {
      cardkitIntervalMs: 5,
      patchIntervalMs: 100,
    })
    ctrl.push("hello")
    await sleep(20)
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]?.content).toBe("hello")
    expect(r.calls[0]?.mode).toBe("cardkit")
    ctrl.dispose()
  })

  test("第二次 flush 走 patch 路径", async () => {
    const r = makeRecorder()
    const ctrl = new FlushController(r.flusher, {
      cardkitIntervalMs: 5,
      patchIntervalMs: 15,
    })
    ctrl.push("a")
    await sleep(20)
    ctrl.push("b")
    await sleep(40)
    expect(r.calls).toHaveLength(2)
    expect(r.calls[0]?.mode).toBe("cardkit")
    expect(r.calls[1]?.mode).toBe("patch")
    expect(r.calls[1]?.content).toBe("b")
    ctrl.dispose()
  })

  test("初始 hasFirstCard = false,首次 flush 后 = true", async () => {
    const r = makeRecorder()
    const ctrl = new FlushController(r.flusher, { cardkitIntervalMs: 5 })
    expect(ctrl.hasFirstCard).toBe(false)
    ctrl.push("x")
    await sleep(15)
    expect(ctrl.hasFirstCard).toBe(true)
    ctrl.dispose()
  })

  test("pending 反映 buffer 大小", async () => {
    const r = makeRecorder()
    const ctrl = new FlushController(r.flusher, { cardkitIntervalMs: 200 })
    ctrl.push("hello")
    expect(ctrl.pending).toBe(5)
    ctrl.push(" world")
    expect(ctrl.pending).toBe(11)
    ctrl.dispose()
  })
})

// ============================================================
// 累积:多次 push 在一个 interval 内 → 合并为一次 flush
// ============================================================

describe("buffer 累积合并", () => {
  test("interval 内多次 push → 一次 flush 含全部内容", async () => {
    const r = makeRecorder()
    const ctrl = new FlushController(r.flusher, { cardkitIntervalMs: 30 })
    ctrl.push("a")
    ctrl.push("b")
    ctrl.push("c")
    await sleep(50)
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]?.content).toBe("abc")
    ctrl.dispose()
  })

  test("flush 期间到达的 push → 下一次 flush 推", async () => {
    let resolve: (() => void) = () => {}
    const blocking = new Promise<void>((r) => {
      resolve = r
    })
    const calls: FlushCall[] = []
    const flusher = async (content: string, mode: FlushMode) => {
      // 模拟 flush 慢:第一次卡住,第二次秒过
      if (calls.length === 0) {
        await blocking
      }
      calls.push({ content, mode, ts: Date.now() })
    }
    const ctrl = new FlushController(flusher, {
      cardkitIntervalMs: 5,
      patchIntervalMs: 5,
    })
    ctrl.push("first")
    await sleep(15) // 触发第一次 flush(挂起)
    expect(calls).toHaveLength(0)

    ctrl.push("during")
    ctrl.push("-flush")
    expect(calls).toHaveLength(0) // 仍在 flushing

    resolve()
    await sleep(40)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.content).toBe("first")
    expect(calls[1]?.content).toBe("during-flush")
    expect(calls[1]?.mode).toBe("patch") // 第二次走 patch
    ctrl.dispose()
  })
})

// ============================================================
// long-gap:距上次 flush 超阈值 → 立即 flush
// ============================================================

describe("long-gap 立即 flush", () => {
  test("> longGapMs 间隔后 push → 立即 flush(不等 interval)", async () => {
    const r = makeRecorder()
    const ctrl = new FlushController(r.flusher, {
      cardkitIntervalMs: 5,
      patchIntervalMs: 100, // 较长
      longGapMs: 20,
    })
    ctrl.push("first")
    await sleep(15)
    expect(r.calls).toHaveLength(1)

    // 等 30ms(> longGapMs),然后 push
    await sleep(30)
    const t0 = Date.now()
    ctrl.push("after-gap")
    await sleep(10) // 不到 patch interval(100ms),但 long-gap → 立即 flush
    expect(r.calls).toHaveLength(2)
    const elapsed = (r.calls[1]?.ts ?? 0) - t0
    expect(elapsed).toBeLessThan(20) // 立即 flush,远快于 patchIntervalMs
    ctrl.dispose()
  })

  test("首次 push 不触发 long-gap 立即(lastFlushedAt=0)", async () => {
    const r = makeRecorder()
    const ctrl = new FlushController(r.flusher, {
      cardkitIntervalMs: 30,
      longGapMs: 5,
    })
    ctrl.push("first")
    // 不应立即 flush,等满 cardkit interval
    await sleep(10)
    expect(r.calls).toHaveLength(0)
    await sleep(30)
    expect(r.calls).toHaveLength(1)
    ctrl.dispose()
  })
})

// ============================================================
// flushNow 强制
// ============================================================

describe("flushNow 强制", () => {
  test("立即 flush,不等 interval", async () => {
    const r = makeRecorder()
    const ctrl = new FlushController(r.flusher, { cardkitIntervalMs: 1000 })
    ctrl.push("urgent")
    await ctrl.flushNow()
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]?.content).toBe("urgent")
    ctrl.dispose()
  })

  test("buffer 空时 flushNow 不抛 + 不调 flusher", async () => {
    const r = makeRecorder()
    const ctrl = new FlushController(r.flusher, { cardkitIntervalMs: 5 })
    await ctrl.flushNow()
    expect(r.calls).toHaveLength(0)
    ctrl.dispose()
  })
})

// ============================================================
// dispose
// ============================================================

describe("dispose", () => {
  test("dispose 后 push 静默丢弃 + 不 flush", async () => {
    const r = makeRecorder()
    const ctrl = new FlushController(r.flusher, { cardkitIntervalMs: 5 })
    ctrl.dispose()
    ctrl.push("ignored")
    await sleep(20)
    expect(r.calls).toHaveLength(0)
  })

  test("dispose 中断 scheduled timer,buffer 不 flush", async () => {
    const r = makeRecorder()
    const ctrl = new FlushController(r.flusher, { cardkitIntervalMs: 50 })
    ctrl.push("scheduled")
    expect(ctrl.pending).toBe(9)
    ctrl.dispose()
    await sleep(80)
    expect(r.calls).toHaveLength(0)
  })
})

// ============================================================
// flusher 抛错:回填 buffer 给下次重试
// ============================================================

describe("flusher 错误处理", () => {
  test("自动 flush(timer 触发)失败 → 静默重试,buffer 内容不丢", async () => {
    const r = makeRecorder({ failTimes: 1 })
    const ctrl = new FlushController(r.flusher, { cardkitIntervalMs: 5 })
    ctrl.push("retry-me")
    // 第一次 timer flush 失败 → 回填 buffer → 自动 schedule 重试 → 第二次成功
    await sleep(50)
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]?.content).toBe("retry-me")
    expect(ctrl.pending).toBe(0)
    ctrl.dispose()
  })

  test("flushNow 显式调用 → flusher 抛错冒泡给调用方", async () => {
    const r = makeRecorder({ failTimes: 1 })
    const ctrl = new FlushController(r.flusher, { cardkitIntervalMs: 1000 })
    ctrl.push("urgent")
    let caught: unknown = null
    try {
      await ctrl.flushNow()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeTruthy()
    expect((caught as Error).message).toBe("simulated flush error")
    // 内容回填 buffer,下次重试
    expect(ctrl.pending).toBe(6)
    // 现在再 flushNow 不会失败
    await ctrl.flushNow()
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]?.content).toBe("urgent")
    ctrl.dispose()
  })
})

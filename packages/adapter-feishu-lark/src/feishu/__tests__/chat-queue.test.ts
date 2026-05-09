// [fork-only] ChatQueue 单测
// [feat: feishu-bridge] 2026-05-08

import { describe, expect, test } from "bun:test"
import { ChatQueue } from "../chat-queue"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => {}
  let reject: (e: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ============================================================
// 同 key 严格串行
// ============================================================

describe("同 key 串行", () => {
  test("3 任务按 enqueue 顺序串行执行", async () => {
    const q = new ChatQueue()
    const log: string[] = []
    const d1 = deferred<void>()
    const d2 = deferred<void>()
    const d3 = deferred<void>()

    const p1 = q.enqueue("chat-A", async () => {
      log.push("1-start")
      await d1.promise
      log.push("1-end")
    })
    const p2 = q.enqueue("chat-A", async () => {
      log.push("2-start")
      await d2.promise
      log.push("2-end")
    })
    const p3 = q.enqueue("chat-A", async () => {
      log.push("3-start")
      await d3.promise
      log.push("3-end")
    })

    // 还没 resolve 任何 deferred,只有 1 在跑
    await sleep(10)
    expect(log).toEqual(["1-start"])

    d1.resolve()
    await sleep(10)
    expect(log).toEqual(["1-start", "1-end", "2-start"])

    d2.resolve()
    await sleep(10)
    expect(log).toEqual(["1-start", "1-end", "2-start", "2-end", "3-start"])

    d3.resolve()
    await Promise.all([p1, p2, p3])
    expect(log).toEqual([
      "1-start",
      "1-end",
      "2-start",
      "2-end",
      "3-start",
      "3-end",
    ])
  })

  test("task 抛错不阻塞链:后续 task 正常排队", async () => {
    const q = new ChatQueue()
    const log: string[] = []

    const p1 = q.enqueue("chat-A", async () => {
      log.push("1")
      throw new Error("task1 fail")
    })
    const p2 = q.enqueue("chat-A", async () => {
      log.push("2")
    })

    let caught: unknown = null
    try {
      await p1
    } catch (e) {
      caught = e
    }
    await p2

    expect((caught as Error).message).toBe("task1 fail")
    expect(log).toEqual(["1", "2"])
  })
})

// ============================================================
// 不同 key 并行
// ============================================================

describe("不同 key 并行", () => {
  test("两个 chat 同时排,互不阻塞", async () => {
    const q = new ChatQueue()
    const dA = deferred<void>()
    const dB = deferred<void>()
    const log: string[] = []

    const pA = q.enqueue("chat-A", async () => {
      log.push("A-start")
      await dA.promise
      log.push("A-end")
    })
    const pB = q.enqueue("chat-B", async () => {
      log.push("B-start")
      await dB.promise
      log.push("B-end")
    })

    await sleep(10)
    // 两个 chat 同时启动
    expect(log).toEqual(expect.arrayContaining(["A-start", "B-start"]))
    expect(log).toHaveLength(2)

    dB.resolve()
    await sleep(10)
    expect(log).toContain("B-end")
    expect(log).not.toContain("A-end")

    dA.resolve()
    await Promise.all([pA, pB])
    expect(log).toContain("A-end")
  })

  test("3 个 key 各自独立链,共 6 任务交错完成", async () => {
    const q = new ChatQueue()
    const completed: string[] = []
    const promises: Promise<void>[] = []
    for (const k of ["A", "B", "C"]) {
      for (let i = 1; i <= 2; i++) {
        const id = `${k}${i}`
        promises.push(
          q.enqueue(k, async () => {
            await sleep(5 + Math.random() * 5)
            completed.push(id)
          }),
        )
      }
    }
    await Promise.all(promises)
    expect(completed).toHaveLength(6)
    // 同 key 内严格顺序:A1 在 A2 之前
    for (const k of ["A", "B", "C"]) {
      const i1 = completed.indexOf(`${k}1`)
      const i2 = completed.indexOf(`${k}2`)
      expect(i1).toBeLessThan(i2)
    }
  })
})

// ============================================================
// drain
// ============================================================

describe("drain", () => {
  test("drain(key) 等单 key 完成", async () => {
    const q = new ChatQueue()
    const log: string[] = []
    q.enqueue("A", async () => {
      await sleep(15)
      log.push("A1")
    })
    q.enqueue("A", async () => {
      log.push("A2")
    })
    await q.drain("A")
    expect(log).toEqual(["A1", "A2"])
  })

  test("drain() 无参等所有 key", async () => {
    const q = new ChatQueue()
    const log: string[] = []
    q.enqueue("A", async () => {
      await sleep(10)
      log.push("A")
    })
    q.enqueue("B", async () => {
      await sleep(15)
      log.push("B")
    })
    q.enqueue("C", async () => {
      log.push("C")
    })
    await q.drain()
    expect(log).toContain("A")
    expect(log).toContain("B")
    expect(log).toContain("C")
    expect(log).toHaveLength(3)
  })

  test("drain(unknownKey) 立即返回(无报错)", async () => {
    const q = new ChatQueue()
    await q.drain("never-existed")
    // 没抛错即通过
  })

  test("drain() 空 queue 立即返回", async () => {
    const q = new ChatQueue()
    await q.drain()
  })
})

// ============================================================
// size + isEmpty + 自动清理
// ============================================================

describe("size / isEmpty / 清理", () => {
  test("空队列 size=0 isEmpty=true", () => {
    const q = new ChatQueue()
    expect(q.size).toBe(0)
    expect(q.isEmpty).toBe(true)
  })

  test("enqueue 后 size 反映活跃 chat 数", async () => {
    const q = new ChatQueue()
    const dA = deferred<void>()
    const dB = deferred<void>()
    q.enqueue("A", () => dA.promise)
    q.enqueue("B", () => dB.promise)
    expect(q.size).toBe(2)
    expect(q.isEmpty).toBe(false)

    dA.resolve()
    await q.drain("A")
    expect(q.size).toBe(1)

    dB.resolve()
    await q.drain()
    expect(q.size).toBe(0)
    expect(q.isEmpty).toBe(true)
  })

  test("链尾完成后自动从 map 清理(不泄漏)", async () => {
    const q = new ChatQueue()
    for (let i = 0; i < 50; i++) {
      await q.enqueue(`temp-${i}`, async () => {
        // 立即完成
      })
    }
    // 等微任务跑完(finally 触发清理)
    await sleep(20)
    expect(q.size).toBe(0)
  })

  test("链中间任务完成不清理(尾还活着)", async () => {
    const q = new ChatQueue()
    const d1 = deferred<void>()
    const d2 = deferred<void>()
    q.enqueue("A", () => d1.promise)
    q.enqueue("A", () => d2.promise)
    // 第一个完成
    d1.resolve()
    await sleep(10)
    expect(q.size).toBe(1) // 第二个还在跑

    d2.resolve()
    await sleep(10)
    expect(q.size).toBe(0)
  })
})

// ============================================================
// 返回值
// ============================================================

describe("返回值传递", () => {
  test("enqueue 返 task resolve 值", async () => {
    const q = new ChatQueue()
    const r1 = await q.enqueue("A", async () => 42)
    expect(r1).toBe(42)
    const r2 = await q.enqueue("A", async () => "hello")
    expect(r2).toBe("hello")
  })
})

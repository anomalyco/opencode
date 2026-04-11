import { describe, test, expect } from "bun:test"

const MB = 1024 * 1024
const getHeapMB = () => {
  Bun.gc(true)
  return process.memoryUsage().heapUsed / MB
}

describe("memory: abort controller leak", () => {
  test("compare closure vs bind pattern directly", async () => {
    const ITERATIONS = 500

    // Test OLD pattern: arrow function closure
    // Store closures in a map keyed by content to force retention
    const closureMap = new Map<string, () => void>()
    const timers: Timer[] = []
    const controllers: AbortController[] = []

    Bun.gc(true)
    Bun.sleepSync(100)
    const baseline = getHeapMB()

    for (let i = 0; i < ITERATIONS; i++) {
      // Simulate large response body like webfetch would have
      const content = `${i}:${"x".repeat(50 * 1024)}` // 50KB unique per iteration
      const controller = new AbortController()
      controllers.push(controller)

      // OLD pattern - closure captures `content`
      const handler = () => {
        // Actually use content so it can't be optimized away
        if (content.length > 1000000000) controller.abort()
      }
      closureMap.set(content, handler)
      const timeoutId = setTimeout(handler, 30000)
      timers.push(timeoutId)
    }

    Bun.gc(true)
    Bun.sleepSync(100)
    const after = getHeapMB()
    const oldGrowth = after - baseline

    console.log(`OLD pattern (closure): ${oldGrowth.toFixed(2)} MB growth (${closureMap.size} closures)`)

    // Cleanup after measuring
    timers.forEach(clearTimeout)
    controllers.forEach((c) => c.abort())
    closureMap.clear()

    // Test NEW pattern: bind
    Bun.gc(true)
    Bun.sleepSync(100)
    const baseline2 = getHeapMB()
    const handlers2: (() => void)[] = []
    const timers2: Timer[] = []
    const controllers2: AbortController[] = []

    for (let i = 0; i < ITERATIONS; i++) {
      const _content = `${i}:${"x".repeat(50 * 1024)}` // 50KB - won't be captured
      const controller = new AbortController()
      controllers2.push(controller)

      // NEW pattern - bind doesn't capture surrounding scope
      const handler = controller.abort.bind(controller)
      handlers2.push(handler)
      const timeoutId = setTimeout(handler, 30000)
      timers2.push(timeoutId)
    }

    Bun.gc(true)
    Bun.sleepSync(100)
    const after2 = getHeapMB()
    const newGrowth = after2 - baseline2

    // Cleanup after measuring
    timers2.forEach(clearTimeout)
    controllers2.forEach((c) => c.abort())
    handlers2.length = 0

    console.log(`NEW pattern (bind): ${newGrowth.toFixed(2)} MB growth`)
    console.log(`Improvement: ${(oldGrowth - newGrowth).toFixed(2)} MB saved`)

    expect(newGrowth).toBeLessThanOrEqual(oldGrowth)
  })
})

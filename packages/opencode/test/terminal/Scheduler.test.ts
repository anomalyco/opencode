import { test, expect, afterEach } from "bun:test"
import { Scheduler } from "@/terminal/app/Scheduler"

let scheduler: Scheduler | null = null

afterEach(() => {
  scheduler?.stop()
  scheduler = null
})

test("requestFrame schedules a render callback", async () => {
  scheduler = new Scheduler()
  let rendered = false
  scheduler.onRender(() => { rendered = true })
  scheduler.start()
  scheduler.requestFrame()

  await new Promise((r) => setTimeout(r, 10))
  expect(rendered).toBe(true)
})

test("zero-work frame — no render when nothing dirty", async () => {
  scheduler = new Scheduler()
  let callCount = 0
  scheduler.onRender(() => { callCount++; return true })
  scheduler.start()

  await new Promise((r) => setTimeout(r, 20))
  expect(callCount).toBe(0)
})

test("pauses on backpressure (render returns false), resumes on drain", async () => {
  scheduler = new Scheduler()
  let callCount = 0
  scheduler.onRender(() => {
    callCount++
    return false
  })
  scheduler.start()
  scheduler.requestFrame()

  await new Promise((r) => setTimeout(r, 10))
  expect(scheduler.isPaused).toBe(true)
  expect(callCount).toBe(1)

  process.stdout.emit("drain")
  await new Promise((r) => setTimeout(r, 10))
  expect(scheduler.isPaused).toBe(false)
})

test("no crash calling requestFrame before start", () => {
  scheduler = new Scheduler()
  scheduler.requestFrame()
})

test("no crash calling requestFrame after stop", () => {
  scheduler = new Scheduler()
  scheduler.start()
  scheduler.stop()
  scheduler.requestFrame()
})

test("[real-time] zero CPU when idle after render", async () => {
  scheduler = new Scheduler()
  let frameCount = 0
  scheduler.onRender(() => { frameCount++; return false })
  scheduler.start()
  scheduler.requestFrame()
  await new Promise(r => setTimeout(r, 200))

  const startUsage = process.cpuUsage()
  const wallStart = Date.now()
  await new Promise(r => setTimeout(r, 3000))
  const elapsed = Date.now() - wallStart
  const usage = process.cpuUsage(startUsage)
  const totalUs = usage.user + usage.system
  const totalMs = totalUs / 1000
  const pct = (totalMs / elapsed) * 100

  console.log(`[idle] ${elapsed}ms wall, ${totalUs}µs CPU (${pct.toFixed(4)}%), ${frameCount} frame(s)`)
  expect(pct).toBeLessThan(5)
  expect(frameCount).toBe(1)
})

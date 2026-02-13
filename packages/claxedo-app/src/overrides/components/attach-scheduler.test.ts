import { describe, expect, test } from "bun:test"
import { createAttachScheduler } from "./attach-scheduler"

describe("attach scheduler", () => {
  test("dedupes_same_key_while_running", async () => {
    const scheduler = createAttachScheduler({ concurrency: 1 })
    let runs = 0
    let release = () => {}
    const gate = new Promise<void>((ok) => {
      release = ok
    })

    const a = scheduler.schedule("pty-1", async () => {
      runs += 1
      await gate
    })
    const b = scheduler.schedule("pty-1", async () => {
      runs += 1
    })

    expect(a.promise).toBe(b.promise)
    release()
    await a.promise
    expect(runs).toBe(1)
  })

  test("respects_global_concurrency_cap", async () => {
    const scheduler = createAttachScheduler({ concurrency: 2 })
    let active = 0
    let peak = 0
    const run = (key: string) => {
      return scheduler.schedule(key, async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((ok) => setTimeout(ok, 20))
        active -= 1
      }).promise
    }

    const p1 = run("a")
    const p2 = run("b")
    const p3 = run("c")

    expect(scheduler.inFlight()).toBe(2)
    expect(scheduler.pending()).toBe(1)

    await Promise.all([p1, p2, p3])

    expect(peak).toBe(2)
  })

  test("cancel_queued_task_releases_slot_safely", async () => {
    const scheduler = createAttachScheduler({ concurrency: 1 })
    let release = () => {}
    const gate = new Promise<void>((ok) => {
      release = ok
    })

    const running = scheduler.schedule("run", async () => {
      await gate
    })

    const queued = scheduler.schedule("queued", async () => {})
    queued.cancel()

    await expect(queued.promise).rejects.toThrow("attach canceled")
    expect(scheduler.pending()).toBe(0)

    release()
    await running.promise
  })
})

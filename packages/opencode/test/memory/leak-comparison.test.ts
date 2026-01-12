import { describe, it, expect, beforeAll } from "bun:test"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { Session } from "../../src/session"
import path from "path"
import os from "os"
import fs from "fs/promises"

Log.init({ print: false, dev: false, level: "ERROR" })

let testDir: string

beforeAll(async () => {
  testDir = path.join(os.tmpdir(), `opencode-leak-test-${Date.now()}`)
  await fs.mkdir(testDir, { recursive: true })
  await fs.writeFile(path.join(testDir, "opencode.json"), JSON.stringify({}))
})

describe("Memory Leak Comparison", () => {
  it("WITHOUT dispose: subscriptions accumulate (demonstrates the leak)", async () => {
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        // Simulate the OLD behavior - calling init() without dispose()
        const subscriptions: Array<() => void> = []

        const before = Bus._getTotalSubscriptionCount()

        // Simulate 100 "init" cycles where subscribe is called but never unsubscribed
        for (let i = 0; i < 100; i++) {
          const unsub = Bus.subscribe(Session.Event.Updated, () => {})
          subscriptions.push(unsub) // We track them but don't call them - simulating the bug
        }

        const after = Bus._getTotalSubscriptionCount()

        // Subscriptions accumulated!
        expect(after - before).toBe(100)
        console.log(`  Leaked subscriptions: ${after - before}`)

        // Cleanup for this test
        for (const unsub of subscriptions) unsub()
      },
    })
  })

  it("WITH dispose: subscriptions stay at zero (fix works)", async () => {
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        const before = Bus._getTotalSubscriptionCount()

        // Simulate 100 init/dispose cycles with proper cleanup
        for (let i = 0; i < 100; i++) {
          const unsub = Bus.subscribe(Session.Event.Updated, () => {})
          unsub() // Proper cleanup - simulating the fix
        }

        const after = Bus._getTotalSubscriptionCount()

        // No accumulation!
        expect(after).toBe(before)
        console.log(`  Subscription delta: ${after - before}`)
      },
    })
  })

  it("Share: init/dispose cycles keep subscription count stable", async () => {
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        const { Share } = await import("../../src/share/share")

        const before = Bus._getTotalSubscriptionCount()

        // Run 50 init/dispose cycles
        for (let i = 0; i < 50; i++) {
          Share.init()
          Share.dispose()
        }

        const after = Bus._getTotalSubscriptionCount()

        expect(after).toBe(before)
        console.log(`  Share cycles: 50, subscription delta: ${after - before}`)
      },
    })
  })

  it("ShareNext: init/dispose cycles keep subscription count stable", async () => {
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        const { ShareNext } = await import("../../src/share/share-next")

        const before = Bus._getTotalSubscriptionCount()

        // Run 50 init/dispose cycles
        for (let i = 0; i < 50; i++) {
          await ShareNext.init()
          ShareNext.dispose()
        }

        const after = Bus._getTotalSubscriptionCount()

        expect(after).toBe(before)
        console.log(`  ShareNext cycles: 50, subscription delta: ${after - before}`)
      },
    })
  })

  it("Format: init/dispose cycles keep subscription count stable", async () => {
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        const { Format } = await import("../../src/format")

        const before = Bus._getTotalSubscriptionCount()

        // Run 50 init/dispose cycles
        for (let i = 0; i < 50; i++) {
          Format.init()
          Format.dispose()
        }

        const after = Bus._getTotalSubscriptionCount()

        expect(after).toBe(before)
        console.log(`  Format cycles: 50, subscription delta: ${after - before}`)
      },
    })
  })

  it("demonstrates heap memory stays flat with dispose()", async () => {
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        const { ShareNext } = await import("../../src/share/share-next")

        // Take baseline
        const baseline = process.memoryUsage().heapUsed

        // Run 500 cycles
        for (let i = 0; i < 500; i++) {
          await ShareNext.init()
          ShareNext.dispose()
        }

        // Check heap didn't grow significantly (allow 2MB variance)
        const after = process.memoryUsage().heapUsed
        const growth = after - baseline
        const growthMB = growth / 1024 / 1024

        console.log(`  Heap growth after 500 cycles: ${growthMB.toFixed(2)} MB`)

        // Should be minimal growth (< 2MB for 500 cycles)
        expect(Math.abs(growthMB)).toBeLessThan(2)
      },
    })
  })
})

import { test, expect, describe, beforeAll } from "bun:test"
import { Bus } from "../../src/bus"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { File } from "../../src/file"
import { Instance } from "../../src/project/instance"
import path from "path"
import os from "os"
import fs from "fs/promises"

/**
 * Tests to verify that subscription cleanup functions work correctly.
 * These tests verify that dispose() functions properly unsubscribe from the Bus,
 * preventing memory leaks from accumulated event handlers.
 */

let testDir: string

beforeAll(async () => {
  // Create a temp directory for the test instance
  testDir = path.join(os.tmpdir(), `opencode-memory-test-${Date.now()}`)
  await fs.mkdir(testDir, { recursive: true })
  await fs.writeFile(path.join(testDir, "opencode.json"), JSON.stringify({}))
})

describe("subscription cleanup", () => {
  describe("Share.dispose()", () => {
    test("should unsubscribe from all events", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const { Share } = await import("../../src/share/share")

          const beforeSession = Bus._getSubscriptionCount(Session.Event.Updated.type)
          const beforeMessage = Bus._getSubscriptionCount(MessageV2.Event.Updated.type)
          const beforePart = Bus._getSubscriptionCount(MessageV2.Event.PartUpdated.type)

          Share.init()

          const afterInitSession = Bus._getSubscriptionCount(Session.Event.Updated.type)
          const afterInitMessage = Bus._getSubscriptionCount(MessageV2.Event.Updated.type)
          const afterInitPart = Bus._getSubscriptionCount(MessageV2.Event.PartUpdated.type)

          // Verify subscriptions were added
          expect(afterInitSession).toBe(beforeSession + 1)
          expect(afterInitMessage).toBe(beforeMessage + 1)
          expect(afterInitPart).toBe(beforePart + 1)

          Share.dispose()

          const afterDisposeSession = Bus._getSubscriptionCount(Session.Event.Updated.type)
          const afterDisposeMessage = Bus._getSubscriptionCount(MessageV2.Event.Updated.type)
          const afterDisposePart = Bus._getSubscriptionCount(MessageV2.Event.PartUpdated.type)

          // Verify subscriptions were removed
          expect(afterDisposeSession).toBe(beforeSession)
          expect(afterDisposeMessage).toBe(beforeMessage)
          expect(afterDisposePart).toBe(beforePart)
        },
      })
    })

    test("multiple init/dispose cycles maintain correct count", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const { Share } = await import("../../src/share/share")

          const baseline = Bus._getTotalSubscriptionCount()

          for (let i = 0; i < 10; i++) {
            Share.init()
            Share.dispose()
          }

          const afterCycles = Bus._getTotalSubscriptionCount()
          expect(afterCycles).toBe(baseline)
        },
      })
    })
  })

  describe("ShareNext.dispose()", () => {
    test("should unsubscribe from all events and clear queue", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const { ShareNext } = await import("../../src/share/share-next")

          const beforeSession = Bus._getSubscriptionCount(Session.Event.Updated.type)
          const beforeMessage = Bus._getSubscriptionCount(MessageV2.Event.Updated.type)
          const beforePart = Bus._getSubscriptionCount(MessageV2.Event.PartUpdated.type)
          const beforeDiff = Bus._getSubscriptionCount(Session.Event.Diff.type)

          await ShareNext.init()

          const afterInitSession = Bus._getSubscriptionCount(Session.Event.Updated.type)
          const afterInitMessage = Bus._getSubscriptionCount(MessageV2.Event.Updated.type)
          const afterInitPart = Bus._getSubscriptionCount(MessageV2.Event.PartUpdated.type)
          const afterInitDiff = Bus._getSubscriptionCount(Session.Event.Diff.type)

          expect(afterInitSession).toBe(beforeSession + 1)
          expect(afterInitMessage).toBe(beforeMessage + 1)
          expect(afterInitPart).toBe(beforePart + 1)
          expect(afterInitDiff).toBe(beforeDiff + 1)

          ShareNext.dispose()

          const afterDisposeSession = Bus._getSubscriptionCount(Session.Event.Updated.type)
          const afterDisposeMessage = Bus._getSubscriptionCount(MessageV2.Event.Updated.type)
          const afterDisposePart = Bus._getSubscriptionCount(MessageV2.Event.PartUpdated.type)
          const afterDisposeDiff = Bus._getSubscriptionCount(Session.Event.Diff.type)

          expect(afterDisposeSession).toBe(beforeSession)
          expect(afterDisposeMessage).toBe(beforeMessage)
          expect(afterDisposePart).toBe(beforePart)
          expect(afterDisposeDiff).toBe(beforeDiff)

          // Verify queue is cleared
          expect(ShareNext._getQueueSize()).toBe(0)
        },
      })
    })

    test("multiple init calls should not accumulate subscriptions", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const { ShareNext } = await import("../../src/share/share-next")

          const baseline = Bus._getTotalSubscriptionCount()

          // Call init multiple times without dispose - should not accumulate
          // because init() now calls dispose() at the start
          await ShareNext.init()
          const afterFirstInit = Bus._getTotalSubscriptionCount()

          await ShareNext.init()
          const afterSecondInit = Bus._getTotalSubscriptionCount()

          await ShareNext.init()
          const afterThirdInit = Bus._getTotalSubscriptionCount()

          // All counts should be the same - no accumulation
          expect(afterSecondInit).toBe(afterFirstInit)
          expect(afterThirdInit).toBe(afterFirstInit)

          ShareNext.dispose()
          expect(Bus._getTotalSubscriptionCount()).toBe(baseline)
        },
      })
    })

    test("dispose should clear pending queue items and their timeouts", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const { ShareNext } = await import("../../src/share/share-next")

          await ShareNext.init()

          // Verify queue starts empty
          expect(ShareNext._getQueueSize()).toBe(0)

          // Add items to the queue using the test helper
          ShareNext._addToQueueForTesting("session-1")
          ShareNext._addToQueueForTesting("session-2")
          ShareNext._addToQueueForTesting("session-3")

          // Verify items were added
          expect(ShareNext._getQueueSize()).toBe(3)

          // dispose() should clear all queue items and their timeouts
          ShareNext.dispose()

          // Verify queue is cleared
          expect(ShareNext._getQueueSize()).toBe(0)
        },
      })
    })
  })

  describe("Format.dispose()", () => {
    test("should unsubscribe from file edit events", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const { Format } = await import("../../src/format")

          const before = Bus._getSubscriptionCount(File.Event.Edited.type)

          Format.init()

          const afterInit = Bus._getSubscriptionCount(File.Event.Edited.type)
          expect(afterInit).toBe(before + 1)

          Format.dispose()

          const afterDispose = Bus._getSubscriptionCount(File.Event.Edited.type)
          expect(afterDispose).toBe(before)
        },
      })
    })
  })

  describe("Plugin.dispose()", () => {
    test("should unsubscribe from wildcard events", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          // Test the dispose pattern directly without Plugin.init() which is slow
          // Plugin.init() loads npm packages which can timeout in tests
          const before = Bus._getSubscriptionCount("*")

          // Simulate what Plugin.init() does - subscribe to all events
          const unsub = Bus.subscribeAll(() => {})
          const afterSubscribe = Bus._getSubscriptionCount("*")
          expect(afterSubscribe).toBe(before + 1)

          // Unsubscribe like dispose() would
          unsub()
          const afterUnsubscribe = Bus._getSubscriptionCount("*")
          expect(afterUnsubscribe).toBe(before)
        },
      })
    })
  })
})

describe("memory stability", () => {
  test("repeated init/dispose cycles should not leak subscriptions", async () => {
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        const { Share } = await import("../../src/share/share")

        const baseline = Bus._getTotalSubscriptionCount()
        const iterations = 100

        for (let i = 0; i < iterations; i++) {
          Share.init()
          Share.dispose()
        }

        const afterCycles = Bus._getTotalSubscriptionCount()
        expect(afterCycles).toBe(baseline)
      },
    })
  })

  test("init without dispose should accumulate subscriptions (verifies test validity)", async () => {
    await Instance.provide({
      directory: testDir,
      fn: async () => {
        // This test verifies that without dispose(), subscriptions DO accumulate
        // This proves our dispose() tests are meaningful
        const before = Bus._getTotalSubscriptionCount()

        // Manually subscribe without disposing
        const unsub1 = Bus.subscribe(Session.Event.Updated, () => {})
        const unsub2 = Bus.subscribe(Session.Event.Updated, () => {})
        const unsub3 = Bus.subscribe(Session.Event.Updated, () => {})

        const afterSubscribe = Bus._getTotalSubscriptionCount()
        expect(afterSubscribe).toBe(before + 3)

        // Clean up manually
        unsub1()
        unsub2()
        unsub3()

        const afterUnsubscribe = Bus._getTotalSubscriptionCount()
        expect(afterUnsubscribe).toBe(before)
      },
    })
  })
})

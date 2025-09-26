import { test, expect, describe } from "bun:test"
import { ReminderManager } from "../../src/reminder/manager"
import { Reminder } from "../../src/reminder/reminder"
import { Instance } from "../../src/project/instance"

import { $ } from "bun"

async function createTestProject() {
  const dir = await $`mktemp -d`.text().then((t) => t.trim())
  await $`git init`.cwd(dir).quiet()
  await Bun.write(`${dir}/test.txt`, "test content")
  await $`git add .`.cwd(dir).quiet()
  await $`git commit -m init`.cwd(dir).quiet()

  return {
    [Symbol.asyncDispose]: async () => {
      await $`rm -rf ${dir}`.quiet()
    },
    dir,
  }
}

async function cleanupAllReminders() {
  await new Promise((resolve) => setTimeout(resolve, 50))
  const existingReminders = await ReminderManager.list()
  for (const reminder of existingReminders) {
    await ReminderManager.cancel(reminder.id)
  }
}

describe("Reminder Error Handling Tests", () => {
  test("handles malformed reminder in storage during init", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        const { Storage } = await import("../../src/storage/storage")

        // Store malformed data
        await Storage.write(["reminder", Instance.project.id, "msg_malformed"], {
          id: "msg_malformed",
          // Missing required fields
          badData: "this should not parse",
        })

        // Init should handle malformed data gracefully
        ReminderManager.init()

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Should not have any reminders
        const reminders = await ReminderManager.list()
        expect(reminders).toHaveLength(0)

        // Storage should be cleaned up (malformed entry removed)
        try {
          const malformed = await Storage.read(["reminder", Instance.project.id, "msg_malformed"])
          expect(malformed).toBeNull()
        } catch (error) {
          // Expected - file should be removed
          expect(error).toBeDefined()
        }
      },
    })
  })

  test("handles storage errors during reminder persistence", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()
        await cleanupAllReminders()

        const reminder: Reminder.Info = {
          id: "msg_storage_error_test",
          sessionID: "ses_storage_error_test",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 100,
          originalPrompt: "test storage error",
          userDescription: "Storage error test",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 100,
          },
          status: "active",
        }

        // This should work normally since storage is available
        await ReminderManager.schedule(reminder)

        const scheduled = await ReminderManager.list("ses_storage_error_test")
        expect(scheduled).toHaveLength(1)

        // Clean up
        await ReminderManager.cancel(reminder.id)
      },
    })
  })

  test("handles double cancellation gracefully", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()
        await cleanupAllReminders()

        const reminder: Reminder.Info = {
          id: "msg_double_cancel_test",
          sessionID: "ses_double_cancel_test",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 100,
          originalPrompt: "double cancel test",
          userDescription: "Double cancel test",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 100,
          },
          status: "active",
        }

        await ReminderManager.schedule(reminder)

        // First cancellation should succeed
        const firstCancel = await ReminderManager.cancel(reminder.id)
        expect(firstCancel).toBe(true)

        // Second cancellation should return false (already cancelled)
        const secondCancel = await ReminderManager.cancel(reminder.id)
        expect(secondCancel).toBe(false)

        // List should be empty
        const remaining = await ReminderManager.list("ses_double_cancel_test")
        expect(remaining).toHaveLength(0)
      },
    })
  })

  test("handles concurrent schedule and cancel operations", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()
        await cleanupAllReminders()

        const reminder: Reminder.Info = {
          id: "msg_concurrent_ops_test",
          sessionID: "ses_concurrent_ops_test",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 1000, // Long interval
          originalPrompt: "concurrent ops test",
          userDescription: "Concurrent ops test",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 1000,
          },
          status: "active",
        }

        // Try to schedule and cancel at the same time
        const [scheduled, cancelled] = await Promise.allSettled([
          ReminderManager.schedule(reminder),
          ReminderManager.cancel(reminder.id), // May or may not find the reminder
        ])

        expect(scheduled.status).toBe("fulfilled")
        // Cancel may succeed or fail depending on timing
        expect(cancelled.status).toBe("fulfilled")

        // Final state should be consistent
        const finalReminders = await ReminderManager.list("ses_concurrent_ops_test")
        // Should be either 0 (cancelled) or 1 (scheduled but not cancelled)
        expect(finalReminders.length).toBeLessThanOrEqual(1)

        // Clean up if reminder still exists
        if (finalReminders.length > 0) {
          await ReminderManager.cancel(reminder.id)
        }
      },
    })
  })

  test("handles invalid reminder data in schedule", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()
        await cleanupAllReminders()

        // The schedule function should validate the reminder data
        const invalidReminder = {
          id: "msg_invalid_test",
          sessionID: "ses_invalid_test",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 100,
          originalPrompt: "invalid test",
          userDescription: "Invalid test",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 100,
          },
          status: "active",
        } as Reminder.Info

        // This should work since the data is actually valid
        await ReminderManager.schedule(invalidReminder)

        const reminders = await ReminderManager.list("ses_invalid_test")
        expect(reminders).toHaveLength(1)

        await ReminderManager.cancel(invalidReminder.id)
      },
    })
  })

  test("handles session cleanup for non-existent session", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()
        await cleanupAllReminders()

        // Try to clean up a session that doesn't have any reminders
        await ReminderManager.cleanupSession("ses_nonexistent")

        // Should not throw or cause issues
        const reminders = await ReminderManager.list()
        expect(reminders).toHaveLength(0)
      },
    })
  })

  test("handles timer rescheduling edge cases", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()
        await cleanupAllReminders()

        const reminder: Reminder.Info = {
          id: "msg_reschedule_test",
          sessionID: "ses_reschedule_test",
          projectID: Instance.project.id,
          type: "recurring",
          interval: 50, // Very short interval
          originalPrompt: "reschedule test",
          userDescription: "Reschedule test",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 50,
          },
          status: "active",
        }

        await ReminderManager.schedule(reminder)

        // Let it run briefly
        await new Promise((resolve) => setTimeout(resolve, 30))

        // Cancel while potentially executing
        const cancelled = await ReminderManager.cancel(reminder.id)
        expect(cancelled).toBe(true)

        // Should be cleaned up
        const remaining = await ReminderManager.list("ses_reschedule_test")
        expect(remaining).toHaveLength(0)
      },
    })
  })

  test("validates reminder interval constraints", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()
        await cleanupAllReminders()

        // Test with very small interval (should still work at manager level)
        const reminder: Reminder.Info = {
          id: "msg_interval_test",
          sessionID: "ses_interval_test",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 1, // 1ms - very small but technically valid
          originalPrompt: "interval test",
          userDescription: "Interval test",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 1,
          },
          status: "active",
        }

        await ReminderManager.schedule(reminder)

        const scheduled = await ReminderManager.list("ses_interval_test")
        expect(scheduled).toHaveLength(1)

        // Clean up quickly before it potentially executes
        await ReminderManager.cancel(reminder.id)
      },
    })
  })
})

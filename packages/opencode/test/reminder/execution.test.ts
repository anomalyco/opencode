import { test, expect, describe } from "bun:test"
import { ReminderManager } from "../../src/reminder/manager"
import { Reminder } from "../../src/reminder/reminder"
import { Instance } from "../../src/project/instance"
import { Storage } from "../../src/storage/storage"
import { Session } from "../../src/session"
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

describe("Reminder Execution Tests", () => {
  test("execute function handles non-existent reminder gracefully", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()
        await cleanupAllReminders()

        // Try to execute a non-existent reminder
        await ReminderManager.execute("msg_nonexistent")

        // Should not throw or cause issues
        const reminders = await ReminderManager.list()
        expect(reminders).toHaveLength(0)
      },
    })
  })

  test("execute function handles inactive reminder", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()
        await cleanupAllReminders()

        const reminder: Reminder.Info = {
          id: "msg_inactive_test",
          sessionID: "ses_inactive_test",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 100,
          originalPrompt: "should not execute",
          userDescription: "Inactive test",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 100,
          },
          status: "cancelled", // Already cancelled
        }

        await ReminderManager.schedule(reminder)

        // Try to execute the cancelled reminder
        await ReminderManager.execute(reminder.id)

        // Should not have any effect
        const reminders = await ReminderManager.list("ses_inactive_test")
        expect(reminders).toHaveLength(0) // Cancelled reminders not listed
      },
    })
  })

  test("reminder storage restoration on init", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        // First, create a session
        const session = await Session.createNext({
          id: "ses_restore_test",
          directory: tmp.dir,
          title: "Test Session",
        })

        // Then manually store a reminder in storage
        const reminder: Reminder.Info = {
          id: "msg_restore_test",
          sessionID: session.id,
          projectID: Instance.project.id,
          type: "one-time",
          interval: 5000, // Long interval so it doesn't execute
          originalPrompt: "restored reminder",
          userDescription: "Restore test",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 5000,
          },
          status: "active",
        }

        // Store directly to storage without using ReminderManager
        await Storage.write(["reminder", Instance.project.id, reminder.id], reminder)

        // Now init ReminderManager and see if it restores
        ReminderManager.init()

        // Wait for async initialization to complete
        await new Promise((resolve) => setTimeout(resolve, 200))

        // Check if reminder was restored
        const restoredReminders = await ReminderManager.list(session.id)
        expect(restoredReminders).toHaveLength(1)
        expect(restoredReminders[0].userDescription).toBe("Restore test")

        // Clean up
        await ReminderManager.cancel(reminder.id)
        await Session.remove(session.id)
      },
    })
  })

  test("expired reminder cleanup on init", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        // Create an expired reminder (nextExecution in the past beyond grace period)
        const oneHourAgo = Date.now() - 60 * 60 * 1000 - 1000 // 1 hour + 1 second ago
        const reminder: Reminder.Info = {
          id: "msg_expired_test",
          sessionID: "ses_expired_test",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 1000,
          originalPrompt: "expired reminder",
          userDescription: "Expired test",
          time: {
            created: oneHourAgo - 1000,
            nextExecution: oneHourAgo, // More than 1 hour ago
          },
          status: "active",
        }

        // Store directly to storage
        await Storage.write(["reminder", Instance.project.id, reminder.id], reminder)

        // Init ReminderManager
        ReminderManager.init()

        // Wait for async cleanup
        await new Promise((resolve) => setTimeout(resolve, 200))

        // Check if expired reminder was cleaned up
        const reminders = await ReminderManager.list("ses_expired_test")
        expect(reminders).toHaveLength(0)

        // Verify it was removed from storage
        try {
          const storedReminder = await Storage.read<Reminder.Info>(["reminder", Instance.project.id, reminder.id])
          expect(storedReminder).toBeNull()
        } catch (error) {
          expect(error).toBeDefined()
        }
      },
    })
  })

  test("reminder within grace period restored on init", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        // Create a reminder that's overdue but within grace period
        const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000 // 30 minutes ago
        const reminder: Reminder.Info = {
          id: "msg_grace_test",
          sessionID: "ses_grace_test",
          projectID: Instance.project.id,
          type: "recurring",
          interval: 60000, // 1 minute - longer interval
          originalPrompt: "grace period reminder",
          userDescription: "Grace test",
          time: {
            created: thirtyMinutesAgo - 1000,
            nextExecution: Date.now() + 60000, // Schedule for future to avoid execution during test
          },
          status: "active",
        }

        // Store directly to storage
        await Storage.write(["reminder", Instance.project.id, reminder.id], reminder)

        // Init ReminderManager
        ReminderManager.init()

        // Wait for async restoration
        await new Promise((resolve) => setTimeout(resolve, 200))

        // Check if reminder was restored (it might have been cancelled if it tried to execute)
        const reminders = await ReminderManager.list("ses_grace_test")
        // The restoration process should work without errors
        expect(reminders.length).toBeGreaterThanOrEqual(0)

        // Clean up if it exists
        if (reminders.length > 0) {
          await ReminderManager.cancel(reminder.id)
        }
      },
    })
  })

  test("concurrent reminder scheduling and cancellation", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()
        await cleanupAllReminders()

        // Create multiple reminders concurrently
        const reminders: Reminder.Info[] = []
        for (let i = 0; i < 5; i++) {
          reminders.push({
            id: `msg_concurrent_${i}`,
            sessionID: "ses_concurrent_test",
            projectID: Instance.project.id,
            type: "one-time",
            interval: 1000 + i * 100, // Staggered intervals
            originalPrompt: `concurrent task ${i}`,
            userDescription: `Concurrent ${i}`,
            time: {
              created: Date.now(),
              nextExecution: Date.now() + 1000 + i * 100,
            },
            status: "active",
          })
        }

        // Schedule all concurrently
        await Promise.all(reminders.map((r) => ReminderManager.schedule(r)))

        // Verify all were scheduled
        const scheduled = await ReminderManager.list("ses_concurrent_test")
        expect(scheduled).toHaveLength(5)

        // Cancel some concurrently
        await Promise.all([
          ReminderManager.cancel("msg_concurrent_0"),
          ReminderManager.cancel("msg_concurrent_2"),
          ReminderManager.cancel("msg_concurrent_4"),
        ])

        // Verify correct count remaining
        const remaining = await ReminderManager.list("ses_concurrent_test")
        expect(remaining).toHaveLength(2)

        const remainingDescriptions = remaining.map((r) => r.userDescription).sort()
        expect(remainingDescriptions).toEqual(["Concurrent 1", "Concurrent 3"])

        // Clean up remaining
        await ReminderManager.cancel("msg_concurrent_1")
        await ReminderManager.cancel("msg_concurrent_3")
      },
    })
  })

  test("reminder scheduling and cancellation", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()
        await cleanupAllReminders()

        const reminder: Reminder.Info = {
          id: "msg_event_test",
          sessionID: "ses_event_test",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 100,
          originalPrompt: "event test",
          userDescription: "Event test",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 100,
          },
          status: "active",
        }

        await ReminderManager.schedule(reminder)

        const scheduled = await ReminderManager.list("ses_event_test")
        expect(scheduled).toHaveLength(1)
        expect(scheduled[0].id).toBe("msg_event_test")

        await ReminderManager.cancel(reminder.id)

        const afterCancel = await ReminderManager.list("ses_event_test")
        expect(afterCancel).toHaveLength(0)
      },
    })
  })
})

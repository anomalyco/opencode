import { describe, test, expect } from "bun:test"
import { ReminderManager } from "../../src/reminder/manager"
import { Reminder } from "../../src/reminder/reminder"
import { Storage } from "../../src/storage/storage"
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

describe("Timer Persistence Validation", () => {
  test("cancels reminders with invalid sessions during restoration", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        // Create reminder with invalid session (no session created)
        const reminder: Reminder.Info = {
          id: "msg_invalid_session",
          sessionID: "ses_nonexistent",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 60000,
          originalPrompt: "Test invalid session",
          userDescription: "Test description",
          status: "active",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 60000,
          },
        }

        // Store reminder directly
        await Storage.write(["reminder", Instance.project.id, reminder.id], reminder)

        // Initialize manager
        ReminderManager.init()

        // Wait for async initialization
        await new Promise((resolve) => setTimeout(resolve, 200))

        // Check that reminder was cancelled (not in active list)
        const reminders = await ReminderManager.list()
        expect(reminders).toHaveLength(0)

        // Reminder should be removed from storage (may already be cleaned up)
        try {
          const storedReminder = await Storage.read<Reminder.Info>(["reminder", Instance.project.id, reminder.id])
          expect(storedReminder).toBeNull()
        } catch (error) {
          // Storage file not found is expected - means it was cleaned up
          expect((error as any).code).toBe("ENOENT")
        }
      },
    })
  })

  test("removes expired reminders beyond grace period", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        // Create expired reminder (beyond 1-hour grace period)
        const reminder: Reminder.Info = {
          id: "msg_expired_test",
          sessionID: "ses_expired_test",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 60000,
          originalPrompt: "Expired reminder",
          userDescription: "Expired test",
          status: "active",
          time: {
            created: Date.now() - 3 * 60 * 60 * 1000, // 3 hours ago
            nextExecution: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago (beyond grace period)
          },
        }

        await Storage.write(["reminder", Instance.project.id, reminder.id], reminder)

        ReminderManager.init()
        await new Promise((resolve) => setTimeout(resolve, 200))

        // Should be removed
        const reminders = await ReminderManager.list()
        expect(reminders).toHaveLength(0)
      },
    })
  })

  test("validates timer health after restoration", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        // Create reminder within grace period but with realistic session
        const reminder: Reminder.Info = {
          id: "msg_health_test",
          sessionID: "ses_health_test",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 60000,
          originalPrompt: "Health check reminder",
          userDescription: "Health test",
          status: "active",
          time: {
            created: Date.now() - 30 * 60 * 1000, // 30 minutes ago
            nextExecution: Date.now() - 10 * 60 * 1000, // 10 minutes ago (within grace period)
          },
        }

        await Storage.write(["reminder", Instance.project.id, reminder.id], reminder)

        ReminderManager.init()
        await new Promise((resolve) => setTimeout(resolve, 200))

        // The reminder should be cancelled due to session validation failure
        // This validates our new session validation logic is working
        const reminders = await ReminderManager.list()
        expect(reminders).toHaveLength(0)
      },
    })
  })
})

import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { ReminderManager } from "../../src/reminder/manager"
import { Reminder } from "../../src/reminder/reminder"
import { Instance } from "../../src/project/instance"
import { Storage } from "../../src/storage/storage"
import { Bus } from "../../src/bus"
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

describe("ReminderManager", () => {
  // Remove global event logging for now - will be done inside Instance.provide

  test("schedule creates and stores reminder", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        // Set up event logging inside Instance context
        const eventLog: any[] = []
        Bus.subscribe(Reminder.Event.Created, (event) => eventLog.push({ type: "created", event }))

        ReminderManager.init()

        const reminder: Reminder.Info = {
          id: "msg_test123",
          sessionID: "ses_test456",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 5000,
          originalPrompt: "check /workspace/test.txt for content",
          userDescription: "Test file checker",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 5000,
          },
          status: "active",
        }

        await ReminderManager.schedule(reminder)

        // Check if reminder is stored
        const storedReminder = await Storage.read<Reminder.Info>(["reminder", Instance.project.id, reminder.id])
        expect(storedReminder).toEqual(reminder)

        // Check if Created event was published
        expect(eventLog).toHaveLength(1)
        expect(eventLog[0].type).toBe("created")
        expect(eventLog[0].event.properties.info.id).toBe(reminder.id)
      },
    })
  })

  test("list returns active reminders for session", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()

        const reminder1: Reminder.Info = {
          id: "msg_test1",
          sessionID: "ses_test1",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 5000,
          originalPrompt: "task 1",
          userDescription: "Task 1",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 5000,
          },
          status: "active",
        }

        const reminder2: Reminder.Info = {
          id: "msg_test2",
          sessionID: "ses_test2", // Different session
          projectID: Instance.project.id,
          type: "recurring",
          interval: 10000,
          originalPrompt: "task 2",
          userDescription: "Task 2",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 10000,
          },
          status: "active",
        }

        const reminder3: Reminder.Info = {
          id: "msg_test3",
          sessionID: "ses_test1", // Same session as reminder1
          projectID: Instance.project.id,
          type: "one-time",
          interval: 3000,
          originalPrompt: "task 3",
          userDescription: "Task 3",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 3000,
          },
          status: "cancelled", // Cancelled status
        }

        await ReminderManager.schedule(reminder1)
        await ReminderManager.schedule(reminder2)
        await ReminderManager.schedule(reminder3)

        // List all active reminders (no session filter)
        const allActive = await ReminderManager.list()
        expect(allActive).toHaveLength(2) // Only reminder1 and reminder2 (active)

        // List reminders for specific session
        const session1Reminders = await ReminderManager.list("ses_test1")
        expect(session1Reminders).toHaveLength(1) // Only reminder1 (active in session)
        expect(session1Reminders[0].id).toBe("msg_test1")

        const session2Reminders = await ReminderManager.list("ses_test2")
        expect(session2Reminders).toHaveLength(1) // Only reminder2
        expect(session2Reminders[0].id).toBe("msg_test2")
      },
    })
  })

  test("cancel removes reminder and publishes event", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()

        const reminder: Reminder.Info = {
          id: "msg_cancel_test",
          sessionID: "ses_cancel",
          projectID: Instance.project.id,
          type: "recurring",
          interval: 30000,
          originalPrompt: "recurring task",
          userDescription: "Recurring test",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 30000,
          },
          status: "active",
        }

        await ReminderManager.schedule(reminder)
        expect(eventLog).toHaveLength(1) // Created event

        // Cancel the reminder
        const cancelled = await ReminderManager.cancel(reminder.id)
        expect(cancelled).toBe(true)

        // Check if reminder is removed from storage
        const storedReminder = await Storage.read<Reminder.Info>(["reminder", Instance.project.id, reminder.id])
        expect(storedReminder).toBeNull()

        // Check if no longer in active list
        const activeReminders = await ReminderManager.list()
        expect(activeReminders).toHaveLength(0)

        // Check if Cancelled event was published
        expect(eventLog).toHaveLength(2)
        expect(eventLog[1].type).toBe("cancelled")
        expect(eventLog[1].event.properties.info.id).toBe(reminder.id)
      },
    })
  })

  test("cancel returns false for non-existent reminder", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()

        const cancelled = await ReminderManager.cancel("msg_nonexistent")
        expect(cancelled).toBe(false)

        // No events should be published
        expect(eventLog).toHaveLength(0)
      },
    })
  })

  test("cleanupSession removes all reminders for session", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()

        const reminder1: Reminder.Info = {
          id: "msg_cleanup1",
          sessionID: "ses_cleanup",
          projectID: Instance.project.id,
          type: "one-time",
          interval: 5000,
          originalPrompt: "task 1",
          userDescription: "Task 1",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 5000,
          },
          status: "active",
        }

        const reminder2: Reminder.Info = {
          id: "msg_cleanup2",
          sessionID: "ses_cleanup",
          projectID: Instance.project.id,
          type: "recurring",
          interval: 10000,
          originalPrompt: "task 2",
          userDescription: "Task 2",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 10000,
          },
          status: "active",
        }

        const reminder3: Reminder.Info = {
          id: "msg_keep",
          sessionID: "ses_keep", // Different session
          projectID: Instance.project.id,
          type: "one-time",
          interval: 3000,
          originalPrompt: "keep this task",
          userDescription: "Keep this",
          time: {
            created: Date.now(),
            nextExecution: Date.now() + 3000,
          },
          status: "active",
        }

        await ReminderManager.schedule(reminder1)
        await ReminderManager.schedule(reminder2)
        await ReminderManager.schedule(reminder3)

        expect(await ReminderManager.list()).toHaveLength(3)

        // Cleanup session
        await ReminderManager.cleanupSession("ses_cleanup")

        // Check that only reminder3 remains
        const remaining = await ReminderManager.list()
        expect(remaining).toHaveLength(1)
        expect(remaining[0].id).toBe("msg_keep")

        // Check that cleanup events were published
        const cancelledEvents = eventLog.filter((e) => e.type === "cancelled")
        expect(cancelledEvents).toHaveLength(2)
      },
    })
  })

  test("list handles empty state", async () => {
    await using tmp = await createTestProject()
    await Instance.provide({
      directory: tmp.dir,
      fn: async () => {
        ReminderManager.init()

        const allReminders = await ReminderManager.list()
        expect(allReminders).toHaveLength(0)

        const sessionReminders = await ReminderManager.list("ses_empty")
        expect(sessionReminders).toHaveLength(0)
      },
    })
  })

  // Note: Timer execution testing is complex due to timing dependencies
  // In a real test environment, you'd want to mock setTimeout/clearTimeout
  // or use shorter intervals with careful timing control
})

import { test, expect, describe } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Config } from "../../src/config/config"
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

const mockContext = {
  sessionID: "ses_test123",
  messageID: "msg_test456",
  agent: "test",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

async function cleanupReminders() {
  try {
    const { ReminderManager } = await import("../../src/reminder/manager")
    const existing = await ReminderManager.list()
    for (const reminder of existing) {
      await ReminderManager.cancel(reminder.id)
    }
  } catch (e) {
    // Ignore if no reminders exist or manager not initialized
  }
}

describe("Reminder Tools", () => {
  describe("ReminderAddTool", () => {
    test("successfully creates a one-time reminder", async () => {
      await using tmp = await createTestProject()
      await Instance.provide({
        directory: tmp.dir,
        fn: async () => {
          const { ReminderManager } = await import("../../src/reminder/manager")
          const { ReminderAddTool } = await import("../../src/tool/reminderadd")

          ReminderManager.init()
          await cleanupReminders()
          const addTool = await ReminderAddTool.init()

          const result = await addTool.execute(
            {
              interval_seconds: 300, // 5 minutes
              type: "one-time",
              action_prompt: "check /workspace/logs/app.log for new errors",
              description: "Check app logs for errors",
            },
            mockContext,
          )

          expect(result.title).toBe("Reminder set")
          expect(result.output).toContain("Reminder set: Check app logs for errors (in 300 seconds)")
          expect(result.metadata.reminderID).toBeDefined()

          // Verify reminder was created
          const reminders = await ReminderManager.list(mockContext.sessionID)
          expect(reminders).toHaveLength(1)
          expect(reminders[0].type).toBe("one-time")
          expect(reminders[0].userDescription).toBe("Check app logs for errors")
        },
      })
    })

    test("successfully creates a recurring reminder", async () => {
      await using tmp = await createTestProject()
      await Instance.provide({
        directory: tmp.dir,
        fn: async () => {
          const { ReminderManager } = await import("../../src/reminder/manager")
          const { ReminderAddTool } = await import("../../src/tool/reminderadd")

          ReminderManager.init()
          await cleanupReminders()
          const addTool = await ReminderAddTool.init()

          const result = await addTool.execute(
            {
              interval_seconds: 3600, // 1 hour
              type: "recurring",
              action_prompt: "check my email and send auto-replies",
              description: "Email auto-reply system",
            },
            mockContext,
          )

          expect(result.title).toBe("Reminder set")
          expect(result.output).toContain("Reminder set: Email auto-reply system (every 3600 seconds)")
          expect(result.metadata.reminderID).toBeDefined()

          // Verify reminder was created
          const reminders = await ReminderManager.list(mockContext.sessionID)
          expect(reminders).toHaveLength(1)
          expect(reminders[0].type).toBe("recurring")
          expect(reminders[0].interval).toBe(3600000) // milliseconds
        },
      })
    })

    test("enforces minimum interval", async () => {
      await using tmp = await createTestProject()
      await Instance.provide({
        directory: tmp.dir,
        fn: async () => {
          const { ReminderManager } = await import("../../src/reminder/manager")
          const { ReminderAddTool } = await import("../../src/tool/reminderadd")

          ReminderManager.init()
          await cleanupReminders()
          const addTool = await ReminderAddTool.init()

          // This should be caught by Zod schema validation
          expect(async () => {
            await addTool.execute(
              {
                interval_seconds: 10, // Below minimum of 30
                type: "one-time",
                action_prompt: "quick task",
                description: "Too frequent",
              },
              mockContext,
            )
          }).toThrow()
        },
      })
    })

    test("respects reminder limit", async () => {
      await using tmp = await createTestProject()
      await Instance.provide({
        directory: tmp.dir,
        fn: async () => {
          const { ReminderManager } = await import("../../src/reminder/manager")
          const { ReminderAddTool } = await import("../../src/tool/reminderadd")

          ReminderManager.init()
          await cleanupReminders()
          const addTool = await ReminderAddTool.init()

          // Create max reminders (default is 50, but let's test with 2 for speed)
          const maxReminders = 2

          // Mock config to return lower limit
          const originalGet = Config.get
          Config.get = async () =>
            ({
              reminders: {
                enabled: true,
                max_reminders_per_project: maxReminders,
                min_interval_seconds: 30,
              },
            }) as any

          try {
            // Create max number of reminders
            for (let i = 0; i < maxReminders; i++) {
              await addTool.execute(
                {
                  interval_seconds: 60,
                  type: "one-time",
                  action_prompt: `task ${i}`,
                  description: `Test reminder ${i}`,
                },
                mockContext,
              )
            }

            // Try to create one more - should fail
            const result = await addTool.execute(
              {
                interval_seconds: 60,
                type: "one-time",
                action_prompt: "overflow task",
                description: "Should fail",
              },
              mockContext,
            )

            expect(result.title).toBe("Reminder limit reached")
            expect(result.output).toContain("too many reminders already active")
            expect(result.output).toContain("Test reminder 0")
            expect(result.output).toContain("Test reminder 1")
          } finally {
            Config.get = originalGet
          }
        },
      })
    })
  })

  describe("ListRemindersTool", () => {
    test("returns empty list when no reminders exist", async () => {
      await using tmp = await createTestProject()
      await Instance.provide({
        directory: tmp.dir,
        fn: async () => {
          const { ReminderManager } = await import("../../src/reminder/manager")
          const { ReminderListTool } = await import("../../src/tool/reminderlist")

          ReminderManager.init()
          await cleanupReminders()
          const listTool = await ReminderListTool.init()

          const result = await listTool.execute({}, mockContext)

          expect(result.title).toBe("No active reminders")
          expect(result.output).toBe("No active reminders in this session.")
          expect(result.metadata).toEqual({})
        },
      })
    })

    test("lists multiple reminders with time information", async () => {
      await using tmp = await createTestProject()
      await Instance.provide({
        directory: tmp.dir,
        fn: async () => {
          const { ReminderManager } = await import("../../src/reminder/manager")
          const { ReminderAddTool } = await import("../../src/tool/reminderadd")
          const { ReminderListTool } = await import("../../src/tool/reminderlist")

          ReminderManager.init()
          await cleanupReminders()
          const addTool = await ReminderAddTool.init()
          const listTool = await ReminderListTool.init()

          // Create a few reminders
          await addTool.execute(
            {
              interval_seconds: 300,
              type: "one-time",
              action_prompt: "task 1",
              description: "First task",
            },
            mockContext,
          )

          await addTool.execute(
            {
              interval_seconds: 600,
              type: "recurring",
              action_prompt: "task 2",
              description: "Second task",
            },
            mockContext,
          )

          const result = await listTool.execute({}, mockContext)

          expect(result.title).toBe("2 active reminders")
          expect(result.output).toContain("Active reminders:")
          expect(result.output).toContain("First task (one-time, next execution in")
          expect(result.output).toContain("Second task (recurring, next execution in")
          expect(result.metadata.count).toBe(2)
        },
      })
    })
  })

  describe("RemoveReminderTool", () => {
    test("successfully removes matching reminder", async () => {
      await using tmp = await createTestProject()
      await Instance.provide({
        directory: tmp.dir,
        fn: async () => {
          const { ReminderManager } = await import("../../src/reminder/manager")
          const { ReminderAddTool } = await import("../../src/tool/reminderadd")
          const { ReminderRemoveTool } = await import("../../src/tool/reminderremove")

          ReminderManager.init()
          await cleanupReminders()
          const addTool = await ReminderAddTool.init()
          const removeTool = await ReminderRemoveTool.init()

          // Create a reminder
          await addTool.execute(
            {
              interval_seconds: 300,
              type: "recurring",
              action_prompt: "check email every 5 minutes",
              description: "Email checker",
            },
            mockContext,
          )

          // Remove it
          const result = await removeTool.execute(
            {
              description_pattern: "email",
            },
            mockContext,
          )

          expect(result.title).toBe("Reminder cancelled")
          expect(result.output).toBe("Reminder cancelled: Email checker")
          expect(result.metadata.reminderID).toBeDefined()

          // Verify it's gone
          const remaining = await ReminderManager.list(mockContext.sessionID)
          expect(remaining).toHaveLength(0)
        },
      })
    })

    test("matches against original prompt", async () => {
      await using tmp = await createTestProject()
      await Instance.provide({
        directory: tmp.dir,
        fn: async () => {
          const { ReminderManager } = await import("../../src/reminder/manager")
          const { ReminderAddTool } = await import("../../src/tool/reminderadd")
          const { ReminderRemoveTool } = await import("../../src/tool/reminderremove")

          ReminderManager.init()
          await cleanupReminders()
          const addTool = await ReminderAddTool.init()
          const removeTool = await ReminderRemoveTool.init()

          // Create a reminder
          await addTool.execute(
            {
              interval_seconds: 300,
              type: "one-time",
              action_prompt: "check /workspace/logs/important.log for critical errors",
              description: "Log monitor",
            },
            mockContext,
          )

          // Remove by matching original prompt
          const result = await removeTool.execute(
            {
              description_pattern: "critical errors",
            },
            mockContext,
          )

          expect(result.title).toBe("Reminder cancelled")
          expect(result.output).toBe("Reminder cancelled: Log monitor")
        },
      })
    })

    test("handles no matches", async () => {
      await using tmp = await createTestProject()
      await Instance.provide({
        directory: tmp.dir,
        fn: async () => {
          const { ReminderManager } = await import("../../src/reminder/manager")
          const { ReminderAddTool } = await import("../../src/tool/reminderadd")
          const { ReminderRemoveTool } = await import("../../src/tool/reminderremove")

          ReminderManager.init()
          await cleanupReminders()
          const addTool = await ReminderAddTool.init()
          const removeTool = await ReminderRemoveTool.init()

          // Create a reminder
          await addTool.execute(
            {
              interval_seconds: 300,
              type: "one-time",
              action_prompt: "backup database",
              description: "DB backup",
            },
            mockContext,
          )

          // Try to remove non-matching pattern
          const result = await removeTool.execute(
            {
              description_pattern: "email",
            },
            mockContext,
          )

          expect(result.title).toBe("No matching reminder found")
          expect(result.output).toContain('No matching reminder found for "email"')
          expect(result.output).toContain("DB backup")

          // Verify original reminder still exists
          const remaining = await ReminderManager.list(mockContext.sessionID)
          expect(remaining).toHaveLength(1)
        },
      })
    })

    test("handles multiple matches", async () => {
      await using tmp = await createTestProject()
      await Instance.provide({
        directory: tmp.dir,
        fn: async () => {
          const { ReminderManager } = await import("../../src/reminder/manager")
          const { ReminderAddTool } = await import("../../src/tool/reminderadd")
          const { ReminderRemoveTool } = await import("../../src/tool/reminderremove")

          ReminderManager.init()
          await cleanupReminders()
          const addTool = await ReminderAddTool.init()
          const removeTool = await ReminderRemoveTool.init()

          // Create multiple reminders with similar descriptions
          await addTool.execute(
            {
              interval_seconds: 300,
              type: "one-time",
              action_prompt: "check system logs",
              description: "System log checker",
            },
            mockContext,
          )

          await addTool.execute(
            {
              interval_seconds: 600,
              type: "recurring",
              action_prompt: "check application logs",
              description: "App log monitor",
            },
            mockContext,
          )

          // Try to remove with ambiguous pattern
          const result = await removeTool.execute(
            {
              description_pattern: "log",
            },
            mockContext,
          )

          expect(result.title).toBe("Multiple matches found")
          expect(result.output).toContain('Multiple reminders match "log"')
          expect(result.output).toContain("System log checker")
          expect(result.output).toContain("App log monitor")
          expect(result.output).toContain("Please be more specific")
          expect(result.metadata.matches).toBe(2)

          // Verify both reminders still exist
          const remaining = await ReminderManager.list(mockContext.sessionID)
          expect(remaining).toHaveLength(2)
        },
      })
    })
  })
})

import { test, expect, describe } from "bun:test"
import { Reminder } from "../../src/reminder/reminder"

describe("Reminder namespace", () => {
  test("Info schema validation", () => {
    const validReminder = {
      id: "msg_123",
      sessionID: "ses_456",
      projectID: "proj_789",
      type: "one-time" as const,
      interval: 5000,
      originalPrompt: "check /workspace/logs/app.log for errors",
      userDescription: "Check app logs for errors",
      time: {
        created: Date.now(),
        nextExecution: Date.now() + 5000,
      },
      status: "active" as const,
    }

    const result = Reminder.Info.safeParse(validReminder)
    expect(result.success).toBe(true)
  })

  test("Info schema rejects invalid data", () => {
    const invalidReminder = {
      id: "msg_123",
      sessionID: "ses_456",
      projectID: "proj_789",
      type: "invalid-type", // Invalid enum value
      interval: -1, // Negative interval
      originalPrompt: "",
      userDescription: "",
      time: {
        created: "not-a-number", // Should be number
        nextExecution: Date.now() + 5000,
      },
      status: "active",
    }

    const result = Reminder.Info.safeParse(invalidReminder)
    expect(result.success).toBe(false)
  })

  test("Info schema allows optional lastExecution", () => {
    const reminderWithLastExecution = {
      id: "msg_123",
      sessionID: "ses_456",
      projectID: "proj_789",
      type: "recurring" as const,
      interval: 60000,
      originalPrompt: "check email every hour",
      userDescription: "Email checker",
      time: {
        created: Date.now() - 60000,
        nextExecution: Date.now() + 60000,
        lastExecution: Date.now() - 5000,
      },
      status: "active" as const,
    }

    const result = Reminder.Info.safeParse(reminderWithLastExecution)
    expect(result.success).toBe(true)
    expect(result.data?.time.lastExecution).toBeDefined()
  })

  test("reminder info validation works correctly", () => {
    const reminder: Reminder.Info = {
      id: "msg_123",
      sessionID: "ses_456",
      projectID: "proj_789",
      type: "one-time",
      interval: 5000,
      originalPrompt: "test prompt",
      userDescription: "test description",
      time: {
        created: Date.now(),
        nextExecution: Date.now() + 5000,
      },
      status: "active",
    }

    const result = Reminder.Info.safeParse(reminder)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(reminder)
  })

  test("supports all reminder types", () => {
    const oneTimeReminder = {
      id: "msg_123",
      sessionID: "ses_456",
      projectID: "proj_789",
      type: "one-time" as const,
      interval: 5000,
      originalPrompt: "one-time task",
      userDescription: "One-time reminder",
      time: {
        created: Date.now(),
        nextExecution: Date.now() + 5000,
      },
      status: "active" as const,
    }

    const recurringReminder = {
      ...oneTimeReminder,
      type: "recurring" as const,
      userDescription: "Recurring reminder",
    }

    expect(Reminder.Info.safeParse(oneTimeReminder).success).toBe(true)
    expect(Reminder.Info.safeParse(recurringReminder).success).toBe(true)
  })

  test("supports all status types", () => {
    const baseReminder = {
      id: "msg_123",
      sessionID: "ses_456",
      projectID: "proj_789",
      type: "one-time" as const,
      interval: 5000,
      originalPrompt: "test task",
      userDescription: "Test reminder",
      time: {
        created: Date.now(),
        nextExecution: Date.now() + 5000,
      },
    }

    const activeReminder = { ...baseReminder, status: "active" as const }
    const pausedReminder = { ...baseReminder, status: "paused" as const }
    const cancelledReminder = { ...baseReminder, status: "cancelled" as const }

    expect(Reminder.Info.safeParse(activeReminder).success).toBe(true)
    expect(Reminder.Info.safeParse(pausedReminder).success).toBe(true)
    expect(Reminder.Info.safeParse(cancelledReminder).success).toBe(true)
  })
})

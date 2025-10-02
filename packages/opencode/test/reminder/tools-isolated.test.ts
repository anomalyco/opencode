import { test, expect, describe } from "bun:test"

// Test the reminder tools in isolation without triggering registry imports
describe("Reminder Tools - Isolated", () => {
  test("tool modules can be defined", async () => {
    // Test the actual tool definition modules without circular dependencies
    const { ReminderAddTool } = await import("../../src/tool/reminderadd")
    const { ReminderListTool } = await import("../../src/tool/reminderlist")
    const { ReminderRemoveTool } = await import("../../src/tool/reminderremove")

    expect(ReminderAddTool).toBeDefined()
    expect(ReminderListTool).toBeDefined()
    expect(ReminderRemoveTool).toBeDefined()

    expect(ReminderAddTool.id).toBe("reminderadd")
    expect(ReminderListTool.id).toBe("reminderlist")
    expect(ReminderRemoveTool.id).toBe("reminderremove")
  })

  test("add reminder tool parameters are correct", async () => {
    const { ReminderAddTool } = await import("../../src/tool/reminderadd")
    const tool = await ReminderAddTool.init()

    expect(tool.description).toContain("Set up a reminder")
    expect(tool.description).toContain("Actually performs the action")

    const params = tool.parameters.shape as any
    expect(params.interval_seconds).toBeDefined()
    expect(params.type).toBeDefined()
    expect(params.action_prompt).toBeDefined()
    expect(params.description).toBeDefined()

    // Test parameter validation
    const validParams = {
      interval_seconds: 60,
      type: "one-time" as const,
      action_prompt: "check /workspace/file.txt for changes",
      description: "File checker",
    }

    expect(() => tool.parameters.parse(validParams)).not.toThrow()

    // Test invalid params (too low interval)
    const invalidParams = {
      interval_seconds: 10, // Below minimum
      type: "one-time" as const,
      action_prompt: "test",
      description: "test",
    }

    expect(() => tool.parameters.parse(invalidParams)).toThrow()
  })

  test("list reminders tool has correct structure", async () => {
    const { ReminderListTool } = await import("../../src/tool/reminderlist")
    const tool = await ReminderListTool.init()

    expect(tool.description).toContain("List all active reminders")
    expect(tool.description).toContain("what reminders do I have")

    // Should accept empty parameters
    const params = {}
    expect(() => tool.parameters.parse(params)).not.toThrow()
  })

  test("remove reminder tool has correct structure", async () => {
    const { ReminderRemoveTool } = await import("../../src/tool/reminderremove")
    const tool = await ReminderRemoveTool.init()

    expect(tool.description).toContain("Cancel a scheduled reminder")
    expect(tool.description).toContain("stop checking")

    const params = tool.parameters.shape as any
    expect(params.description_pattern).toBeDefined()

    // Test valid params
    const validParams = {
      description_pattern: "email checker",
    }
    expect(() => tool.parameters.parse(validParams)).not.toThrow()
  })
})

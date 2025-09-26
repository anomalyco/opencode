import { test, expect, describe } from "bun:test"

// Test the reminder tools in isolation without triggering registry imports
describe("Reminder Tools - Isolated", () => {
  test("tool modules can be defined", async () => {
    // Test the actual tool definition module without circular dependencies
    const toolModule = await import("../../src/tool/reminder")

    expect(toolModule.AddReminderTool).toBeDefined()
    expect(toolModule.ListRemindersTool).toBeDefined()
    expect(toolModule.RemoveReminderTool).toBeDefined()

    expect(toolModule.AddReminderTool.id).toBe("add_reminder")
    expect(toolModule.ListRemindersTool.id).toBe("list_reminders")
    expect(toolModule.RemoveReminderTool.id).toBe("remove_reminder")
  })

  test("add reminder tool parameters are correct", async () => {
    const { AddReminderTool } = await import("../../src/tool/reminder")
    const tool = await AddReminderTool.init()

    expect(tool.description).toContain("Set up a reminder")
    expect(tool.description).toContain("actually perform the action")

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
    const { ListRemindersTool } = await import("../../src/tool/reminder")
    const tool = await ListRemindersTool.init()

    expect(tool.description).toContain("List all active reminders")
    expect(tool.description).toContain("what reminders do I have")

    // Should accept empty parameters
    const params = {}
    expect(() => tool.parameters.parse(params)).not.toThrow()
  })

  test("remove reminder tool has correct structure", async () => {
    const { RemoveReminderTool } = await import("../../src/tool/reminder")
    const tool = await RemoveReminderTool.init()

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

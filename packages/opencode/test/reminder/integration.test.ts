import { test, expect, describe } from "bun:test"

describe("Reminder Tools Integration", () => {
  test("tool modules can be imported", async () => {
    // Dynamic import to avoid circular dependency during test load
    const { ReminderAddTool } = await import("../../src/tool/reminderadd")
    const { ReminderListTool } = await import("../../src/tool/reminderlist")
    const { ReminderRemoveTool } = await import("../../src/tool/reminderremove")

    // Test that tools can be initialized
    const addTool = await ReminderAddTool.init()
    const listTool = await ReminderListTool.init()
    const removeTool = await ReminderRemoveTool.init()

    expect(addTool).toBeDefined()
    expect(addTool.description).toContain("Set up a reminder")
    expect(addTool.parameters).toBeDefined()
    expect(addTool.execute).toBeInstanceOf(Function)

    expect(listTool).toBeDefined()
    expect(listTool.description).toContain("List all active reminders")
    expect(listTool.execute).toBeInstanceOf(Function)

    expect(removeTool).toBeDefined()
    expect(removeTool.description).toContain("Cancel a scheduled reminder")
    expect(removeTool.execute).toBeInstanceOf(Function)
  })

  test("parameter validation works", async () => {
    const { ReminderAddTool } = await import("../../src/tool/reminderadd")
    const addTool = await ReminderAddTool.init()

    // Test minimum interval validation
    const invalidArgs = {
      interval_seconds: 10, // Below minimum of 30
      type: "one-time" as const,
      action_prompt: "test task",
      description: "Test reminder",
    }

    // Should throw due to Zod validation
    expect(() => {
      addTool.parameters.parse(invalidArgs)
    }).toThrow()

    // Valid args should pass
    const validArgs = {
      interval_seconds: 60,
      type: "one-time" as const,
      action_prompt: "check /workspace/file.txt for changes",
      description: "File change checker",
    }

    expect(() => {
      addTool.parameters.parse(validArgs)
    }).not.toThrow()
  })

  test("tool descriptions are informative", async () => {
    const { ReminderAddTool } = await import("../../src/tool/reminderadd")
    const { ReminderListTool } = await import("../../src/tool/reminderlist")
    const { ReminderRemoveTool } = await import("../../src/tool/reminderremove")
    const addTool = await ReminderAddTool.init()
    const listTool = await ReminderListTool.init()
    const removeTool = await ReminderRemoveTool.init()

    // Check that descriptions guide agents properly
    expect(addTool.description).toContain("remind me to")
    expect(addTool.description).toContain("check X every Y time")
    expect(addTool.description).toContain("Actually performs the action")

    expect(listTool.description).toContain("what reminders do I have")
    expect(listTool.description).toContain("scheduled actions")

    expect(removeTool.description).toContain("stop checking")
    expect(removeTool.description).toContain("cancel the reminder")
  })

  test("parameter schemas have proper descriptions", async () => {
    const { ReminderAddTool } = await import("../../src/tool/reminderadd")
    const addTool = await ReminderAddTool.init()

    const schema = addTool.parameters
    const shape = schema.shape as any

    expect(shape.interval_seconds.description).toContain("minimum 30")
    expect(shape.type.description).toContain("runs once or repeatedly")
    expect(shape.action_prompt.description).toContain("absolute paths")
    expect(shape.action_prompt.description).toContain("avoid 'this', 'that', 'latest'")
    expect(shape.description.description).toContain("identification")
  })

  test("enum values are properly defined", async () => {
    const { ReminderAddTool } = await import("../../src/tool/reminderadd")
    const addTool = await ReminderAddTool.init()
    const schema = addTool.parameters.shape as any

    const typeEnum = schema.type
    // Check if enum options are properly defined (Zod structure may vary)
    const enumValues = typeEnum._def?.values || typeEnum.options || typeEnum._def?.innerType?._def?.values
    expect(enumValues).toEqual(["one-time", "recurring"])
  })
})

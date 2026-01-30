import { test, expect } from "bun:test"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

test("accepts valid model_tier values", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const TaskInfo = await TaskTool.init()
      const schema = TaskInfo.parameters
      const result = schema.safeParse({
        description: "Test",
        prompt: "Test prompt",
        subagent_type: "build",
        model_tier: "quick",
      })

      expect(result.success).toBe(true)
    },
  })
})

test("rejects invalid model_tier values", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const TaskInfo = await TaskTool.init()
      const schema = TaskInfo.parameters
      const result = schema.safeParse({
        description: "Test",
        prompt: "Test prompt",
        subagent_type: "build",
        model_tier: "invalid",
      })

      expect(result.success).toBe(false)
    },
  })
})

test("model_tier is optional", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const TaskInfo = await TaskTool.init()
      const schema = TaskInfo.parameters
      const result = schema.safeParse({ description: "Test", prompt: "Test prompt", subagent_type: "build" })

      expect(result.success).toBe(true)
    },
  })
})

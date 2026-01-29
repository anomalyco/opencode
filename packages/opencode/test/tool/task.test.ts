import { describe, expect, test } from "bun:test"
import path from "path"
import { TaskTool } from "../../src/tool/task"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { PermissionNext } from "../../src/permission/next"
import { Agent } from "../../src/agent/agent"

describe("tool.task", () => {
  test("task tool schema includes model parameter", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()
        const schema = tool.parameters

        // Verify the model parameter exists and is optional
        const shape = schema.shape
        expect(shape.model).toBeDefined()

        // Verify the model schema structure - unwrap optional
        const modelShape = shape.model._def.innerType.shape
        expect(modelShape.providerID).toBeDefined()
        expect(modelShape.modelID).toBeDefined()
      },
    })
  })

  test("task tool description includes available models list", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        provider: {
          anthropic: {
            id: "anthropic",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()

        // Verify the description does not contain the placeholder
        expect(tool.description).not.toContain("{models}")

        // Verify the description mentions model parameter usage
        expect(tool.description).toContain("model parameter")
        expect(tool.description).toContain("Available models")
      },
    })
  })

  test("task tool accepts valid model parameter", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()

        // Valid input with model should parse successfully
        const result = tool.parameters.safeParse({
          description: "test task",
          prompt: "do something",
          subagent_type: "explore",
          model: {
            providerID: "anthropic",
            modelID: "claude-sonnet-4-20250514",
          },
        })
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.model).toEqual({
            providerID: "anthropic",
            modelID: "claude-sonnet-4-20250514",
          })
        }
      },
    })
  })

  test("task tool accepts input without model parameter", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()

        // Valid input without model should parse successfully
        const result = tool.parameters.safeParse({
          description: "test task",
          prompt: "do something",
          subagent_type: "explore",
        })
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.model).toBeUndefined()
        }
      },
    })
  })

  test("task tool rejects invalid model parameter", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskTool.init()

        // Invalid model (missing modelID) should fail validation
        const result = tool.parameters.safeParse({
          description: "test task",
          prompt: "do something",
          subagent_type: "explore",
          model: {
            providerID: "anthropic",
            // missing modelID
          },
        })
        expect(result.success).toBe(false)
      },
    })
  })

  test("task tool filters models list based on agent permissions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create a mock agent with model permissions that deny all models
        const agentWithAllModelsDenied: Agent.Info = {
          name: "test-agent",
          mode: "primary",
          permission: [{ permission: "model", pattern: "*", action: "deny" }],
          options: {},
        }

        // Initialize with the agent context - all models denied
        const toolDenied = await TaskTool.init({ agent: agentWithAllModelsDenied })

        // When all models are denied, the models list should be empty
        expect(toolDenied.description).toContain("Available models for the model parameter:\n\n")

        // Create a mock agent with no model restrictions
        const agentWithNoRestrictions: Agent.Info = {
          name: "test-agent",
          mode: "primary",
          permission: [],
          options: {},
        }

        // Initialize with no restrictions - should have models
        const toolAllowed = await TaskTool.init({ agent: agentWithNoRestrictions })

        // With no restrictions, there should be models (not empty after the header)
        expect(toolAllowed.description).not.toContain("Available models for the model parameter:\n\n")
        expect(toolAllowed.description).toContain("Available models for the model parameter:")
      },
    })
  })
})

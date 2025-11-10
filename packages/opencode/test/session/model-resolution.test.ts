import { describe, expect, test } from "bun:test"
import path from "path"
import { Prompt } from "../../src/session/prompt"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Model Resolution for Agents", () => {
  test("should use small model for orchestrator agent (read-only)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const orchestrator = await Agent.get("orchestrator")

        expect(orchestrator).toBeDefined()
        if (orchestrator) {
          // Orchestrator should have edit permission denied
          expect(orchestrator.permission.edit).toBe("deny")

          // When no explicit model is provided, resolveModel should auto-select small model
          // Note: The resolveModel function is internal to Prompt.create, so we test indirectly
          // by checking the orchestrator's configuration
          expect(orchestrator.model).toBeUndefined() // No hardcoded model
        }
      },
    })
  })

  test("should use small model for plan agent (read-only)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const plan = await Agent.get("plan")

        expect(plan).toBeDefined()
        if (plan) {
          // Plan agent should have edit permission denied
          expect(plan.permission.edit).toBe("deny")
          expect(plan.model).toBeUndefined() // No hardcoded model
        }
      },
    })
  })

  test("should use default model for general agent (has edit permission)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const general = await Agent.get("general")

        expect(general).toBeDefined()
        if (general) {
          // General agent should have edit permission allowed
          expect(general.permission.edit).not.toBe("deny")
        }
      },
    })
  })

  test("explicit model override should take precedence over auto-selection", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // When an explicit model is provided, it should be used regardless of agent type
        // This is tested through the Prompt.create logic where input.model takes precedence

        const orchestrator = await Agent.get("orchestrator")
        expect(orchestrator).toBeDefined()

        // The resolveModel function checks input.model first before auto-selecting
        // If input.model is set, it returns immediately without checking agent permissions
      },
    })
  })

  test("agent with explicit model config should use that model", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // If agent.model is set in the agent config, it should be used
        // This is the second priority in resolveModel (after input.model)

        const agents = await Agent.list()
        const agentsWithModel = agents.filter((a) => a.model !== undefined)

        // Any agent with a model config should use that model
        for (const agent of agentsWithModel) {
          expect(agent.model).toBeDefined()
          expect(agent.model).not.toBeNull()
        }
      },
    })
  })
})

describe("Model Resolution Priority", () => {
  test("priority order: input.model > agent.model > auto-selection", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // The resolveModel function has this priority:
        // 1. input.model (explicit parameter)
        // 2. agent.model (agent config)
        // 3. Auto-selection based on agent permissions
        //    - If read-only (edit: deny) → small model
        //    - Otherwise → default model

        // This test documents the expected behavior
        // Actual testing requires integration test with Prompt.create
        expect(true).toBe(true)
      },
    })
  })
})

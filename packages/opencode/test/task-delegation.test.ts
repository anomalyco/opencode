import { describe, test, expect } from "bun:test"
import { Config } from "../src/config/config"
import { Instance } from "../src/project/instance"
import { Agent } from "../src/agent/agent"
import { PermissionNext } from "../src/permission/next"
import { tmpdir } from "./fixture/fixture"

describe("task_budget configuration (caller)", () => {
  test("task_budget is preserved from config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          orchestrator: {
            description: "Agent with high task budget",
            mode: "subagent",
            task_budget: 20,
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const agentConfig = config.agent?.["orchestrator"]
        expect(agentConfig?.task_budget).toBe(20)
      },
    })
  })

  test("task_budget of 0 is preserved (disabled)", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          "disabled-agent": {
            description: "Agent with explicitly disabled budget",
            mode: "subagent",
            task_budget: 0,
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const agentConfig = config.agent?.["disabled-agent"]
        expect(agentConfig?.task_budget).toBe(0)
      },
    })
  })

  test("missing task_budget defaults to undefined (disabled)", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          "default-agent": {
            description: "Agent without task_budget",
            mode: "subagent",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const agentConfig = config.agent?.["default-agent"]
        expect(agentConfig?.task_budget).toBeUndefined()
      },
    })
  })
})

describe("task_budget with permissions config", () => {
  test("task_budget with permission rules for selective delegation", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          orchestrator: {
            description: "Coordinates other subagents",
            mode: "subagent",
            task_budget: 20,
            permission: {
              task: {
                "*": "deny",
                "worker-a": "allow",
                "worker-b": "allow",
              },
            },
          },
          "worker-a": {
            description: "Worker with medium budget",
            mode: "subagent",
            task_budget: 3,
            permission: {
              task: {
                "*": "deny",
                "worker-b": "allow",
              },
            },
          },
          "worker-b": {
            description: "Worker with minimal budget",
            mode: "subagent",
            task_budget: 1,
            permission: {
              task: {
                "*": "deny",
                "worker-a": "allow",
              },
            },
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()

        // Orchestrator: high budget
        const orchestratorConfig = config.agent?.["orchestrator"]
        expect(orchestratorConfig?.task_budget).toBe(20)

        // Verify permission rules
        const orchestratorRuleset = PermissionNext.fromConfig(orchestratorConfig?.permission ?? {})
        expect(PermissionNext.evaluate("task", "worker-a", orchestratorRuleset).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "worker-b", orchestratorRuleset).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "orchestrator", orchestratorRuleset).action).toBe("deny")

        // Worker-A: medium budget
        const workerAConfig = config.agent?.["worker-a"]
        expect(workerAConfig?.task_budget).toBe(3)

        // Worker-B: minimal budget
        const workerBConfig = config.agent?.["worker-b"]
        expect(workerBConfig?.task_budget).toBe(1)
      },
    })
  })
})

describe("backwards compatibility", () => {
  test("agent without delegation config has defaults (disabled)", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          "legacy-agent": {
            description: "Agent without delegation config",
            mode: "subagent",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const agentConfig = config.agent?.["legacy-agent"]

        // Should be undefined/falsy = delegation disabled
        const taskBudget = (agentConfig?.task_budget as number) ?? 0

        expect(taskBudget).toBe(0)
      },
    })
  })

  test("built-in agents should not have delegation config by default", async () => {
    await using tmp = await tmpdir({
      git: true,
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Get the built-in general agent
        const generalAgent = await Agent.get("general")

        // Built-in agents should not have delegation configured
        const taskBudget = generalAgent?.task_budget ?? 0

        expect(taskBudget).toBe(0)
      },
    })
  })
})

describe("level_limit configuration", () => {
  test("level_limit is preserved from config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          level_limit: 8,
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.experimental?.level_limit).toBe(8)
      },
    })
  })

  test("level_limit defaults to undefined when not set (implementation defaults to 5)", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {},
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.experimental?.level_limit).toBeUndefined()
      },
    })
  })

  test("level_limit of 0 is preserved (disabled)", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          level_limit: 0,
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.experimental?.level_limit).toBe(0)
      },
    })
  })
})

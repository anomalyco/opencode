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

describe("callable_by_subagents configuration (target)", () => {
  test("callable_by_subagents true is preserved", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          "callable-worker": {
            description: "Worker that can be called by other subagents",
            mode: "subagent",
            callable_by_subagents: true,
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const agentConfig = config.agent?.["callable-worker"]
        expect(agentConfig?.callable_by_subagents).toBe(true)
      },
    })
  })

  test("callable_by_subagents false is preserved (default)", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          "private-agent": {
            description: "Not callable by subagents",
            mode: "subagent",
            callable_by_subagents: false,
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const agentConfig = config.agent?.["private-agent"]
        expect(agentConfig?.callable_by_subagents).toBe(false)
      },
    })
  })

  test("missing callable_by_subagents defaults to undefined (not callable)", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          "default-agent": {
            description: "Agent without callable_by_subagents",
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
        expect(agentConfig?.callable_by_subagents).toBeUndefined()
      },
    })
  })
})

describe("two-dimensional delegation config", () => {
  test("full delegation config with both dimensions", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          orchestrator: {
            description: "Coordinates other subagents",
            mode: "subagent",
            task_budget: 20,
            callable_by_subagents: false,
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
            callable_by_subagents: true,
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
            callable_by_subagents: true,
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

        // Orchestrator: high budget, not callable by others
        const orchestratorConfig = config.agent?.["orchestrator"]
        expect(orchestratorConfig?.task_budget).toBe(20)
        expect(orchestratorConfig?.callable_by_subagents).toBe(false)

        // Verify permission rules
        const orchestratorRuleset = PermissionNext.fromConfig(orchestratorConfig?.permission ?? {})
        expect(PermissionNext.evaluate("task", "worker-a", orchestratorRuleset).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "worker-b", orchestratorRuleset).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "orchestrator", orchestratorRuleset).action).toBe("deny")

        // Worker-A: medium budget, callable by others
        const workerAConfig = config.agent?.["worker-a"]
        expect(workerAConfig?.task_budget).toBe(3)
        expect(workerAConfig?.callable_by_subagents).toBe(true)

        // Worker-B: minimal budget, callable by others
        const workerBConfig = config.agent?.["worker-b"]
        expect(workerBConfig?.task_budget).toBe(1)
        expect(workerBConfig?.callable_by_subagents).toBe(true)
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

        // Both should be undefined/falsy = delegation disabled
        const taskBudget = (agentConfig?.task_budget as number) ?? 0
        const callable = (agentConfig?.callable_by_subagents as boolean) ?? false

        expect(taskBudget).toBe(0)
        expect(callable).toBe(false)
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
        const callable = generalAgent?.callable_by_subagents ?? false

        expect(taskBudget).toBe(0)
        expect(callable).toBe(false)
      },
    })
  })
})

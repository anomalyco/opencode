import { describe, test, expect } from "bun:test"
import { Config } from "../src/config/config"
import { Instance } from "../src/project/instance"
import { Agent } from "../src/agent/agent"
import { PermissionNext } from "../src/permission/next"
import { tmpdir } from "./fixture/fixture"

describe("task_budget configuration (caller)", () => {
  test("task_budget is preserved in agent.options from config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          "principal-partner": {
            description: "Orchestrator with high budget",
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
        const agentConfig = config.agent?.["principal-partner"]
        expect(agentConfig?.options?.task_budget).toBe(20)
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
        expect(agentConfig?.options?.task_budget).toBe(0)
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
        expect(agentConfig?.options?.task_budget).toBeUndefined()
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
          "assistant-sonnet": {
            description: "Callable assistant",
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
        const agentConfig = config.agent?.["assistant-sonnet"]
        expect(agentConfig?.options?.callable_by_subagents).toBe(true)
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
        expect(agentConfig?.options?.callable_by_subagents).toBe(false)
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
        expect(agentConfig?.options?.callable_by_subagents).toBeUndefined()
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
          "principal-partner": {
            description: "Orchestrates complex workflows",
            mode: "subagent",
            task_budget: 20,
            callable_by_subagents: false,
            permission: {
              task: {
                "*": "deny",
                "assistant-sonnet": "allow",
                "assistant-flash": "allow",
              },
            },
          },
          "assistant-sonnet": {
            description: "Thorough analysis",
            mode: "subagent",
            task_budget: 3,
            callable_by_subagents: true,
            permission: {
              task: {
                "*": "deny",
                "assistant-flash": "allow",
              },
            },
          },
          "assistant-flash": {
            description: "Fast analytical passes",
            mode: "subagent",
            task_budget: 1,
            callable_by_subagents: true,
            permission: {
              task: {
                "*": "deny",
                "assistant-sonnet": "allow",
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

        // Principal-Partner: high budget, not callable
        const partnerConfig = config.agent?.["principal-partner"]
        expect(partnerConfig?.options?.task_budget).toBe(20)
        expect(partnerConfig?.options?.callable_by_subagents).toBe(false)

        // Verify permission rules
        const partnerRuleset = PermissionNext.fromConfig(partnerConfig?.permission ?? {})
        expect(PermissionNext.evaluate("task", "assistant-sonnet", partnerRuleset).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "assistant-flash", partnerRuleset).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "principal-partner", partnerRuleset).action).toBe("deny")

        // Assistant-Sonnet: lower budget, callable
        const sonnetConfig = config.agent?.["assistant-sonnet"]
        expect(sonnetConfig?.options?.task_budget).toBe(3)
        expect(sonnetConfig?.options?.callable_by_subagents).toBe(true)

        // Assistant-Flash: lowest budget, callable
        const flashConfig = config.agent?.["assistant-flash"]
        expect(flashConfig?.options?.task_budget).toBe(1)
        expect(flashConfig?.options?.callable_by_subagents).toBe(true)
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
        const taskBudget = (agentConfig?.options?.task_budget as number) ?? 0
        const callable = (agentConfig?.options?.callable_by_subagents as boolean) ?? false

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
        const taskBudget = (generalAgent?.options?.task_budget as number) ?? 0
        const callable = (generalAgent?.options?.callable_by_subagents as boolean) ?? false

        expect(taskBudget).toBe(0)
        expect(callable).toBe(false)
      },
    })
  })
})

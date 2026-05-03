import { afterEach, test, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { disposeAllInstances, provideInstance, tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { Global } from "@opencode-ai/core/global"

// Helper to evaluate permission for a tool with wildcard pattern
function evalPerm(agent: Agent.Info | undefined, permission: string): Permission.Action | undefined {
  if (!agent) return undefined
  return Permission.evaluate(permission, "*", agent.permission).action
}

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

afterEach(async () => {
  await disposeAllInstances()
})

test("returns default native agents when no config", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await load(tmp.path, (svc) => svc.list())
      const names = agents.map((a) => a.name)
      expect(names).toContain("build")
      expect(names).toContain("plan")
      expect(names).toContain("general")
      expect(names).toContain("explore")
      expect(names).toContain("compaction")
      expect(names).toContain("title")
      expect(names).toContain("summary")
    },
  })
})

test("build agent has correct default properties", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(build).toBeDefined()
      expect(build?.mode).toBe("primary")
      expect(build?.native).toBe(true)
      expect(evalPerm(build, "edit")).toBe("allow")
      expect(evalPerm(build, "bash")).toBe("allow")
    },
  })
})

test("plan agent denies edits except .opencode/plans/*", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      expect(plan).toBeDefined()
      // Wildcard is denied
      expect(evalPerm(plan, "edit")).toBe("deny")
      // But specific path is allowed
      expect(Permission.evaluate("edit", ".opencode/plans/foo.md", plan!.permission).action).toBe("allow")
    },
  })
})

test("explore agent denies edit and write", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await load(tmp.path, (svc) => svc.get("explore"))
      expect(explore).toBeDefined()
      expect(explore?.mode).toBe("subagent")
      expect(evalPerm(explore, "edit")).toBe("deny")
      expect(evalPerm(explore, "write")).toBe("deny")
      expect(evalPerm(explore, "todowrite")).toBe("deny")
    },
  })
})

test("explore agent asks for external directories and allows whitelisted external paths", async () => {
  const { Truncate } = await import("../../src/tool/truncate")
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await load(tmp.path, (svc) => svc.get("explore"))
      expect(explore).toBeDefined()
      expect(Permission.evaluate("external_directory", "/some/other/path", explore!.permission).action).toBe("ask")
      expect(Permission.evaluate("external_directory", Truncate.GLOB, explore!.permission).action).toBe("allow")
      expect(
        Permission.evaluate("external_directory", path.join(Global.Path.tmp, "agent-work"), explore!.permission).action,
      ).toBe("allow")
    },
  })
})

test("general agent denies todo tools", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const general = await load(tmp.path, (svc) => svc.get("general"))
      expect(general).toBeDefined()
      expect(general?.mode).toBe("subagent")
      expect(general?.hidden).toBeUndefined()
      expect(evalPerm(general, "todowrite")).toBe("deny")
    },
  })
})

test("compaction agent denies all permissions", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const compaction = await load(tmp.path, (svc) => svc.get("compaction"))
      expect(compaction).toBeDefined()
      expect(compaction?.hidden).toBe(true)
      expect(evalPerm(compaction, "bash")).toBe("deny")
      expect(evalPerm(compaction, "edit")).toBe("deny")
      expect(evalPerm(compaction, "read")).toBe("deny")
    },
  })
})

test("custom agent from config creates new agent", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        my_custom_agent: {
          model: "openai/gpt-4",
          description: "My custom agent",
          temperature: 0.5,
          top_p: 0.9,
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const custom = await load(tmp.path, (svc) => svc.get("my_custom_agent"))
      expect(custom).toBeDefined()
      expect(String(custom?.model?.providerID)).toBe("openai")
      expect(String(custom?.model?.modelID)).toBe("gpt-4")
      expect(custom?.description).toBe("My custom agent")
      expect(custom?.temperature).toBe(0.5)
      expect(custom?.topP).toBe(0.9)
      expect(custom?.native).toBe(false)
      expect(custom?.mode).toBe("all")
    },
  })
})

test("custom agent config overrides native agent properties", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          model: "anthropic/claude-3",
          description: "Custom build agent",
          temperature: 0.7,
          color: "#FF0000",
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(build).toBeDefined()
      expect(String(build?.model?.providerID)).toBe("anthropic")
      expect(String(build?.model?.modelID)).toBe("claude-3")
      expect(build?.description).toBe("Custom build agent")
      expect(build?.temperature).toBe(0.7)
      expect(build?.color).toBe("#FF0000")
      expect(build?.native).toBe(true)
    },
  })
})

test("agent disable removes agent from list", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        explore: { disable: true },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await load(tmp.path, (svc) => svc.get("explore"))
      expect(explore).toBeUndefined()
      const agents = await load(tmp.path, (svc) => svc.list())
      const names = agents.map((a) => a.name)
      expect(names).not.toContain("explore")
    },
  })
})

test("agent permission config merges with defaults", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          permission: {
            bash: {
              "rm -rf *": "deny",
            },
          },
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(build).toBeDefined()
      // Specific pattern is denied
      expect(Permission.evaluate("bash", "rm -rf *", build!.permission).action).toBe("deny")
      // Edit still allowed
      expect(evalPerm(build, "edit")).toBe("allow")
    },
  })
})

test("global permission config applies to all agents", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        bash: "deny",
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(build).toBeDefined()
      expect(evalPerm(build, "bash")).toBe("deny")
    },
  })
})

test("agent steps/maxSteps config sets steps property", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { steps: 50 },
        plan: { maxSteps: 100 },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      const plan = await load(tmp.path, (svc) => svc.get("plan"))
      expect(build?.steps).toBe(50)
      expect(plan?.steps).toBe(100)
    },
  })
})

test("agent mode can be overridden", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        explore: { mode: "primary" },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const explore = await load(tmp.path, (svc) => svc.get("explore"))
      expect(explore?.mode).toBe("primary")
    },
  })
})

test("agent name can be overridden", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { name: "Builder" },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(build?.name).toBe("Builder")
    },
  })
})

test("agent prompt can be set from config", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { prompt: "Custom system prompt" },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(build?.prompt).toBe("Custom system prompt")
    },
  })
})

test("unknown agent properties are placed into options", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          random_property: "hello",
          another_random: 123,
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(build?.options.random_property).toBe("hello")
      expect(build?.options.another_random).toBe(123)
    },
  })
})

test("agent options merge correctly", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          options: {
            custom_option: true,
            another_option: "value",
          },
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(build?.options.custom_option).toBe(true)
      expect(build?.options.another_option).toBe("value")
    },
  })
})

test("multiple custom agents can be defined", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        agent_a: {
          description: "Agent A",
          mode: "subagent",
        },
        agent_b: {
          description: "Agent B",
          mode: "primary",
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agentA = await load(tmp.path, (svc) => svc.get("agent_a"))
      const agentB = await load(tmp.path, (svc) => svc.get("agent_b"))
      expect(agentA?.description).toBe("Agent A")
      expect(agentA?.mode).toBe("subagent")
      expect(agentB?.description).toBe("Agent B")
      expect(agentB?.mode).toBe("primary")
    },
  })
})

test("Agent.list keeps the default agent first and sorts the rest by name", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "plan",
      agent: {
        zebra: {
          description: "Zebra",
          mode: "subagent",
        },
        alpha: {
          description: "Alpha",
          mode: "subagent",
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const names = (await load(tmp.path, (svc) => svc.list())).map((a) => a.name)
      expect(names[0]).toBe("plan")
      expect(names.slice(1)).toEqual(names.slice(1).toSorted((a, b) => a.localeCompare(b)))
    },
  })
})

test("Agent.get returns undefined for non-existent agent", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const nonExistent = await load(tmp.path, (svc) => svc.get("does_not_exist"))
      expect(nonExistent).toBeUndefined()
    },
  })
})

test("default permission includes doom_loop and external_directory as ask", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(evalPerm(build, "doom_loop")).toBe("ask")
      expect(evalPerm(build, "external_directory")).toBe("ask")
    },
  })
})

test("webfetch is allowed by default", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(evalPerm(build, "webfetch")).toBe("allow")
    },
  })
})

test("legacy tools config converts to permissions", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          tools: {
            bash: false,
            read: false,
          },
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(evalPerm(build, "bash")).toBe("deny")
      expect(evalPerm(build, "read")).toBe("deny")
    },
  })
})

test("legacy tools config maps write/edit/patch to edit permission", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          tools: {
            write: false,
          },
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(evalPerm(build, "edit")).toBe("deny")
    },
  })
})

test("Truncate.GLOB is allowed even when user denies external_directory globally", async () => {
  const { Truncate } = await import("../../src/tool/truncate")
  await using tmp = await tmpdir({
    config: {
      permission: {
        external_directory: "deny",
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(Permission.evaluate("external_directory", Truncate.GLOB, build!.permission).action).toBe("allow")
      expect(Permission.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
      expect(Permission.evaluate("external_directory", "/some/other/path", build!.permission).action).toBe("deny")
    },
  })
})

test("global tmp directory children are allowed for external_directory", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(
        Permission.evaluate("external_directory", path.join(Global.Path.tmp, "scratch"), build!.permission).action,
      ).toBe("allow")
      expect(Permission.evaluate("external_directory", "/some/other/path", build!.permission).action).toBe("ask")
    },
  })
})

test("Truncate.GLOB is allowed even when user denies external_directory per-agent", async () => {
  const { Truncate } = await import("../../src/tool/truncate")
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: {
          permission: {
            external_directory: "deny",
          },
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(Permission.evaluate("external_directory", Truncate.GLOB, build!.permission).action).toBe("allow")
      expect(Permission.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
      expect(Permission.evaluate("external_directory", "/some/other/path", build!.permission).action).toBe("deny")
    },
  })
})

test("explicit Truncate.GLOB deny is respected", async () => {
  const { Truncate } = await import("../../src/tool/truncate")
  await using tmp = await tmpdir({
    config: {
      permission: {
        external_directory: {
          "*": "deny",
          [Truncate.GLOB]: "deny",
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await load(tmp.path, (svc) => svc.get("build"))
      expect(Permission.evaluate("external_directory", Truncate.GLOB, build!.permission).action).toBe("deny")
      expect(Permission.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
    },
  })
})

test("skill directories are allowed for external_directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "perm-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: perm-skill
description: Permission skill.
---

# Permission Skill
`,
      )
    },
  })

  const home = process.env.OPENCODE_TEST_HOME
  process.env.OPENCODE_TEST_HOME = tmp.path

  try {
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await load(tmp.path, (svc) => svc.get("build"))
        const skillDir = path.join(tmp.path, ".opencode", "skill", "perm-skill")
        const target = path.join(skillDir, "reference", "notes.md")
        expect(Permission.evaluate("external_directory", target, build!.permission).action).toBe("allow")
      },
    })
  } finally {
    process.env.OPENCODE_TEST_HOME = home
  }
})

test("defaultAgent returns build when no default_agent config", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await load(tmp.path, (svc) => svc.defaultAgent())
      expect(agent).toBe("build")
    },
  })
})

test("defaultAgent respects default_agent config set to plan", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "plan",
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await load(tmp.path, (svc) => svc.defaultAgent())
      expect(agent).toBe("plan")
    },
  })
})

test("defaultAgent respects default_agent config set to custom agent with mode all", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "my_custom",
      agent: {
        my_custom: {
          description: "My custom agent",
        },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await load(tmp.path, (svc) => svc.defaultAgent())
      expect(agent).toBe("my_custom")
    },
  })
})

test("defaultAgent throws when default_agent points to subagent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "explore",
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(load(tmp.path, (svc) => svc.defaultAgent())).rejects.toThrow('default agent "explore" is a subagent')
    },
  })
})

test("defaultAgent throws when default_agent points to hidden agent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "compaction",
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(load(tmp.path, (svc) => svc.defaultAgent())).rejects.toThrow('default agent "compaction" is hidden')
    },
  })
})

test("defaultAgent throws when default_agent points to non-existent agent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "does_not_exist",
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(load(tmp.path, (svc) => svc.defaultAgent())).rejects.toThrow(
        'default agent "does_not_exist" not found',
      )
    },
  })
})

test("defaultAgent returns plan when build is disabled and default_agent not set", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { disable: true },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await load(tmp.path, (svc) => svc.defaultAgent())
      // build is disabled, so it should return plan (next primary agent)
      expect(agent).toBe("plan")
    },
  })
})

test("defaultAgent throws when all primary agents are disabled", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { disable: true },
        plan: { disable: true },
      },
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      // build and plan are disabled, no primary-capable agents remain
      await expect(load(tmp.path, (svc) => svc.defaultAgent())).rejects.toThrow("no primary visible agent found")
    },
  })
})

import { afterEach, expect } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import path from "path"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Agent } from "../../src/agent/agent"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Permission } from "../../src/permission"
import { Truncate } from "../../src/tool/truncate"

const it = testEffect(Agent.defaultLayer)

// Helper to evaluate permission for a tool with wildcard pattern
function evalPerm(agent: Agent.Info | undefined, permission: string): Permission.Action | undefined {
  if (!agent) return undefined
  return Permission.evaluate(permission, "*", agent.permission).action
}

function load<A>(fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Agent.Service.use(fn)
}

function withExperimentalScout<A, E, R>(enabled: boolean, self: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const original = Flag.OPENCODE_EXPERIMENTAL_SCOUT
      Flag.OPENCODE_EXPERIMENTAL_SCOUT = enabled
      return original
    }),
    () => self,
    (original) =>
      Effect.sync(() => {
        Flag.OPENCODE_EXPERIMENTAL_SCOUT = original
      }),
  )
}

const expectDefaultAgentError = Effect.fn("AgentTest.expectDefaultAgentError")(function* (message: string) {
  const exit = yield* load((svc) => svc.defaultAgent()).pipe(Effect.exit)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain(message)
})

afterEach(async () => {
  await disposeAllInstances()
})

it.instance("returns default native agents when no config", () =>
  withExperimentalScout(
    false,
    Effect.gen(function* () {
      const agents = yield* load((svc) => svc.list())
      const names = agents.map((a) => a.name)
      expect(names).toContain("build")
      expect(names).toContain("plan")
      expect(names).toContain("general")
      expect(names).toContain("explore")
      expect(names).not.toContain("scout")
      expect(names).toContain("compaction")
      expect(names).toContain("title")
      expect(names).toContain("summary")
    }),
  ),
)

it.instance("build agent has correct default properties", () =>
  Effect.gen(function* () {
    const build = yield* load((svc) => svc.get("build"))
    expect(build).toBeDefined()
    expect(build?.mode).toBe("primary")
    expect(build?.native).toBe(true)
    expect(evalPerm(build, "edit")).toBe("allow")
    expect(evalPerm(build, "bash")).toBe("allow")
    expect(evalPerm(build, "repo_clone")).toBe("deny")
    expect(evalPerm(build, "repo_overview")).toBe("deny")
  }),
)

it.instance("plan agent denies edits except .opencode/plans/*", () =>
  Effect.gen(function* () {
    const plan = yield* load((svc) => svc.get("plan"))
    expect(plan).toBeDefined()
    // Wildcard is denied
    expect(evalPerm(plan, "edit")).toBe("deny")
    // But specific path is allowed
    expect(Permission.evaluate("edit", ".opencode/plans/foo.md", plan!.permission).action).toBe("allow")
  }),
)

it.instance("explore agent denies edit and write", () =>
  Effect.gen(function* () {
    const explore = yield* load((svc) => svc.get("explore"))
    expect(explore).toBeDefined()
    expect(explore?.mode).toBe("subagent")
    expect(evalPerm(explore, "edit")).toBe("deny")
    expect(evalPerm(explore, "write")).toBe("deny")
    expect(evalPerm(explore, "todowrite")).toBe("deny")
  }),
)

it.instance("explore agent asks for external directories and allows whitelisted external paths", () =>
  Effect.gen(function* () {
    const explore = yield* load((svc) => svc.get("explore"))
    expect(explore).toBeDefined()
    expect(Permission.evaluate("external_directory", "/some/other/path", explore!.permission).action).toBe("ask")
    expect(Permission.evaluate("external_directory", Truncate.GLOB, explore!.permission).action).toBe("allow")
    expect(
      Permission.evaluate("external_directory", path.join(Global.Path.tmp, "agent-work"), explore!.permission).action,
    ).toBe("allow")
  }),
)

it.instance("scout agent allows repo cloning and repo cache reads", () =>
  withExperimentalScout(
    true,
    Effect.gen(function* () {
      const scout = yield* load((svc) => svc.get("scout"))
      expect(scout).toBeDefined()
      expect(scout?.mode).toBe("subagent")
      expect(evalPerm(scout, "repo_clone")).toBe("allow")
      expect(evalPerm(scout, "repo_overview")).toBe("allow")
      expect(evalPerm(scout, "edit")).toBe("deny")
      expect(
        Permission.evaluate(
          "external_directory",
          path.join(Global.Path.repos, "github.com", "owner", "repo", "README.md"),
          scout!.permission,
        ).action,
      ).toBe("allow")
    }),
  ),
)

it.instance(
  "reference config does not create subagents",
  () =>
    withExperimentalScout(
      true,
      Effect.gen(function* () {
        const agents = yield* load((svc) => svc.list())
        const names = agents.map((agent) => agent.name)
        expect(names).toContain("scout")
        expect(names).not.toContain("effect")
        expect(names).not.toContain("effectFull")
        expect(names).not.toContain("localdocs")
        expect(names).not.toContain("localdocsFull")
      }),
    ),
  {
    config: {
      reference: {
        effect: "github.com/effect/effect-smol",
        effectFull: {
          repository: "Effect-TS/effect",
          branch: "main",
        },
        localdocs: "../docs",
        localdocsFull: {
          path: "../local-docs",
        },
      },
    },
  },
)

it.instance("general agent denies todo tools", () =>
  Effect.gen(function* () {
    const general = yield* load((svc) => svc.get("general"))
    expect(general).toBeDefined()
    expect(general?.mode).toBe("subagent")
    expect(general?.hidden).toBeUndefined()
    expect(evalPerm(general, "todowrite")).toBe("deny")
  }),
)

it.instance("compaction agent denies all permissions", () =>
  Effect.gen(function* () {
    const compaction = yield* load((svc) => svc.get("compaction"))
    expect(compaction).toBeDefined()
    expect(compaction?.hidden).toBe(true)
    expect(evalPerm(compaction, "bash")).toBe("deny")
    expect(evalPerm(compaction, "edit")).toBe("deny")
    expect(evalPerm(compaction, "read")).toBe("deny")
  }),
)

it.instance(
  "custom agent from config creates new agent",
  () =>
    Effect.gen(function* () {
      const custom = yield* load((svc) => svc.get("my_custom_agent"))
      expect(custom).toBeDefined()
      expect(String(custom?.model?.providerID)).toBe("openai")
      expect(String(custom?.model?.modelID)).toBe("gpt-4")
      expect(custom?.description).toBe("My custom agent")
      expect(custom?.temperature).toBe(0.5)
      expect(custom?.topP).toBe(0.9)
      expect(custom?.native).toBe(false)
      expect(custom?.mode).toBe("all")
    }),
  {
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
  },
)

it.instance(
  "custom agent config overrides native agent properties",
  () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.get("build"))
      expect(build).toBeDefined()
      expect(String(build?.model?.providerID)).toBe("anthropic")
      expect(String(build?.model?.modelID)).toBe("claude-3")
      expect(build?.description).toBe("Custom build agent")
      expect(build?.temperature).toBe(0.7)
      expect(build?.color).toBe("#FF0000")
      expect(build?.native).toBe(true)
    }),
  {
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
  },
)

it.instance(
  "agent disable removes agent from list",
  () =>
    Effect.gen(function* () {
      const explore = yield* load((svc) => svc.get("explore"))
      expect(explore).toBeUndefined()
      const agents = yield* load((svc) => svc.list())
      const names = agents.map((a) => a.name)
      expect(names).not.toContain("explore")
    }),
  {
    config: {
      agent: {
        explore: { disable: true },
      },
    },
  },
)

it.instance(
  "agent permission config merges with defaults",
  () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.get("build"))
      expect(build).toBeDefined()
      // Specific pattern is denied
      expect(Permission.evaluate("bash", "rm -rf *", build!.permission).action).toBe("deny")
      // Edit still allowed
      expect(evalPerm(build, "edit")).toBe("allow")
    }),
  {
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
  },
)

it.instance(
  "global permission config applies to all agents",
  () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.get("build"))
      expect(build).toBeDefined()
      expect(evalPerm(build, "bash")).toBe("deny")
    }),
  {
    config: {
      permission: {
        bash: "deny",
      },
    },
  },
)

it.instance(
  "agent steps/maxSteps config sets steps property",
  () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.get("build"))
      const plan = yield* load((svc) => svc.get("plan"))
      expect(build?.steps).toBe(50)
      expect(plan?.steps).toBe(100)
    }),
  {
    config: {
      agent: {
        build: { steps: 50 },
        plan: { maxSteps: 100 },
      },
    },
  },
)

it.instance(
  "agent mode can be overridden",
  () =>
    Effect.gen(function* () {
      const explore = yield* load((svc) => svc.get("explore"))
      expect(explore?.mode).toBe("primary")
    }),
  {
    config: {
      agent: {
        explore: { mode: "primary" },
      },
    },
  },
)

it.instance(
  "agent name can be overridden",
  () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.get("build"))
      expect(build?.name).toBe("Builder")
    }),
  {
    config: {
      agent: {
        build: { name: "Builder" },
      },
    },
  },
)

it.instance(
  "agent prompt can be set from config",
  () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.get("build"))
      expect(build?.prompt).toBe("Custom system prompt")
    }),
  {
    config: {
      agent: {
        build: { prompt: "Custom system prompt" },
      },
    },
  },
)

it.instance(
  "unknown agent properties are placed into options",
  () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.get("build"))
      expect(build?.options.random_property).toBe("hello")
      expect(build?.options.another_random).toBe(123)
    }),
  {
    config: {
      agent: {
        build: {
          random_property: "hello",
          another_random: 123,
        },
      },
    },
  },
)

it.instance(
  "agent options merge correctly",
  () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.get("build"))
      expect(build?.options.custom_option).toBe(true)
      expect(build?.options.another_option).toBe("value")
    }),
  {
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
  },
)

it.instance(
  "multiple custom agents can be defined",
  () =>
    Effect.gen(function* () {
      const agentA = yield* load((svc) => svc.get("agent_a"))
      const agentB = yield* load((svc) => svc.get("agent_b"))
      expect(agentA?.description).toBe("Agent A")
      expect(agentA?.mode).toBe("subagent")
      expect(agentB?.description).toBe("Agent B")
      expect(agentB?.mode).toBe("primary")
    }),
  {
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
  },
)

it.instance(
  "Agent.list keeps the default agent first and sorts the rest by name",
  () =>
    Effect.gen(function* () {
      const names = (yield* load((svc) => svc.list())).map((a) => a.name)
      expect(names[0]).toBe("plan")
      expect(names.slice(1)).toEqual(names.slice(1).toSorted((a, b) => a.localeCompare(b)))
    }),
  {
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
  },
)

it.instance("Agent.get returns undefined for non-existent agent", () =>
  Effect.gen(function* () {
    const nonExistent = yield* load((svc) => svc.get("does_not_exist"))
    expect(nonExistent).toBeUndefined()
  }),
)

it.instance("default permission includes doom_loop and external_directory as ask", () =>
  Effect.gen(function* () {
    const build = yield* load((svc) => svc.get("build"))
    expect(evalPerm(build, "doom_loop")).toBe("ask")
    expect(evalPerm(build, "external_directory")).toBe("ask")
  }),
)

it.instance("webfetch is allowed by default", () =>
  Effect.gen(function* () {
    const build = yield* load((svc) => svc.get("build"))
    expect(evalPerm(build, "webfetch")).toBe("allow")
  }),
)

it.instance(
  "legacy tools config converts to permissions",
  () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.get("build"))
      expect(evalPerm(build, "bash")).toBe("deny")
      expect(evalPerm(build, "read")).toBe("deny")
    }),
  {
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
  },
)

it.instance(
  "legacy tools config maps write/edit/patch to edit permission",
  () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.get("build"))
      expect(evalPerm(build, "edit")).toBe("deny")
    }),
  {
    config: {
      agent: {
        build: {
          tools: {
            write: false,
          },
        },
      },
    },
  },
)

it.instance(
  "Truncate.GLOB is allowed even when user denies external_directory globally",
  () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.get("build"))
      expect(Permission.evaluate("external_directory", Truncate.GLOB, build!.permission).action).toBe("allow")
      expect(Permission.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
      expect(Permission.evaluate("external_directory", "/some/other/path", build!.permission).action).toBe("deny")
    }),
  {
    config: {
      permission: {
        external_directory: "deny",
      },
    },
  },
)

it.instance("global tmp directory children are allowed for external_directory", () =>
  Effect.gen(function* () {
    const build = yield* load((svc) => svc.get("build"))
    expect(
      Permission.evaluate("external_directory", path.join(Global.Path.tmp, "scratch"), build!.permission).action,
    ).toBe("allow")
    expect(Permission.evaluate("external_directory", "/some/other/path", build!.permission).action).toBe("ask")
  }),
)

it.instance(
  "Truncate.GLOB is allowed even when user denies external_directory per-agent",
  () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.get("build"))
      expect(Permission.evaluate("external_directory", Truncate.GLOB, build!.permission).action).toBe("allow")
      expect(Permission.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
      expect(Permission.evaluate("external_directory", "/some/other/path", build!.permission).action).toBe("deny")
    }),
  {
    config: {
      agent: {
        build: {
          permission: {
            external_directory: "deny",
          },
        },
      },
    },
  },
)

it.instance(
  "explicit Truncate.GLOB deny is respected",
  () =>
    Effect.gen(function* () {
      const build = yield* load((svc) => svc.get("build"))
      expect(Permission.evaluate("external_directory", Truncate.GLOB, build!.permission).action).toBe("deny")
      expect(Permission.evaluate("external_directory", Truncate.DIR, build!.permission).action).toBe("deny")
    }),
  {
    config: {
      permission: {
        external_directory: {
          "*": "deny",
          [Truncate.GLOB]: "deny",
        },
      },
    },
  },
)

it.instance(
  "skill directories are allowed for external_directory",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const skillDir = path.join(test.directory, ".opencode", "skill", "perm-skill")
      yield* Effect.promise(() =>
        Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: perm-skill
description: Permission skill.
---

# Permission Skill
`,
        ),
      )

      const home = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = test.directory
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          process.env.OPENCODE_TEST_HOME = home
        }),
      )

      const build = yield* load((svc) => svc.get("build"))
      const target = path.join(skillDir, "reference", "notes.md")
      expect(Permission.evaluate("external_directory", target, build!.permission).action).toBe("allow")
    }),
  { git: true },
)

it.instance("defaultAgent returns build when no default_agent config", () =>
  Effect.gen(function* () {
    const agent = yield* load((svc) => svc.defaultAgent())
    expect(agent).toBe("build")
  }),
)

it.instance(
  "defaultAgent respects default_agent config set to plan",
  () =>
    Effect.gen(function* () {
      const agent = yield* load((svc) => svc.defaultAgent())
      expect(agent).toBe("plan")
    }),
  {
    config: {
      default_agent: "plan",
    },
  },
)

it.instance(
  "defaultAgent respects default_agent config set to custom agent with mode all",
  () =>
    Effect.gen(function* () {
      const agent = yield* load((svc) => svc.defaultAgent())
      expect(agent).toBe("my_custom")
    }),
  {
    config: {
      default_agent: "my_custom",
      agent: {
        my_custom: {
          description: "My custom agent",
        },
      },
    },
  },
)

it.instance(
  "defaultAgent throws when default_agent points to subagent",
  () => expectDefaultAgentError('default agent "explore" is a subagent'),
  {
    config: {
      default_agent: "explore",
    },
  },
)

it.instance(
  "defaultAgent throws when default_agent points to hidden agent",
  () => expectDefaultAgentError('default agent "compaction" is hidden'),
  {
    config: {
      default_agent: "compaction",
    },
  },
)

it.instance(
  "defaultAgent throws when default_agent points to non-existent agent",
  () => expectDefaultAgentError('default agent "does_not_exist" not found'),
  {
    config: {
      default_agent: "does_not_exist",
    },
  },
)

it.instance(
  "defaultAgent returns plan when build is disabled and default_agent not set",
  () =>
    Effect.gen(function* () {
      const agent = yield* load((svc) => svc.defaultAgent())
      // build is disabled, so it should return plan (next primary agent)
      expect(agent).toBe("plan")
    }),
  {
    config: {
      agent: {
        build: { disable: true },
      },
    },
  },
)

it.instance(
  "defaultAgent throws when all primary agents are disabled",
  () => expectDefaultAgentError("no primary visible agent found"),
  {
    config: {
      agent: {
        build: { disable: true },
        plan: { disable: true },
      },
    },
  },
)

import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigAgentPlugin } from "@opencode-ai/core/config/plugin/agent"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { testEffect } from "../lib/effect"

const it = testEffect(AgentV2.defaultLayer)
const decode = Schema.decodeUnknownSync(Config.Info)

describe("ConfigAgentPlugin.Plugin", () => {
  it.effect("applies global permissions between built-in and agent-specific permissions", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const build = AgentV2.ID.make("build")
      const defaults = yield* agents.transform()

      yield* defaults((editor) =>
        editor.update(build, (agent) => {
          agent.mode = "primary"
          agent.permissions.push({ permission: "bash", pattern: "*", action: "allow" })
        }),
      )

      const config = Config.Service.of({
        directories: () => Effect.succeed([]),
        get: () =>
          Effect.succeed([
            new Config.Loaded({
              source: { type: "memory" },
              info: decode({
                permissions: [{ permission: "bash", pattern: "*", action: "ask" }],
                agents: {
                  build: {
                    permissions: [{ permission: "bash", pattern: "git *", action: "allow" }],
                  },
                  reviewer: {
                    model: "openrouter/openai/gpt-5",
                    description: "Review changes",
                    mode: "subagent",
                    permissions: [{ permission: "edit", pattern: "*", action: "deny" }],
                  },
                  removed: { description: "Removed later" },
                },
              }),
            }),
            new Config.Loaded({
              source: { type: "memory" },
              info: decode({
                agents: {
                  reviewer: { variant: "high", hidden: true },
                  removed: { disabled: true },
                },
              }),
            }),
          ]),
      })

      yield* ConfigAgentPlugin.Plugin.effect.pipe(
        Effect.provideService(Config.Service, config),
        Effect.provideService(AgentV2.Service, agents),
      )

      const buildAgent = yield* agents.get(build)
      if (!buildAgent) throw new Error("expected configured build agent")
      expect(buildAgent.permissions).toEqual([
        { permission: "bash", pattern: "*", action: "allow" },
        { permission: "bash", pattern: "*", action: "ask" },
        { permission: "bash", pattern: "git *", action: "allow" },
      ])
      expect(PermissionV2.evaluate("bash", "git status", buildAgent.permissions).action).toBe("allow")
      expect(PermissionV2.evaluate("bash", "bun test", buildAgent.permissions).action).toBe("ask")

      const reviewer = yield* agents.get(AgentV2.ID.make("reviewer"))
      if (!reviewer) throw new Error("expected configured reviewer agent")
      expect(reviewer).toMatchObject({
        description: "Review changes",
        mode: "subagent",
        hidden: true,
        model: { providerID: "openrouter", id: "openai/gpt-5", variant: "high" },
      })
      expect(reviewer.permissions).toEqual([
        { permission: "bash", pattern: "*", action: "ask" },
        { permission: "edit", pattern: "*", action: "deny" },
      ])
      expect(yield* agents.get(AgentV2.ID.make("removed"))).toBeUndefined()
    }),
  )

  it.effect("maps configured agent fields and preserves an unspecified model variant", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const config = Config.Service.of({
        directories: () => Effect.succeed([]),
        get: () =>
          Effect.succeed([
            new Config.Loaded({
              source: { type: "memory" },
              info: decode({
                agents: {
                  reviewer: {
                    model: "anthropic/claude-sonnet",
                    system: "Review carefully.",
                    description: "Reviews changes",
                    mode: "subagent",
                    hidden: true,
                    color: "warning",
                    steps: 12,
                    options: {
                      headers: { first: "one", shared: "first" },
                      body: { enabled: true },
                      aisdk: { provider: { profile: "review" }, request: { effort: "medium" } },
                    },
                  },
                },
              }),
            }),
            new Config.Loaded({
              source: { type: "memory" },
              info: decode({
                agents: {
                  reviewer: {
                    options: {
                      headers: { shared: "last", second: "two" },
                      body: { retries: 2 },
                      aisdk: { request: { effort: "high" } },
                    },
                  },
                },
              }),
            }),
          ]),
      })

      yield* ConfigAgentPlugin.Plugin.effect.pipe(
        Effect.provideService(Config.Service, config),
        Effect.provideService(AgentV2.Service, agents),
      )

      const reviewer = yield* agents.get(AgentV2.ID.make("reviewer"))
      if (!reviewer) throw new Error("expected configured reviewer agent")
      expect(reviewer).toMatchObject({
        system: "Review carefully.",
        description: "Reviews changes",
        mode: "subagent",
        hidden: true,
        color: "warning",
        steps: 12,
        model: { providerID: "anthropic", id: "claude-sonnet", variant: undefined },
      })
      expect(reviewer.options).toEqual({
        headers: { first: "one", shared: "last", second: "two" },
        body: { enabled: true, retries: 2 },
        aisdk: { provider: { profile: "review" }, request: { effort: "high" } },
      })
    }),
  )

  it.effect("removes a built-in agent disabled by configuration", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const build = AgentV2.ID.make("build")
      const defaults = yield* agents.transform()
      yield* defaults((editor) => editor.update(build, () => {}))

      const config = Config.Service.of({
        directories: () => Effect.succeed([]),
        get: () =>
          Effect.succeed([
            new Config.Loaded({
              source: { type: "memory" },
              info: decode({ agents: { build: { disabled: true } } }),
            }),
          ]),
      })

      yield* ConfigAgentPlugin.Plugin.effect.pipe(
        Effect.provideService(Config.Service, config),
        Effect.provideService(AgentV2.Service, agents),
      )

      expect(yield* agents.get(build)).toBeUndefined()
    }),
  )
})

import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, Schema } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigAgentPlugin } from "@opencode-ai/core/config/plugin/agent"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { agentHost, host } from "../plugin/host"

const it = testEffect(Layer.mergeAll(AgentV2.locationLayer, FSUtil.defaultLayer))
const decode = Schema.decodeUnknownSync(Config.Info)

describe("ConfigAgentPlugin.Plugin", () => {
  it.effect("applies all global permissions before agent-specific permissions", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const build = AgentV2.ID.make("build")
      yield* agents.transform((editor) =>
        editor.update(build, (agent) => {
          agent.mode = "primary"
          agent.permissions.push({ action: "bash", resource: "*", effect: "allow" })
        }),
      )

      const config = Config.Service.of({
        entries: () =>
          Effect.succeed([
            new Config.Document({
              type: "document",
              info: decode({
                permissions: [{ action: "bash", resource: "*", effect: "ask" }],
                agents: {
                  build: {
                    permissions: [{ action: "bash", resource: "git *", effect: "allow" }],
                  },
                  reviewer: {
                    model: "openrouter/openai/gpt-5",
                    description: "Review changes",
                    mode: "subagent",
                    permissions: [
                      { action: "edit", resource: "*", effect: "deny" },
                      { action: "read", resource: "*", effect: "deny" },
                    ],
                  },
                  removed: { description: "Removed later" },
                },
              }),
            }),
            new Config.Document({
              type: "document",
              info: decode({
                permissions: [{ action: "read", resource: "*", effect: "allow" }],
                agents: {
                  reviewer: { variant: "high", hidden: true },
                  removed: { disabled: true },
                  late: {
                    permissions: [{ action: "edit", resource: "*", effect: "allow" }],
                  },
                },
              }),
            }),
          ]),
      })

      yield* ConfigAgentPlugin.Plugin.effect(host({ agent: agentHost(agents) })).pipe(
        Effect.provideService(Config.Service, config),
      )

      const buildAgent = yield* agents.get(build)
      if (!buildAgent) throw new Error("expected configured build agent")
      expect(buildAgent.permissions).toEqual([
        { action: "bash", resource: "*", effect: "allow" },
        { action: "bash", resource: "*", effect: "ask" },
        { action: "read", resource: "*", effect: "allow" },
        { action: "bash", resource: "git *", effect: "allow" },
      ])
      expect(PermissionV2.evaluate("bash", "git status", buildAgent.permissions).effect).toBe("allow")
      expect(PermissionV2.evaluate("bash", "bun test", buildAgent.permissions).effect).toBe("ask")

      const reviewer = yield* agents.get(AgentV2.ID.make("reviewer"))
      if (!reviewer) throw new Error("expected configured reviewer agent")
      expect(reviewer).toMatchObject({
        description: "Review changes",
        mode: "subagent",
        hidden: true,
        model: { providerID: "openrouter", id: "openai/gpt-5", variant: "high" },
      })
      expect(reviewer.permissions).toEqual([
        { action: "bash", resource: "*", effect: "ask" },
        { action: "read", resource: "*", effect: "allow" },
        { action: "edit", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "deny" },
      ])
      expect(PermissionV2.evaluate("read", "README.md", reviewer.permissions).effect).toBe("deny")
      expect((yield* agents.get(AgentV2.ID.make("late")))?.permissions).toEqual([
        { action: "bash", resource: "*", effect: "ask" },
        { action: "read", resource: "*", effect: "allow" },
        { action: "edit", resource: "*", effect: "allow" },
      ])
      expect(yield* agents.get(AgentV2.ID.make("removed"))).toBeUndefined()
    }),
  )

  it.effect("maps configured agent fields and preserves an unspecified model variant", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const config = Config.Service.of({
        entries: () =>
          Effect.succeed([
            new Config.Document({
              type: "document",
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
                    request: {
                      headers: { first: "one", shared: "first" },
                      body: { enabled: true, profile: "review", effort: "medium" },
                    },
                  },
                },
              }),
            }),
            new Config.Document({
              type: "document",
              info: decode({
                agents: {
                  reviewer: {
                    request: {
                      headers: { shared: "last", second: "two" },
                      body: { retries: 2, effort: "high" },
                    },
                  },
                },
              }),
            }),
          ]),
      })

      yield* ConfigAgentPlugin.Plugin.effect(host({ agent: agentHost(agents) })).pipe(
        Effect.provideService(Config.Service, config),
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
      expect(reviewer.request).toEqual({
        headers: { first: "one", shared: "last", second: "two" },
        body: { enabled: true, profile: "review", retries: 2, effort: "high" },
      })
    }),
  )

  it.effect("removes a built-in agent disabled by configuration", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const build = AgentV2.ID.make("build")
      yield* agents.transform((editor) => editor.update(build, () => {}))

      const config = Config.Service.of({
        entries: () =>
          Effect.succeed([
            new Config.Document({
              type: "document",
              info: decode({ agents: { build: { disabled: true } } }),
            }),
          ]),
      })

      yield* ConfigAgentPlugin.Plugin.effect(host({ agent: agentHost(agents) })).pipe(
        Effect.provideService(Config.Service, config),
      )

      expect(yield* agents.get(build)).toBeUndefined()
    }),
  )

  it.live("loads legacy file-based agents from config directories", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "agents", "team"), { recursive: true })
            await fs.mkdir(path.join(tmp.path, "modes"), { recursive: true })
            await fs.writeFile(
              path.join(tmp.path, "agents", "reviewer.md"),
              `---
model: openrouter/openai/gpt-5
description: Markdown description
temperature: 0.5
tools:
  write: false
---
Review carefully.`,
            )
            await fs.writeFile(path.join(tmp.path, "agents", "team", "helper.md"), "Help the team.")
            await fs.writeFile(
              path.join(tmp.path, "agents", "native.md"),
              `---
request:
  headers:
    x-agent: native
  body:
    effort: high
permissions:
  - action: edit
    resource: "*"
    effect: deny
---
Use native v2 fields.`,
            )
            await fs.writeFile(path.join(tmp.path, "agents", "disabled.md"), "---\ndisabled: true\n---\nDisabled")
            await fs.writeFile(path.join(tmp.path, "modes", "plan.md"), "Make a plan.")
          })
          const agents = yield* AgentV2.Service
          const config = Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  info: decode({ agents: { reviewer: { description: "JSON description" } } }),
                }),
                new Config.Directory({ type: "directory", path: AbsolutePath.make(tmp.path) }),
              ]),
          })

          yield* ConfigAgentPlugin.Plugin.effect(host({ agent: agentHost(agents) })).pipe(
            Effect.provideService(Config.Service, config),
          )

          expect(yield* agents.get(AgentV2.ID.make("reviewer"))).toMatchObject({
            model: { providerID: "openrouter", id: "openai/gpt-5" },
            system: "Review carefully.",
            description: "Markdown description",
            request: { body: { temperature: 0.5 } },
            permissions: [{ action: "edit", resource: "*", effect: "deny" }],
          })
          expect(yield* agents.get(AgentV2.ID.make("team/helper"))).toMatchObject({ system: "Help the team." })
          expect(yield* agents.get(AgentV2.ID.make("native"))).toMatchObject({
            system: "Use native v2 fields.",
            request: { headers: { "x-agent": "native" }, body: { effort: "high" } },
            permissions: [{ action: "edit", resource: "*", effect: "deny" }],
          })
          expect(yield* agents.get(AgentV2.ID.make("disabled"))).toBeUndefined()
          expect(yield* agents.get(AgentV2.ID.make("plan"))).toMatchObject({ system: "Make a plan.", mode: "primary" })
        }),
      ),
    ),
  )
})

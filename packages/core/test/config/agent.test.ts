import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Fiber, Schema, Stream } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { Config } from "@opencode-ai/core/config"
import { ConfigAgentPlugin } from "@opencode-ai/core/config/plugin/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Permission } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { testEffect } from "../lib/effect"
import { tempDirectory } from "../lib/filesystem"
import { agentHost, host } from "../plugin/host"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Agent.node, Bus.node, FSUtil.node, Global.node])))
const decode = Schema.decodeUnknownSync(Config.Info)
const defaultPermissions = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "external_directory", resource: "*", effect: "ask" },
] satisfies Permission.Ruleset

test("rejects named agent color tokens", () => {
  expect(() => decode({ agents: { reviewer: { color: "warning" } } })).toThrow()
})

describe("ConfigAgentPlugin.Plugin", () => {
  it.effect("matches POSIX paths against home-relative permissions", () =>
    Effect.gen(function* () {
      const permissions = yield* loadHomePermissions("/home/test")
      expect(Permission.evaluate("external_directory", "/home/test/p/opencode/src/*", permissions).effect).toBe("allow")
      expect(Permission.evaluate("external_directory", "/home/test/cache/files/*", permissions).effect).toBe("deny")
      expect(Permission.evaluate("external_directory", "/some/~/path", permissions).effect).toBe("deny")
      expect(Permission.evaluate("external_directory", "$HOMELESS/private/*", permissions).effect).toBe("deny")
      expect(permissions).toContainEqual({ action: "shell", resource: "$HOME/private/**", effect: "deny" })
      expect(permissions).not.toContainEqual({ action: "shell", resource: "/home/test/private/**", effect: "deny" })
      expect(Permission.evaluate("shell", "$HOME/private/key", permissions).effect).toBe("deny")
    }),
  )

  it.effect("matches Windows paths against home-relative permissions", () =>
    Effect.gen(function* () {
      const permissions = yield* loadHomePermissions("C:\\Users\\test")
      expect(
        Permission.evaluate("external_directory", "C:\\Users\\test\\p\\opencode\\src\\*", permissions).effect,
      ).toBe("allow")
      expect(Permission.evaluate("external_directory", "C:\\Users\\test\\cache\\files\\*", permissions).effect).toBe(
        "deny",
      )
    }),
  )

  it.effect("applies all global permissions before agent-specific permissions", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const build = Agent.ID.make("build")
      yield* agents.transform((editor) =>
        editor.update(build, (agent) => {
          agent.mode = "primary"
          agent.permissions.push({ action: "bash", resource: "*", effect: "allow" })
        }),
      )

      const entries = [
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
              reviewer: { model: "openrouter/openai/gpt-5#high", hidden: true },
              removed: { disabled: true },
              late: {
                permissions: [{ action: "edit", resource: "*", effect: "allow" }],
              },
            },
          }),
        }),
      ]

      yield* ConfigAgentPlugin.Plugin.effect(host({ agent: agentHost(agents) })).pipe(
        Effect.provide(Config.testLayer(entries)),
      )

      const buildAgent = yield* agents.get(build)
      if (!buildAgent) throw new Error("expected configured build agent")
      expect(buildAgent.permissions).toEqual([
        ...defaultPermissions,
        { action: "bash", resource: "*", effect: "allow" },
        { action: "bash", resource: "*", effect: "ask" },
        { action: "read", resource: "*", effect: "allow" },
        { action: "bash", resource: "git *", effect: "allow" },
      ])
      expect(Permission.evaluate("bash", "git status", buildAgent.permissions).effect).toBe("allow")
      expect(Permission.evaluate("bash", "bun test", buildAgent.permissions).effect).toBe("ask")

      const reviewer = yield* agents.get(Agent.ID.make("reviewer"))
      if (!reviewer) throw new Error("expected configured reviewer agent")
      expect(reviewer).toMatchObject({
        description: "Review changes",
        mode: "subagent",
        hidden: true,
        model: { providerID: "openrouter", id: "openai/gpt-5", variant: "high" },
      })
      expect(reviewer.permissions).toEqual([
        ...defaultPermissions,
        { action: "bash", resource: "*", effect: "ask" },
        { action: "read", resource: "*", effect: "allow" },
        { action: "edit", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "deny" },
      ])
      expect(Permission.evaluate("read", "README.md", reviewer.permissions).effect).toBe("deny")
      expect((yield* agents.get(Agent.ID.make("late")))?.permissions).toEqual([
        ...defaultPermissions,
        { action: "bash", resource: "*", effect: "ask" },
        { action: "read", resource: "*", effect: "allow" },
        { action: "edit", resource: "*", effect: "allow" },
      ])
      expect(yield* agents.get(Agent.ID.make("removed"))).toBeUndefined()
    }),
  )

  it.effect("maps configured agent fields and preserves an unspecified model variant", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const entries = [
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
                color: "#ff6b6b",
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
      ]

      yield* ConfigAgentPlugin.Plugin.effect(host({ agent: agentHost(agents) })).pipe(
        Effect.provide(Config.testLayer(entries)),
      )

      const reviewer = yield* agents.get(Agent.ID.make("reviewer"))
      if (!reviewer) throw new Error("expected configured reviewer agent")
      expect(reviewer).toMatchObject({
        system: "Review carefully.",
        description: "Reviews changes",
        mode: "subagent",
        hidden: true,
        color: "#ff6b6b",
        steps: 12,
        model: { providerID: "anthropic", id: "claude-sonnet" },
      })
      expect(reviewer.request).toEqual({
        settings: {},
        headers: { first: "one", shared: "last", second: "two" },
        body: { enabled: true, profile: "review", retries: 2, effort: "high" },
      })
    }),
  )

  it.effect("removes a built-in agent disabled by configuration", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const build = Agent.ID.make("build")
      yield* agents.transform((editor) => editor.update(build, () => {}))

      const entries = [
        new Config.Document({
          type: "document",
          info: decode({ agents: { build: { disabled: true } } }),
        }),
      ]

      yield* ConfigAgentPlugin.Plugin.effect(host({ agent: agentHost(agents) })).pipe(
        Effect.provide(Config.testLayer(entries)),
      )

      expect(yield* agents.get(build)).toBeUndefined()
    }),
  )

  it.live("loads legacy file-based agents from config directories", () =>
    Effect.gen(function* () {
      const tmp = yield* tempDirectory
      yield* tmp.fs.makeDirectory(path.join(tmp.path, "agents", "team"), { recursive: true })
      yield* tmp.fs.makeDirectory(path.join(tmp.path, "modes"), { recursive: true })
      yield* tmp.fs.writeFileString(
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
      yield* tmp.fs.writeFileString(path.join(tmp.path, "agents", "team", "helper.md"), "Help the team.")
      yield* tmp.fs.writeFileString(
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
      yield* tmp.fs.writeFileString(path.join(tmp.path, "agents", "disabled.md"), "---\ndisabled: true\n---\nDisabled")
      yield* tmp.fs.writeFileString(path.join(tmp.path, "modes", "plan.md"), "Make a plan.")
      const agents = yield* Agent.Service
      const entries = [
        new Config.Document({
          type: "document",
          info: decode({ agents: { reviewer: { description: "JSON description" } } }),
        }),
        directoryEntry(tmp.path),
      ]

      yield* ConfigAgentPlugin.Plugin.effect(host({ agent: agentHost(agents) })).pipe(
        Effect.provide(Config.testLayer(entries)),
      )

      expect(yield* agents.get(Agent.ID.make("reviewer"))).toMatchObject({
        model: { providerID: "openrouter", id: "openai/gpt-5" },
        system: "Review carefully.",
        description: "Markdown description",
        request: { body: { temperature: 0.5 } },
        permissions: [...defaultPermissions, { action: "edit", resource: "*", effect: "deny" }],
      })
      expect(yield* agents.get(Agent.ID.make("team/helper"))).toMatchObject({ system: "Help the team." })
      expect(yield* agents.get(Agent.ID.make("native"))).toMatchObject({
        system: "Use native v2 fields.",
        request: { headers: { "x-agent": "native" }, body: { effort: "high" } },
        permissions: [...defaultPermissions, { action: "edit", resource: "*", effect: "deny" }],
      })
      expect(yield* agents.get(Agent.ID.make("disabled"))).toBeUndefined()
      expect(yield* agents.get(Agent.ID.make("plan"))).toMatchObject({ system: "Make a plan.", mode: "primary" })
    }),
  )

  for (const testCase of sourceCases()) {
    it.live(`rebuilds agents when a source file is ${testCase.name}`, () =>
      Effect.gen(function* () {
        const tmp = yield* tempDirectory
        const directory = path.join(tmp.path, testCase.source)
        yield* tmp.fs.makeDirectory(directory, { recursive: true })
        yield* testCase.prepare(tmp.fs, directory)

        return yield* Effect.gen(function* () {
          const agents = yield* Agent.Service
          const bus = yield* Bus.Service
          const configTest = yield* Config.Test
          yield* ConfigAgentPlugin.Plugin.effect(host({ agent: agentHost(agents) }))

          // Verify inside the subscription so the update event is a read barrier:
          // committed state must be visible at event delivery time.
          const changed = yield* bus.subscribe(Agent.Event.Updated).pipe(
            Stream.take(1),
            Stream.mapEffect(() => testCase.verify(agents)),
            Stream.runDrain,
            Effect.forkScoped({ startImmediately: true }),
          )
          yield* Effect.yieldNow

          const updates = yield* testCase.mutate(tmp.fs, directory)
          yield* Effect.forEach(updates, (update) => configTest.emitChange(update), { discard: true })
          yield* Fiber.join(changed).pipe(Effect.timeout("2 seconds"))
        }).pipe(Effect.provide(Config.testLayer([directoryEntry(tmp.path)])))
      }),
    )
  }

  it.live("coalesces updates inside the debounce window into one rebuild", () =>
    Effect.gen(function* () {
      const tmp = yield* tempDirectory
      const directory = path.join(tmp.path, "agents")
      yield* tmp.fs.makeDirectory(directory, { recursive: true })
      return yield* Effect.gen(function* () {
        const agents = yield* Agent.Service
        const bus = yield* Bus.Service
        const configTest = yield* Config.Test
        let reloads = 0
        yield* ConfigAgentPlugin.Plugin.effect(
          host({
            agent: {
              ...agentHost(agents),
              reload: () => Effect.sync(() => reloads++).pipe(Effect.andThen(agents.reload())),
            },
          }),
        )

        const first = yield* bus
          .subscribe(Agent.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* tmp.fs.writeFileString(path.join(directory, "reviewer.md"), "Review once")
        yield* configTest.emitChange({ type: "create", path: path.join(directory, "reviewer.md") })
        yield* configTest.emitChange({ type: "update", path: path.join(directory, "reviewer.md") })
        yield* configTest.emitChange({ type: "update", path: path.join(directory, "reviewer.md") })
        yield* Fiber.join(first).pipe(Effect.timeout("2 seconds"))
        expect(reloads).toBe(1)

        const second = yield* bus
          .subscribe(Agent.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* tmp.fs.writeFileString(path.join(directory, "reviewer.md"), "Review twice")
        yield* configTest.emitChange({ type: "update", path: path.join(directory, "reviewer.md") })
        yield* Fiber.join(second).pipe(Effect.timeout("2 seconds"))
        expect(reloads).toBe(2)
        expect(yield* agents.get(Agent.ID.make("reviewer"))).toMatchObject({ system: "Review twice" })
      }).pipe(Effect.provide(Config.testLayer([directoryEntry(tmp.path)])))
    }),
  )

  it.live("ignores updates outside agent source directories", () =>
    Effect.gen(function* () {
      const tmp = yield* tempDirectory
      const directory = path.join(tmp.path, "agents")
      yield* tmp.fs.makeDirectory(directory, { recursive: true })
      return yield* Effect.gen(function* () {
        const agents = yield* Agent.Service
        const bus = yield* Bus.Service
        const configTest = yield* Config.Test
        let reloads = 0
        yield* ConfigAgentPlugin.Plugin.effect(
          host({
            agent: {
              ...agentHost(agents),
              reload: () => Effect.sync(() => reloads++).pipe(Effect.andThen(agents.reload())),
            },
          }),
        )

        yield* configTest.emitChange({ type: "create", path: path.join(tmp.path, "commands", "review.md") })
        yield* configTest.emitChange({ type: "update", path: path.join(tmp.path, "opencode.json") })
        yield* Effect.sleep("700 millis")
        expect(reloads).toBe(0)

        const changed = yield* bus
          .subscribe(Agent.Event.Updated)
          .pipe(Stream.take(1), Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* tmp.fs.writeFileString(path.join(directory, "reviewer.md"), "Review related")
        yield* configTest.emitChange({ type: "create", path: path.join(directory, "reviewer.md") })
        yield* Fiber.join(changed).pipe(Effect.timeout("2 seconds"))
        expect(yield* agents.get(Agent.ID.make("reviewer"))).toMatchObject({ system: "Review related" })
      }).pipe(Effect.provide(Config.testLayer([directoryEntry(tmp.path)])))
    }),
  )
})

function directoryEntry(directory: string) {
  return new Config.Directory({ type: "directory", path: AbsolutePath.make(directory) })
}

function sourceCases() {
  return [
    {
      name: "created",
      source: "agents",
      prepare: () => Effect.void,
      mutate: (fs: FSUtil.Interface, directory: string) =>
        Effect.gen(function* () {
          const file = path.join(directory, "reviewer.md")
          yield* fs.writeFileString(file, "Review changes")
          return [{ type: "create" as const, path: file }]
        }),
      verify: (agents: Agent.Interface) =>
        Effect.gen(function* () {
          expect(yield* agents.get(Agent.ID.make("reviewer"))).toMatchObject({ system: "Review changes" })
        }),
    },
    {
      name: "created in a legacy modes directory",
      source: "modes",
      prepare: () => Effect.void,
      mutate: (fs: FSUtil.Interface, directory: string) =>
        Effect.gen(function* () {
          const file = path.join(directory, "plan.md")
          yield* fs.writeFileString(file, "Make a plan")
          return [{ type: "create" as const, path: file }]
        }),
      verify: (agents: Agent.Interface) =>
        Effect.gen(function* () {
          expect(yield* agents.get(Agent.ID.make("plan"))).toMatchObject({ system: "Make a plan", mode: "primary" })
        }),
    },
    {
      name: "updated",
      source: "agents",
      prepare: (fs: FSUtil.Interface, directory: string) =>
        fs.writeFileString(path.join(directory, "reviewer.md"), "Review first"),
      mutate: (fs: FSUtil.Interface, directory: string) =>
        Effect.gen(function* () {
          const file = path.join(directory, "reviewer.md")
          yield* fs.writeFileString(file, "Review updated")
          return [{ type: "update" as const, path: file }]
        }),
      verify: (agents: Agent.Interface) =>
        Effect.gen(function* () {
          expect(yield* agents.get(Agent.ID.make("reviewer"))).toMatchObject({ system: "Review updated" })
        }),
    },
    {
      name: "renamed",
      source: "agents",
      prepare: (fs: FSUtil.Interface, directory: string) =>
        fs.writeFileString(path.join(directory, "reviewer.md"), "Review renamed"),
      mutate: (fs: FSUtil.Interface, directory: string) =>
        Effect.gen(function* () {
          const previous = path.join(directory, "reviewer.md")
          const next = path.join(directory, "release.md")
          yield* fs.rename(previous, next)
          return [
            { type: "delete" as const, path: previous },
            { type: "create" as const, path: next },
          ]
        }),
      verify: (agents: Agent.Interface) =>
        Effect.gen(function* () {
          expect(yield* agents.get(Agent.ID.make("reviewer"))).toBeUndefined()
          expect(yield* agents.get(Agent.ID.make("release"))).toMatchObject({ system: "Review renamed" })
        }),
    },
    {
      name: "deleted",
      source: "agents",
      prepare: (fs: FSUtil.Interface, directory: string) =>
        fs.writeFileString(path.join(directory, "reviewer.md"), "Review deleted"),
      mutate: (fs: FSUtil.Interface, directory: string) =>
        Effect.gen(function* () {
          const file = path.join(directory, "reviewer.md")
          yield* fs.remove(file)
          return [{ type: "delete" as const, path: file }]
        }),
      verify: (agents: Agent.Interface) =>
        Effect.gen(function* () {
          expect(yield* agents.get(Agent.ID.make("reviewer"))).toBeUndefined()
        }),
    },
  ] as const
}

function loadHomePermissions(home: string) {
  return Effect.gen(function* () {
    const agents = yield* Agent.Service
    const build = Agent.ID.make("build")
    yield* agents.transform((editor) => editor.update(build, () => {}))
    const entries = [
      new Config.Document({
        type: "document",
        info: decode(
          ConfigMigrateV1.migrate({
            permission: {
              external_directory: {
                "~/p/**": "allow",
                "/some/~/path": "deny",
                "$HOMELESS/**": "deny",
              },
              bash: {
                "$HOME/private/**": "deny",
              },
            },
            agent: {
              build: {
                permission: {
                  external_directory: {
                    "$HOME/cache/**": "deny",
                  },
                },
              },
            },
          }),
        ),
      }),
    ]

    yield* ConfigAgentPlugin.Plugin.effect(host({ agent: agentHost(agents) })).pipe(
      Effect.provide(Config.testLayer(entries)),
      Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), home })),
    )

    const agent = yield* agents.get(build)
    if (!agent) throw new Error("expected configured build agent")
    return agent.permissions
  })
}

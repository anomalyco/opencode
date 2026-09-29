import { describe, expect } from "bun:test"
import path from "node:path"
import { Cause, Deferred, Effect, Exit, Layer } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { FileSystemWatcher } from "@opencode-ai/schema/filesystem-watcher"
import { ConfigResourceEvent } from "@opencode-ai/schema/config-resource-event"
import { Agent } from "../../src/agent/agent"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Skill } from "../../src/skill"
import { Provider } from "../../src/provider/provider"
import { MCP } from "../../src/mcp"
import { TestInstance, provideInstance, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const nodes = LayerNode.group([
  Agent.node,
  Command.node,
  Config.node,
  Skill.node,
  Provider.node,
  EventV2Bridge.node,
  FSUtil.node,
  CrossSpawnSpawner.node,
])
const it = testEffect(LayerNode.compile(nodes))
const catalogRequests: string[] = []
const catalog = testEffect(
  LayerNode.compile(nodes, [
    [
      MCP.node,
      Layer.mock(MCP.Service, {
        prompts: () =>
          Effect.sync(() => {
            catalogRequests.push("prompts/list")
            return { remote: { name: "remote", client: "server" } }
          }),
      }),
    ],
  ]),
)

const agentFile = ".opencode/agents/designer.md"

const writeAgent = (directory: string, model: string) =>
  Effect.promise(() =>
    Bun.write(path.join(directory, agentFile), `---\nmodel: test/${model}\n---\nDesign the scene.`),
  ).pipe(Effect.asVoid)

describe("workspace configuration reload", () => {
  catalog.instance("local edits do not refetch the external MCP prompt catalog", () =>
    Effect.gen(function* () {
      const workspace = yield* TestInstance
      const commands = yield* Command.Service
      const before = catalogRequests.length
      expect((yield* commands.list()).map((command) => command.name)).toContain("remote")
      expect(catalogRequests.length - before).toBe(1)
      yield* Effect.promise(() =>
        Bun.write(path.join(workspace.directory, ".opencode/commands/draft.md"), "Local draft"),
      )
      expect((yield* commands.get("draft"))?.template).toBe("Local draft")
      expect(catalogRequests.length - before).toBe(1)
    }),
  )

  it.instance(
    "tracks missing and subsequently edited prompt includes without changing the config file",
    () =>
      Effect.gen(function* () {
        const workspace = yield* TestInstance
        const agents = yield* Agent.Service
        expect(Exit.isFailure(yield* agents.get("designer").pipe(Effect.exit))).toBe(true)
        yield* Effect.promise(() => Bun.write(path.join(workspace.directory, "prompt.md"), "Original instructions."))
        expect((yield* agents.get("designer")).prompt).toBe("Original instructions.")
        yield* Effect.promise(() => Bun.write(path.join(workspace.directory, "prompt.md"), "Revised instructions."))
        expect((yield* agents.get("designer")).prompt).toBe("Revised instructions.")
      }),
    { config: { agent: { designer: { prompt: "{file:prompt.md}" } } } },
  )

  it.instance("does not observe file references inside JSONC comments", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const workspace = yield* TestInstance
      const agents = yield* Agent.Service
      const fs = yield* FSUtil.Service
      const file = path.join(workspace.directory, "unreadable.txt")
      yield* fs.writeFileString(file, "This file is not a configuration dependency.")
      yield* fs.chmod(file, 0o000)
      yield* Effect.addFinalizer(() => fs.chmod(file, 0o600).pipe(Effect.ignore))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(workspace.directory, "opencode.jsonc"),
          `{
        // Example only: {file:unreadable.txt}
        "agent": {"designer": {"model": "test/model-a"}}
      }`,
        ),
      )
      expect((yield* agents.get("designer")).model?.modelID).toBe(ModelV2.ID.make("model-a"))
    }),
  )

  it.instance(
    "reports invalid JSON without broadcasting configuration contents",
    () =>
      Effect.gen(function* () {
        const workspace = yield* TestInstance
        const config = yield* Config.Service
        const events = yield* EventV2Bridge.Service
        yield* config.get()
        const changed = yield* Deferred.make<EventV2.Payload>()
        const off = yield* events.listen((event) =>
          event.type === ConfigResourceEvent.Event.Updated.type
            ? Deferred.succeed(changed, event).pipe(Effect.asVoid)
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => off)
        yield* Effect.promise(() =>
          Bun.write(path.join(workspace.directory, "opencode.json"), '{"apiKey":"fake-secret-sentinel",'),
        )
        expect(Exit.isFailure(yield* config.get().pipe(Effect.exit))).toBe(true)
        const event = yield* awaitWithTimeout(Deferred.await(changed), "missing configuration error")
        expect(JSON.stringify(event.data)).toContain("ConfigJsonError")
        expect(JSON.stringify(event.data)).not.toContain("fake-secret-sentinel")
        expect(JSON.stringify(event.data)).not.toContain("apiKey")
      }),
    { config: {} },
  )

  it.instance(
    "reloads configured skill paths and stops observing the removed source",
    () =>
      Effect.gen(function* () {
        const workspace = yield* TestInstance
        const skills = yield* Skill.Service
        expect(yield* skills.get("source-a")).toBeDefined()
        expect(yield* skills.get("source-b")).toBeUndefined()
        yield* Effect.promise(() =>
          Bun.write(
            path.join(workspace.directory, "opencode.json"),
            JSON.stringify({ skills: { paths: ["source-b"] } }),
          ),
        )
        expect(yield* skills.get("source-a")).toBeUndefined()
        const current = yield* skills.require("source-b")
        expect(current.content).toContain("Source B")
        yield* Effect.promise(() =>
          Bun.write(path.join(workspace.directory, "source-a/SKILL.md"), "An unrelated edit in the former source."),
        )
        expect(yield* skills.require("source-b")).toBe(current)
      }),
    {
      config: { skills: { paths: ["source-a"] } },
      init: (directory) =>
        Effect.promise(async () => {
          await Bun.write(path.join(directory, "source-a/SKILL.md"), "---\nname: source-a\n---\nSource A")
          await Bun.write(path.join(directory, "source-b/SKILL.md"), "---\nname: source-b\n---\nSource B")
        }),
    },
  )

  it.instance(
    "recovers when a configuration that was invalid on first load is repaired",
    () =>
      Effect.gen(function* () {
        const workspace = yield* TestInstance
        const config = yield* Config.Service
        expect(Exit.isFailure(yield* config.get().pipe(Effect.exit))).toBe(true)
        yield* Effect.promise(() =>
          Bun.write(
            path.join(workspace.directory, "opencode.json"),
            JSON.stringify({
              agent: { repaired: { model: "test/model-b" } },
            }),
          ),
        )
        expect((yield* config.get()).agent?.repaired.model).toBe("test/model-b")
      }),
    {
      init: (directory) =>
        Effect.promise(() => Bun.write(path.join(directory, "opencode.json"), "{ invalid")).pipe(Effect.asVoid),
    },
  )

  it.instance(
    "reloads model defaults and the default agent without rebuilding provider clients",
    () =>
      Effect.gen(function* () {
        const workspace = yield* TestInstance
        const agents = yield* Agent.Service
        const config = yield* Config.Service
        const provider = yield* Provider.Service
        expect((yield* provider.defaultModel()).modelID).toBe(ModelV2.ID.make("model-a"))
        expect(yield* agents.defaultAgent()).toBe("build")
        yield* Effect.promise(() =>
          Bun.write(
            path.join(workspace.directory, "opencode.json"),
            JSON.stringify({
              model: "test/vendor/model-b",
              small_model: "test/small-b",
              default_agent: "plan",
            }),
          ),
        )
        expect((yield* provider.defaultModel()).modelID).toBe(ModelV2.ID.make("vendor/model-b"))
        expect((yield* config.get()).small_model).toBe("test/small-b")
        expect(yield* agents.defaultAgent()).toBe("plan")
      }),
    { config: { model: "test/model-a", small_model: "test/small-a", default_agent: "build" } },
  )

  it.instance("discovers additions and applies renames and removals to all catalogs", () =>
    Effect.gen(function* () {
      const workspace = yield* TestInstance
      const agents = yield* Agent.Service
      const skills = yield* Skill.Service
      const commands = yield* Command.Service
      const fs = yield* FSUtil.Service
      expect(yield* agents.get("designer")).toBeUndefined()
      expect(yield* skills.get("story")).toBeUndefined()
      expect(yield* commands.get("draft")).toBeUndefined()
      yield* writeAgent(workspace.directory, "model-a")
      yield* Effect.promise(() =>
        Bun.write(
          path.join(workspace.directory, ".opencode/skills/story/SKILL.md"),
          "---\nname: story\n---\nStory body.",
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(workspace.directory, ".opencode/commands/draft.md"),
          "---\ndescription: Draft a scene\n---\nFirst draft $ARGUMENTS",
        ),
      )
      expect((yield* agents.list()).map((agent) => agent.name)).toContain("designer")
      expect((yield* skills.all()).map((skill) => skill.name)).toContain("story")
      expect((yield* commands.list()).map((command) => command.name)).toEqual(
        expect.arrayContaining(["story", "draft"]),
      )
      expect((yield* commands.get("draft"))?.template).toBe("First draft $ARGUMENTS")

      yield* fs.rename(
        path.join(workspace.directory, agentFile),
        path.join(workspace.directory, ".opencode/agents/artist.md"),
      )
      yield* fs.rename(
        path.join(workspace.directory, ".opencode/commands/draft.md"),
        path.join(workspace.directory, ".opencode/commands/revise.md"),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(workspace.directory, ".opencode/skills/story/SKILL.md"),
          "---\nname: narrative\n---\nRevised story.",
        ),
      )
      expect(yield* agents.get("designer")).toBeUndefined()
      expect((yield* agents.get("artist")).model?.modelID).toBe(ModelV2.ID.make("model-a"))
      expect(yield* commands.get("draft")).toBeUndefined()
      expect((yield* commands.get("revise"))?.template).toBe("First draft $ARGUMENTS")
      expect(yield* skills.get("story")).toBeUndefined()
      expect(yield* commands.get("story")).toBeUndefined()
      expect((yield* skills.require("narrative")).content).toContain("Revised story.")
      expect(yield* commands.get("narrative")).toBeDefined()

      yield* fs.remove(path.join(workspace.directory, ".opencode"), { recursive: true })
      expect((yield* agents.list()).map((agent) => agent.name)).not.toContain("artist")
      expect((yield* commands.list()).map((command) => command.name)).not.toContain("revise")
      expect(yield* skills.get("narrative")).toBeUndefined()
      expect(yield* commands.get("narrative")).toBeUndefined()
    }),
  )

  it.instance(
    "deleting a higher-priority definition reveals the lower-priority configuration",
    () =>
      Effect.gen(function* () {
        const workspace = yield* TestInstance
        const agents = yield* Agent.Service
        const commands = yield* Command.Service
        const fs = yield* FSUtil.Service
        expect((yield* agents.get("designer")).model?.modelID).toBe(ModelV2.ID.make("model-a"))
        expect((yield* commands.get("draft"))?.template).toBe("Workspace draft")
        yield* fs.remove(path.join(workspace.directory, agentFile))
        yield* fs.remove(path.join(workspace.directory, ".opencode/commands/draft.md"))
        expect((yield* agents.get("designer")).model?.modelID).toBe(ModelV2.ID.make("fallback"))
        expect((yield* commands.get("draft"))?.template).toBe("Fallback draft")
      }),
    {
      config: { agent: { designer: { model: "test/fallback" } }, command: { draft: { template: "Fallback draft" } } },
      init: (directory) =>
        writeAgent(directory, "model-a").pipe(
          Effect.andThen(
            Effect.promise(() =>
              Bun.write(path.join(directory, ".opencode/commands/draft.md"), "Workspace draft"),
            ).pipe(Effect.asVoid),
          ),
        ),
    },
  )

  it.instance(
    "ordinary code edits do not rebuild configuration resources",
    () =>
      Effect.gen(function* () {
        const workspace = yield* TestInstance
        const agents = yield* Agent.Service
        const events = yield* EventV2Bridge.Service
        const original = yield* agents.get("designer")
        const file = path.join(workspace.directory, "src/index.ts")
        yield* Effect.promise(() => Bun.write(file, "export const changed = true"))
        yield* events.publish(FileSystemWatcher.Event.Updated, { file, event: "change" })
        expect(yield* agents.get("designer")).toBe(original)
      }),
    { init: (directory) => writeAgent(directory, "model-a") },
  )

  it.instance(
    "concurrent callers share each new revision across repeated saves",
    () =>
      Effect.gen(function* () {
        const workspace = yield* TestInstance
        const agents = yield* Agent.Service
        const original = yield* agents.get("designer")
        yield* Effect.forEach(["alpha", "beta", "gamma"], (model) =>
          Effect.gen(function* () {
            yield* writeAgent(workspace.directory, model)
            const results = yield* Effect.all(
              Array.from({ length: 8 }, () => agents.get("designer")),
              { concurrency: "unbounded" },
            )
            results.forEach((agent) => {
              expect(agent.model?.modelID).toBe(ModelV2.ID.make(model))
              expect(agent).toBe(results[0])
            })
          }),
        )
        expect(original.model?.modelID).toBe(ModelV2.ID.make("model-a"))
      }),
    { init: (directory) => writeAgent(directory, "model-a") },
  )

  it.instance(
    "reloads only the workspace whose sources changed",
    () =>
      Effect.gen(function* () {
        const workspace = yield* TestInstance
        const agents = yield* Agent.Service
        const other = yield* tmpdirScoped({ init: (directory) => writeAgent(directory, "other-model") })
        const original = yield* agents.get("designer").pipe(provideInstance(other))
        expect((yield* agents.get("designer")).model?.modelID).toBe(ModelV2.ID.make("model-a"))
        yield* writeAgent(workspace.directory, "model-b")
        const results = yield* Effect.all(
          [agents.get("designer"), agents.get("designer").pipe(provideInstance(other))],
          { concurrency: 2 },
        )
        expect(results[0].model?.modelID).toBe(ModelV2.ID.make("model-b"))
        expect(results[1]).toBe(original)
        expect(results[1].model?.modelID).toBe(ModelV2.ID.make("other-model"))
      }),
    { init: (directory) => writeAgent(directory, "model-a") },
  )

  it.instance(
    "applies agent settings but reports provider changes as requiring a restart",
    () =>
      Effect.gen(function* () {
        const workspace = yield* TestInstance
        const config = yield* Config.Service
        const events = yield* EventV2Bridge.Service
        const before = yield* config.get()
        const changed = yield* Deferred.make<EventV2.Payload>()
        const off = yield* events.listen((event) =>
          event.type === ConfigResourceEvent.Event.Updated.type
            ? Deferred.succeed(changed, event).pipe(Effect.asVoid)
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => off)
        yield* Effect.promise(() =>
          Bun.write(
            path.join(workspace.directory, "opencode.json"),
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              agent: { designer: { model: "test/model-b" } },
              provider: { test: { options: { baseURL: "http://changed.invalid" } } },
            }),
          ),
        )
        const after = yield* config.get()
        expect(after.agent?.designer.model).toBe("test/model-b")
        expect(after.provider?.test.options?.baseURL).toBe("http://original.invalid")
        expect(before.agent?.designer.model).toBe("test/model-a")
        const event = yield* awaitWithTimeout(Deferred.await(changed), "missing restart requirement")
        expect(event.data).toEqual({ revision: 1, status: "ready", restartRequired: ["provider"] })
      }),
    {
      config: {
        agent: { designer: { model: "test/model-a" } },
        provider: { test: { options: { baseURL: "http://original.invalid" } } },
      },
    },
  )

  it.instance(
    "rejects an invalid skill edit instead of silently removing it or running its previous content",
    () =>
      Effect.gen(function* () {
        const workspace = yield* TestInstance
        const skills = yield* Skill.Service
        const commands = yield* Command.Service
        expect((yield* skills.require("story")).content).toContain("Original story.")
        expect(yield* commands.get("story")).toBeDefined()
        const file = path.join(workspace.directory, ".opencode/skills/story/SKILL.md")
        yield* Effect.promise(() => Bun.write(file, "---\nname: [unfinished\n---\nInvalid story."))
        const rejected = yield* skills.require("story").pipe(Effect.exit)
        expect(Exit.isFailure(rejected)).toBe(true)
        if (Exit.isFailure(rejected)) expect(Cause.pretty(rejected.cause)).toContain(file)
        expect(Exit.isFailure(yield* commands.get("story").pipe(Effect.exit))).toBe(true)

        yield* Effect.promise(() => Bun.write(file, "---\nname: story\n---\nRepaired story."))
        expect((yield* skills.require("story")).content).toContain("Repaired story.")
      }),
    {
      init: (directory) =>
        Effect.promise(() =>
          Bun.write(path.join(directory, ".opencode/skills/story/SKILL.md"), "---\nname: story\n---\nOriginal story."),
        ).pipe(Effect.asVoid),
    },
  )

  it.instance(
    "publishes a catalog revision after a watcher update without an intervening lookup",
    () =>
      Effect.gen(function* () {
        const workspace = yield* TestInstance
        const agents = yield* Agent.Service
        const events = yield* EventV2Bridge.Service
        expect((yield* agents.get("designer")).model?.modelID).toBe(ModelV2.ID.make("model-a"))
        const changed = yield* Deferred.make<EventV2.Payload>()
        const off = yield* events.listen((event) =>
          event.type === ConfigResourceEvent.Event.Updated.type && event.location?.directory === workspace.directory
            ? agents.get("designer").pipe(Effect.andThen(Deferred.succeed(changed, event)), Effect.asVoid)
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => off)
        yield* writeAgent(workspace.directory, "model-b")
        yield* events.publish(FileSystemWatcher.Event.Updated, {
          file: path.join(workspace.directory, agentFile),
          event: "change",
        })

        const event = yield* awaitWithTimeout(
          Deferred.await(changed),
          "watcher did not publish a configuration revision",
          "10 seconds",
        )
        expect(event.data).toEqual({ revision: 1, status: "ready", restartRequired: [] })
        expect((yield* agents.get("designer")).model?.modelID).toBe(ModelV2.ID.make("model-b"))
      }),
    { init: (directory) => writeAgent(directory, "model-a") },
  )
})

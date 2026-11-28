import { afterAll, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Duration, Effect, Layer, Schedule, Stream } from "effect"
import { Agent } from "@opencode/core/agent"
import { App } from "@opencode/core/app"
import { Config } from "@opencode/core/config"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Instance } from "@opencode/core/instance"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import { Bus } from "../../src/bus"
import { Database } from "../../src/database/database"
import { offlineModels } from "../fixture/models"
import { tmpdir, tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const temp = await tmpdir()
afterAll(() => temp[Symbol.asyncDispose]())
// A release channel keeps project_overlay off by default, so global config turns it on for every test here.
await fs.mkdir(path.join(temp.path, "config"), { recursive: true })
await fs.writeFile(
  path.join(temp.path, "config", "opencode.json"),
  JSON.stringify({ experimental: { project_overlay: true } }),
)
// One Global for the app and every instance, so the test writes where the instances read.
const globalLayer = Global.layerWith({
  config: path.join(temp.path, "config"),
  data: path.join(temp.path, "data"),
  cache: path.join(temp.path, "cache"),
  state: path.join(temp.path, "state"),
  tmp: path.join(temp.path, "tmp"),
  bin: path.join(temp.path, "cache", "bin"),
  log: path.join(temp.path, "data", "log"),
  repos: path.join(temp.path, "data", "repos"),
})

const unexpected = (pkg: string) =>
  Effect.fail(new Npm.InstallFailedError({ add: [pkg], dir: "", cause: new Error(`Unexpected Npm call: ${pkg}`) }))

const instances = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const map = yield* LocationServiceMap.make((ref: Location.Ref) => Instance.layer(ref, { replacements: bindings }), {
      idleTimeToLive: Duration.infinity,
    })
    const bindings: LayerNode.Replacements = [
      App.node.replace(App.configured({ channel: "latest" })),
      Global.node.replace(globalLayer),
      offlineModels,
      Config.node.replace(Config.configured({ system: false })),
      ConfigPluginSource.node.replace(
        Layer.succeed(
          ConfigPluginSource.Service,
          ConfigPluginSource.Service.of({ operations: () => Effect.succeed([]), changes: () => Stream.never }),
        ),
      ),
      Npm.node.replace(
        Layer.succeed(
          Npm.Service,
          Npm.Service.of({
            add: unexpected,
            resolve: (name) => Effect.succeed({ directory: "", name }),
            check: () => Effect.succeed(false),
            update: unexpected,
            reject: () => Effect.succeed(false),
            which: () => Effect.undefined,
            follows: () => Effect.succeed(false),
          }),
        ),
      ),
      LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
      Instance.node.replace(
        Layer.succeed(Instance.Service, { provide: (session) => Effect.provide(map.get(session.location)) }),
      ),
    ]
    return map
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, Global.node, SdkPlugins.node, Project.node, LocationServiceMap.node]),
    [Global.node.replace(globalLayer), offlineModels, LocationServiceMap.node.replace(instances)],
  ),
)

const write = (file: string, content: string) =>
  Effect.promise(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content)
  })

const skill = (name: string, description: string) =>
  ["---", `name: ${name}`, `description: ${description}`, "---", `# ${name}`, ""].join("\n")

const overlay = (directory: string) =>
  Effect.gen(function* () {
    const project = yield* Project.Service
    const global = yield* Global.Service
    const resolved = yield* project.resolve(AbsolutePath.make(directory))
    return path.join(global.config, "project", resolved.id)
  })

const load = (directory: string) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return yield* Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      yield* plugins.awaitActivation
      const skills = yield* Skill.Service
      const agents = yield* Agent.Service
      return { skills: yield* skills.list(), agents: yield* agents.list() }
    }).pipe(
      Effect.scoped,
      Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
    )
  })

describe("project overlay config directory", () => {
  it.live("loads skills, agents and config for its project only and wins over the repo", () =>
    Effect.gen(function* () {
      const repo = yield* tmpdirScoped()
      const other = yield* tmpdirScoped()
      const root = yield* overlay(repo.path)
      yield* write(path.join(repo.path, ".opencode", "skills", "shared", "SKILL.md"), skill("shared", "from repo"))
      yield* write(path.join(repo.path, ".opencode", "agents", "reviewer.md"), "---\ndescription: from repo\n---\nrepo")
      yield* write(
        path.join(repo.path, ".opencode", "opencode.json"),
        JSON.stringify({ agents: { helper: { description: "from repo" } } }),
      )
      yield* write(path.join(root, "skills", "shared", "SKILL.md"), skill("shared", "from overlay"))
      yield* write(path.join(root, "skills", "personal", "SKILL.md"), skill("personal", "from overlay"))
      yield* write(path.join(root, "agents", "reviewer.md"), "---\ndescription: from overlay\n---\noverlay")
      yield* write(
        path.join(root, "opencode.json"),
        JSON.stringify({ agents: { helper: { description: "from overlay" }, mine: { description: "mine" } } }),
      )

      const result = yield* load(repo.path)
      const skills = new Map(result.skills.map((item) => [item.id, item.description]))
      const agents = new Map(result.agents.map((item) => [item.id, item.description]))
      expect(skills.get(Skill.ID.make("personal"))).toBe("from overlay")
      expect(skills.get(Skill.ID.make("shared"))).toBe("from overlay")
      expect(agents.get(Agent.ID.make("reviewer"))).toBe("from overlay")
      expect(agents.get(Agent.ID.make("helper"))).toBe("from overlay")
      expect(agents.get(Agent.ID.make("mine"))).toBe("mine")

      const elsewhere = yield* load(other.path)
      expect(elsewhere.skills.map((item) => item.id)).not.toContain(Skill.ID.make("personal"))
      expect(elsewhere.agents.map((item) => item.id)).not.toContain(Agent.ID.make("mine"))
    }),
  )

  it.live("leaves the overlay alone when project_overlay is off", () =>
    Effect.gen(function* () {
      const repo = yield* tmpdirScoped()
      const root = yield* overlay(repo.path)
      yield* write(
        path.join(repo.path, ".opencode", "opencode.json"),
        JSON.stringify({ experimental: { project_overlay: false } }),
      )
      yield* write(path.join(root, "skills", "personal", "SKILL.md"), skill("personal", "from overlay"))
      yield* write(path.join(root, "opencode.json"), JSON.stringify({ agents: { mine: { description: "mine" } } }))

      const result = yield* load(repo.path)
      expect(result.skills.map((item) => item.id)).not.toContain(Skill.ID.make("personal"))
      expect(result.agents.map((item) => item.id)).not.toContain(Agent.ID.make("mine"))
    }),
  )

  it.live("picks up an overlay created after the location started", () =>
    Effect.gen(function* () {
      const repo = yield* tmpdirScoped()
      const root = yield* overlay(repo.path)
      expect((yield* load(repo.path)).skills.map((item) => item.id)).not.toContain(Skill.ID.make("later"))
      yield* write(path.join(root, "skills", "later", "SKILL.md"), skill("later", "added later"))
      yield* load(repo.path).pipe(
        Effect.flatMap((result) =>
          result.skills.some((item) => item.id === Skill.ID.make("later")) ? Effect.void : Effect.fail("missing"),
        ),
        Effect.retry(Schedule.spaced("100 millis")),
        Effect.timeout("10 seconds"),
      )
    }),
  )

  it.live("applies to the home folder", () =>
    Effect.gen(function* () {
      const root = yield* overlay(AbsolutePath.make(Global.Path.home))
      yield* write(path.join(root, "skills", "chores", "SKILL.md"), skill("chores", "home chores"))
      const result = yield* load(Global.Path.home)
      expect(result.skills.find((item) => item.id === Skill.ID.make("chores"))?.description).toBe("home chores")
    }),
  )
})

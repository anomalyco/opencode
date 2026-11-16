import { expect } from "bun:test"
import path from "path"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { ProjectTable } from "@opencode/core/project/sql"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { OpenCodeTools } from "@opencode/core/tool/plugin/opencode"
import { Worktree } from "@opencode/core/worktree"
import { WorktreeTable } from "@opencode/core/worktree/sql"
import { WorktreeStrategies } from "@opencode/core/worktree/strategies"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { Effect } from "effect"
import { initRepo } from "./fixture/git"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, toolIdentity } from "./lib/tool"
import { makePluginTestLayer, PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

const alpha = { id: "test/alpha", name: "Alpha", released: 300, variants: ["fast"], cost: [], status: "beta" }
const beta = { id: "other/beta", name: "Beta", released: 200, variants: [], cost: [], status: "active" }
const gamma = { id: "other/gamma", name: "Gamma Flash", released: 100, variants: [], cost: [], status: "active" }
const gammaOld = {
  id: "other/gamma-old",
  name: "Gamma Flash Old",
  released: 50,
  variants: [],
  cost: [],
  status: "active",
}

it.effect("groups available models by provider with paging", () =>
  Effect.gen(function* () {
    const catalog = yield* Provider.Service
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const location = yield* Location.Service
    const pluginHost = yield* PluginHost.make(plugins, "test")
    yield* catalog.transform((editor) => {
      editor.update(Provider.ID.make("other"), (provider) => {
        provider.name = "Other Provider"
      })
      editor.models.update(Provider.ID.make("test"), Model.ID.make("alpha"), (model) => {
        model.name = "Alpha"
        model.time.released = 300
        model.variants = [{ id: Model.VariantID.make("fast") }]
        model.status = "beta"
      })
      editor.models.update(Provider.ID.make("other"), Model.ID.make("beta"), (model) => {
        model.name = "Beta"
        model.time.released = 200
      })
      editor.models.update(Provider.ID.make("other"), Model.ID.make("gamma"), (model) => {
        model.name = "Gamma Flash"
        model.time.released = 100
        model.family = Model.Family.make("gamma")
      })
      editor.models.update(Provider.ID.make("other"), Model.ID.make("gamma-old"), (model) => {
        model.name = "Gamma Flash Old"
        model.time.released = 50
        model.family = Model.Family.make("gamma")
      })
      editor.models.update(Provider.ID.make("other"), Model.ID.make("disabled"), (model) => {
        model.time.released = 400
        model.enabled = false
      })
    })
    yield* OpenCodeTools.Plugin.effect(pluginHost)
    // The caller runs on `test`, which sorts first despite `other` coming earlier alphabetically.
    const session = yield* sessions.create({
      location: Location.Ref.make({ directory: location.directory }),
      model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("alpha") }),
    })
    const registry = yield* Tool.Service
    const run = (input: Record<string, unknown>) =>
      executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: `call-${JSON.stringify(input)}`,
          name: "execute",
          input: { code: `return await tools.opencode.models(${JSON.stringify(input)})` },
        },
      }).pipe(Effect.map((result) => JSON.parse(result.content?.[0]?.type === "text" ? result.content[0].text : "")))

    // Grouped by provider, newest first within each, disabled models excluded.
    expect(yield* run({})).toEqual({
      providers: [
        { id: "test", name: "test", models: [alpha] },
        { id: "other", name: "Other Provider", models: [beta, gamma] },
      ],
      total: 3,
      next: null,
    })

    // Paging slices the ordered list, so a page can end inside a provider group.
    expect(yield* run({ limit: 2 })).toEqual({
      providers: [
        { id: "test", name: "test", models: [alpha] },
        { id: "other", name: "Other Provider", models: [beta] },
      ],
      total: 3,
      next: 2,
    })
    expect(yield* run({ limit: 2, offset: 2 })).toEqual({
      providers: [{ id: "other", name: "Other Provider", models: [gamma] }],
      total: 3,
      next: null,
    })

    expect(yield* run({ provider: "other provider" })).toMatchObject({ total: 2, providers: [{ id: "other" }] })
    expect(yield* run({ provider: "test" })).toEqual({
      providers: [{ id: "test", name: "test", models: [alpha] }],
      total: 1,
      next: null,
    })

    // Every word of the query must appear somewhere in the reference or display name, ignoring case.
    expect(yield* run({ query: "GAMMA" })).toEqual({
      providers: [{ id: "other", name: "Other Provider", models: [gamma] }],
      total: 1,
      next: null,
    })
    expect(yield* run({ query: "test/" })).toMatchObject({ total: 1, providers: [{ id: "test" }] })
    expect(yield* run({ query: "other flash" })).toMatchObject({ total: 1, providers: [{ models: [gamma] }] })
    expect(yield* run({ query: "gamma beta" })).toEqual({ providers: [], total: 0, next: null })

    // Only the newest model of each family is listed unless `all` is set; the query is applied first.
    expect(yield* run({ all: true })).toMatchObject({
      total: 4,
      providers: [{ id: "test" }, { id: "other", models: [beta, gamma, gammaOld] }],
    })
    expect(yield* run({ query: "old" })).toMatchObject({ total: 1, providers: [{ models: [gammaOld] }] })
    expect(yield* run({ provider: "other", query: "alpha" })).toEqual({ providers: [], total: 0, next: null })
  }),
)

const worktreeContext = (): SessionHooks["context"] => ({
  sessionID: Session.ID.make("ses_worktree_guidance"),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("test") }),
  system: [],
  messages: [],
  tools: {},
  options: {},
})

it.effect("tells the model where to create worktrees only for a configured directory and the git strategy", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const hooks = yield* PluginHooks.Service
    const strategies = yield* WorktreeStrategies.Service
    yield* OpenCodeTools.Plugin.effect(yield* PluginHost.make(plugins, "test"))
    const system = () =>
      Effect.gen(function* () {
        const event = worktreeContext()
        yield* hooks.trigger("session", "context", event)
        return event.system.map((part) => part.text).filter((text) => text.includes("worktree"))
      })
    const moveHint =
      "When you create a worktree outside the current working directory and intend to use it as your primary working directory, consider using `execute` to call `tools.opencode.session_move` and make the worktree the session's working directory."

    // Without configuration, models aren't steered to the data-directory default.
    expect(yield* system()).toEqual([moveHint])

    const directory = AbsolutePath.make(path.join(path.sep, "work", "trees"))
    yield* strategies.transform((editor) => editor.configure({ directory }))
    expect(yield* system()).toEqual([
      `Unless the user asks otherwise, create worktrees in \`${directory}\` with \`git worktree add ${path.join(directory, "<name>")}\` (add \`-b <branch>\` for a new branch). List them with \`git worktree list\` and remove one with \`git worktree remove <path>\`.`,
      moveHint,
    ])

    // A strategy plugin replaces git, so its own instructions apply instead.
    yield* strategies.transform((editor) =>
      editor.add({
        id: Worktree.StrategyID.make("rift"),
        create: () => Effect.die("unused"),
        remove: () => Effect.die("unused"),
        list: () => Effect.succeed([]),
      }),
    )
    expect(yield* system()).toEqual([moveHint])
  }),
)

const assertions: Permission.AssertInput[] = []
const recordingIt = testEffect(
  makePluginTestLayer(permissionLayer({ assert: (input) => Effect.sync(() => void assertions.push(input)) })),
)

recordingIt.live("moves a session into a worktree made with git without asking to leave the project", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const location = yield* Location.Service
    const database = yield* Database.Service
    const parent = yield* tmpdirScoped()
    yield* Effect.promise(() => initRepo(location.directory))
    yield* database.db
      .insert(ProjectTable)
      .values({ id: location.project.id, worktree: location.directory, sandboxes: [], time_created: 1, time_updated: 1 })
      .onConflictDoUpdate({ target: ProjectTable.id, set: { worktree: location.directory } })
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .insert(WorktreeTable)
      .values({ project_id: location.project.id, directory: location.directory })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const directory = path.join(parent.path, "task")
    yield* Effect.promise(() => Bun.$`git worktree add -q ${directory}`.cwd(location.directory).quiet())
    yield* OpenCodeTools.Plugin.effect(yield* PluginHost.make(plugins, "test"))
    const session = yield* sessions.create({ location: Location.Ref.make({ directory: location.directory }) })
    const registry = yield* Tool.Service
    assertions.length = 0

    const result = yield* executeTool(registry, {
      sessionID: session.id,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "call-move",
        name: "execute",
        input: { code: `return await tools.opencode.session_move(${JSON.stringify({ directory })})` },
      },
    })
    expect(result.metadata?.error).toBeUndefined()
    expect(assertions.filter((input) => input.action === "external_directory")).toEqual([])
  }),
)

// Counts the work a cold Location boot and one session turn do, so a speedup can't silently regress:
// catalog lookups per step (#58601), Azure model edits per model rebuild (#58600) and git spawns (#58602).
// These are exact counts, not timings. Changing one is fine when the change is intended; update the expected
// number here and say why in the PR.
import { describe, expect } from "bun:test"
import path from "path"
import whichPkg from "which"
import { Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { gitExecutable } from "@opencode/core/util/git-executable"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { initRepo } from "./fixture/git"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const counters = { catalogLookups: 0, azureModelEdits: 0, gitSpawns: [] as string[], gitLookups: 0 }

const isGit = (command: string) => path.basename(command).replace(/\.exe$/i, "") === "git"

const countingSpawner = CrossSpawnSpawner.node.replace(
  CrossSpawnSpawner.node.mapLayer((base) =>
    Layer.effect(
      ChildProcessSpawner.ChildProcessSpawner,
      Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
        ChildProcessSpawner.make((command) => {
          if (command._tag === "StandardCommand" && isGit(command.command))
            counters.gitSpawns.push([command.command, ...command.args].join(" "))
          return spawner.spawn(command)
        }),
      ),
    ).pipe(Layer.provide(base)),
  ),
)

const isAzure = (provider: Provider.Info) =>
  provider.id === Provider.ID.azure || provider.package.startsWith("@opencode/ai/providers/azure/")

// `ctx.model.list()` reads `Model.available()`. Every editor list/get/update clones the models it touches.
const countingModels = Model.node.replace(
  Model.node.mapLayer((base) =>
    Layer.effect(
      Model.Service,
      Effect.map(Model.Service, (models) =>
        Model.Service.of({
          ...models,
          available: () =>
            Effect.suspend(() => {
              counters.catalogLookups++
              return models.available()
            }),
          transform: (update) =>
            models.transform((editor) => {
              const azure = new Set(
                editor.provider
                  .list()
                  .filter((item) => isAzure(item.provider))
                  .map((item) => item.provider.id),
              )
              update({
                ...editor,
                list: (providerID) => {
                  const result = editor.list(providerID)
                  counters.azureModelEdits += result.filter((model) => azure.has(model.providerID)).length
                  return result
                },
                get: (providerID, modelID) => {
                  if (azure.has(providerID)) counters.azureModelEdits++
                  return editor.get(providerID, modelID)
                },
                update: (providerID, modelID, edit) => {
                  if (azure.has(providerID)) counters.azureModelEdits++
                  editor.update(providerID, modelID, edit)
                },
              })
            }),
        }),
      ),
    ).pipe(Layer.provide(base)),
  ),
)

// Counts PATH lookups of git: resolving the git executable (macOS and Windows) and finding Git Bash (Windows).
const countingGitLookups = Effect.acquireRelease(
  Effect.sync(() => {
    const sync = whichPkg.sync
    whichPkg.sync = Object.assign((cmd: string, options?: Parameters<typeof sync>[1]) => {
      if (cmd === "git") counters.gitLookups++
      return sync(cmd, options as never)
    }, sync) as typeof sync
    return sync
  }),
  (sync) => Effect.sync(() => void (whichPkg.sync = sync)),
)

const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text("Done", "done") })
const it = testEffect(
  Layer.merge(
    llmLayer,
    AppNodeBuilder.build(LayerNode.group([Session.node, LocationServiceMap.node]), [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      LayerNodePlatform.llmClient.replace(llmLayer),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: () =>
            Effect.succeed(
              SessionRunnerModel.resolved(
                LanguageModel.make({ id: "boot", provider: "test", route: OpenAIChat.route }),
                {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  cost: [],
                  limit: { context: 200_000, output: 32_000 },
                },
              ),
            ),
        }),
      ),
      countingSpawner,
      countingModels,
    ]),
  ),
)

const expected = {
  // Folder startup: project identity, VCS branch/remote reads and the Location's repository probe.
  "boot: git spawns": 8,
  // The step's snapshot: repository probe, snapshot init, diff, untracked files, ignore check, index and tree.
  "turn: git spawns": 9,
  // Git is resolved once per process, before this test, and every spawn uses that resolution. On Windows the shell
  // tool's ShellSelect.gitbash() looks up git once to find Git Bash (cached per process), so one lookup is allowed.
  "boot + turn: git lookups beyond one": 0,
  "boot + turn: git spawns not using the resolved executable": 0,
  // One step resolves the prompt hook model once, shared by the context, compaction and generate hooks.
  "turn: catalog lookups per step": 1,
  // Azure is enabled without a resource name, so its model transform has nothing to rewrite.
  "model rebuild: Azure model edits": 0,
}

describe("boot work", () => {
  it.live("counts catalog lookups, Azure model edits and git spawns over a cold boot and one turn", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* Effect.promise(() => initRepo(tmp.path))
      yield* Effect.promise(() =>
        Bun.write(path.join(tmp.path, "opencode.json"), JSON.stringify({ providers: { azure: {} } })),
      )
      const executable = gitExecutable()
      counters.gitSpawns = []
      counters.gitLookups = 0
      yield* countingGitLookups

      const sessions = yield* Session.Service
      const locations = yield* LocationServiceMap.Service
      const session = yield* sessions.create({
        location: { directory: AbsolutePath.make(tmp.path) },
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ id: Model.ID.make("boot"), providerID: Provider.ID.make("test") }),
      })
      const location = locations.get(session.location)
      yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(location))
      const boot = counters.gitSpawns.length

      counters.catalogLookups = 0
      yield* sessions.prompt({ sessionID: session.id, text: "hello" })
      yield* sessions.wait(session.id)
      const steps = (yield* sessions.context(session.id)).filter((message) => message.type === "assistant").length
      const lookups = counters.catalogLookups
      const spawns = [...counters.gitSpawns]

      counters.azureModelEdits = 0
      yield* Model.Service.use((models) => models.reload().pipe(Effect.andThen(models.available()))).pipe(
        Effect.provide(location),
      )

      const measured: Record<keyof typeof expected, number> = {
        "boot: git spawns": boot,
        "turn: git spawns": spawns.length - boot,
        "boot + turn: git lookups beyond one": Math.max(0, counters.gitLookups - 1),
        "boot + turn: git spawns not using the resolved executable": spawns.filter(
          (spawn) => !spawn.startsWith(`${executable} `),
        ).length,
        "turn: catalog lookups per step": steps === 0 ? lookups : lookups / steps,
        "model rebuild: Azure model edits": counters.azureModelEdits,
      }
      const drift = Object.entries(expected).flatMap(([name, want]) => {
        const got = measured[name as keyof typeof expected]
        if (got === want) return []
        return [`${name}: expected ${want}, got ${got} (${got > want ? "+" : ""}${got - want})`]
      })
      const report = drift.length === 0 ? "" : [...drift, "", "git spawns, boot then turn:", ...spawns].join("\n")
      expect(steps).toBe(1)
      expect(report).toBe("")
    }),
  )
})

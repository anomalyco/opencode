import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { ConfigCompatibilityPlugin } from "@opencode/core/config/plugin/compatibility"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Bus } from "@opencode/core/bus"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { host } from "../plugin/host"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.merge(AppNodeBuilder.build(LayerNode.group([Skill.node, Bus.node, FSUtil.node])), Watcher.testLayer),
)

function write(directory: string, name: string, description: string) {
  return fs.writeFile(
    path.join(directory, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}`,
  )
}

describe("ConfigCompatibilityPlugin.Plugin", () => {
  it.live("skips unrelated config writes and reloads when compatibility directories change", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) => {
        const claude = path.join(tmp.path, "claude")
        // Config.testLayer hands this value back by reference, so pushing a root
        // here simulates discovery finding a new compatibility directory.
        const compatibility = { claude: [AbsolutePath.make(claude)], agents: [] as AbsolutePath[] }
        return Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(claude, "skills", "review"), { recursive: true })
            await write(path.join(claude, "skills"), "review", "Initial")
          })

          const config = yield* Config.Test
          const skill = yield* Skill.Service
          const watcher = yield* Watcher.Test
          const filesystem = yield* FSUtil.Service
          const scans = { count: 0 }

          yield* ConfigCompatibilityPlugin.Plugin.effect(
            host({
              skill: {
                list: () => Effect.die("unused skill.list"),
                transform: skill.transform,
                reload: skill.reload,
              },
            }),
          ).pipe(
            Effect.provideService(
              FSUtil.Service,
              FSUtil.Service.of({
                ...filesystem,
                scan: (pattern, options) =>
                  Effect.sync(() => scans.count++).pipe(Effect.andThen(filesystem.scan(pattern, options))),
              }),
            ),
          )

          expect(scans.count).toBe(1)
          expect((yield* skill.list()).map((item) => item.id)).toEqual([Skill.ID.make("review")])
          const subscriptions = yield* watcher.subscriptions()

          // Plugin state and log writes land under config roots but leave the
          // compatibility directories untouched; they must not tear down and
          // rescan every skill watch.
          for (let index = 0; index < 20; index++)
            yield* config.emitChange({ type: "update", path: path.join(tmp.path, "state", `file-${index}.log`) })
          yield* Effect.sleep("300 millis")
          expect(scans.count).toBe(1)
          expect(yield* watcher.subscriptions()).toEqual(subscriptions)

          // A root that appears after startup still reloads.
          const agents = path.join(tmp.path, "agents")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(agents, "skills", "deploy"), { recursive: true })
            await write(path.join(agents, "skills"), "deploy", "Deploy")
          })
          compatibility.agents.push(AbsolutePath.make(agents))
          yield* config.emitChange({ type: "update", path: agents })
          yield* Effect.sleep("300 millis")
          expect(scans.count).toBe(3)
          expect((yield* skill.list()).map((item) => item.id).toSorted()).toEqual([
            Skill.ID.make("deploy"),
            Skill.ID.make("review"),
          ])
        }).pipe(Effect.provide(Config.testLayer([], compatibility)))
      }),
    ),
  )
})

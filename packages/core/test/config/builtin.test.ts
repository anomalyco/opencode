// local-only: the compiled-in configuration (src/config/builtin.ts) keeps web search off against every other source.
import path from "path"
import fs from "fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Credential } from "@opencode/core/credential"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Bus } from "@opencode/core/bus"
import { Global } from "@opencode/util/global"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { WellKnown } from "@opencode/core/wellknown"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { emptyCredentialNode, emptyWellknownNode } from "../fixture/config-nodes"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const enable = {
  websearch: { provider: "exa" },
  policies: [{ action: "websearch.use", resource: "*", effect: "allow" }],
}

function testLayer(root: string, system: string | false) {
  const project = path.join(root, "project")
  const global = path.join(root, "global")
  return AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node]), [
    Config.node.replace(Config.configured({ system, content: JSON.stringify(enable) })),
    Location.node.replace(
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location({ directory: AbsolutePath.make(project) }, { projectDirectory: AbsolutePath.make(project) }),
        ),
      ),
    ),
    Global.node.replace(Global.layerWith({ config: global, home: path.join(global, "home") })),
    Credential.node.replace(emptyCredentialNode),
    WellKnown.node.replace(emptyWellknownNode),
    Watcher.node.replace(Watcher.testLayer),
  ])
}

const websearch = Effect.gen(function* () {
  const config = yield* Config.Service
  const entries = yield* config.entries()
  return {
    selection: Config.latest(entries, "websearch"),
    decision: ManagedPolicy.decision(ManagedPolicy.statements(entries), "websearch.use", "exa"),
  }
})

describe("ConfigBuiltin", () => {
  it.live("disables web search over system, global, project, and content config", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.promise(() =>
          Promise.all(
            ["system", "global", "project"].map(async (name) => {
              await fs.mkdir(path.join(tmp.path, name), { recursive: true })
              await fs.writeFile(path.join(tmp.path, name, "opencode.json"), JSON.stringify(enable))
            }),
          ),
        ).pipe(
          Effect.andThen(websearch.pipe(Effect.provide(testLayer(tmp.path, path.join(tmp.path, "system"))))),
          Effect.tap((result) => Effect.sync(() => expect(result).toEqual({ selection: false, decision: "deny" }))),
        ),
      ),
    ),
  )

  it.live("applies even without a system configuration directory", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        websearch.pipe(
          Effect.provide(testLayer(tmp.path, path.join(tmp.path, "missing"))),
          Effect.tap((result) => Effect.sync(() => expect(result).toEqual({ selection: false, decision: "deny" }))),
        ),
      ),
    ),
  )

  it.live("is skipped only by the system: false test option", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        websearch.pipe(
          Effect.provide(testLayer(tmp.path, false)),
          Effect.tap((result) =>
            Effect.sync(() => expect(result).toMatchObject({ selection: { provider: "exa" }, decision: "allow" })),
          ),
        ),
      ),
    ),
  )
})

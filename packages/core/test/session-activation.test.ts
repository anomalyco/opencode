import { describe, expect, setDefaultTimeout } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { Bus } from "@Mackery6969/core/bus"
import { Database } from "@Mackery6969/core/database/database"
import { AppNodeBuilder } from "@Mackery6969/core/effect/app-node-builder"
import { Watcher } from "@Mackery6969/core/filesystem/watcher"
import { LocationServiceMap } from "@Mackery6969/core/location-service-map"
import { AbsolutePath } from "@Mackery6969/core/schema"
import { Session } from "@Mackery6969/core/session"
import { SessionExecution } from "@Mackery6969/core/session/execution"
import { SessionProjector } from "@Mackery6969/core/session/projector"
import { LayerNode } from "@Mackery6969/util/effect/layer-node"
import { Global } from "@Mackery6969/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

// Real Location boot with plugin discovery, so the first request races the initial plugin activation.
setDefaultTimeout(30_000)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, Session.node, LocationServiceMap.node]),
    [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)

const project = Effect.gen(function* () {
  const tmp = yield* tmpdirScoped()
  yield* Effect.promise(() =>
    Bun.write(
      path.join(tmp.path, ".opencode/plugins/prompt.ts"),
      `export default {
        id: "prompt-readiness",
        async setup(ctx) {
          await ctx.session.hook("prompt", (event) => {
            event.prompt.text = "Prepared by plugin"
          })
          await ctx.command.transform((editor) =>
            editor.add({ name: "ready", description: "Registered by plugin", execute: async () => {} }),
          )
        },
      }`,
    ),
  )
  return tmp
})

describe("Session waits for plugin activation", () => {
  it.live("runs prompt hooks from a cold Location before admitting a prompt", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const admitted = yield* sessions.prompt({ sessionID: session.id, text: "Original", resume: false })
      expect(admitted.payload.text).toBe("Prepared by plugin")
    }),
  )

  it.live("resolves plugin commands from a cold Location", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      yield* sessions.command({ sessionID: session.id, command: "ready", text: "now" })
    }),
  )
})

import { describe, expect, setDefaultTimeout } from "bun:test"
import { Effect, Fiber, Exit, Cause } from "effect"
import path from "path"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionProjector } from "@opencode/core/session/projector"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

// Real Location boot with plugin discovery, so the first request races the initial plugin activation.
setDefaultTimeout(15_000)

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
          await ctx.session.hook("interrupt", (event) => Bun.write(${JSON.stringify(tmp.path)} + "/interrupted-" + event.sessionID, ""))
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

  it.live("delivers cancellation to an interrupted Promise command without affecting another session", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/plugins/wait.ts"),
          `export default {
        id: "cancellable-command",
        async setup(ctx) {
          await ctx.command.transform((editor) => editor.add({
            name: "wait",
            execute: async (input, { signal }) => {
              await Bun.write(${JSON.stringify(tmp.path)} + "/started-" + input.sessionID, "started")
              await new Promise((resolve) => signal.addEventListener("abort", async () => {
                await Bun.write(${JSON.stringify(tmp.path)} + "/cancelled-" + input.sessionID, "cancelled")
                resolve()
              }, { once: true }))
            },
          }))
        },
      }`,
        ),
      )
      const sessions = yield* Session.Service
      const first = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const second = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const run = yield* sessions.command({ sessionID: first.id, command: "wait", text: "" }).pipe(Effect.forkScoped)
      const other = yield* sessions.command({ sessionID: second.id, command: "wait", text: "" }).pipe(Effect.forkScoped)
      yield* Effect.promise(async () => {
        while (
          !(await Bun.file(path.join(tmp.path, "started-" + first.id)).exists()) ||
          !(await Bun.file(path.join(tmp.path, "started-" + second.id)).exists())
        )
          await Bun.sleep(5)
      })
      yield* Fiber.interrupt(run)
      const exit = yield* Fiber.await(run)
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      yield* Effect.promise(async () => {
        while (!(await Bun.file(path.join(tmp.path, "cancelled-" + first.id)).exists())) await Bun.sleep(5)
      })
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "cancelled-" + second.id)).exists())).toBe(false)
      yield* Fiber.interrupt(other)
      yield* Fiber.await(other)
    }),
  )

  it.live("notifies explicit interruption hooks even when the session has no active execution", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      expect(yield* sessions.interrupt(session.id)).toBe(false)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "interrupted-" + session.id)).exists())).toBe(
        true,
      )
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

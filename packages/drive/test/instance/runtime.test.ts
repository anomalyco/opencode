import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Exit, Fiber } from "effect"
import { initializeInstance } from "../../src/instance/instance.js"
import * as OpenCodeInstance from "../../src/instance/runtime.js"

const fakeOpenCode = [
  process.execPath,
  resolve("test", "fixtures", "fake-opencode.ts"),
]

it.live("stops a TUI while its readiness check is pending", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const artifacts = yield* Effect.promise(() => initializeInstance())
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => rm(artifacts, { recursive: true, force: true })),
      )
      const instance = yield* OpenCodeInstance.make({
        artifacts,
        name: "pending-client-test",
        scripted: true,
        command: [...fakeOpenCode, "no-ui"],
      })

      yield* instance.launchServer
      const launch = yield* instance.launchTui("pending").pipe(
        Effect.exit,
        Effect.forkChild,
      )
      yield* Effect.sleep(100)

      const started = Date.now()
      yield* instance.stop
      expect(Date.now() - started).toBeLessThan(5_000)
      expect(Exit.isFailure(yield* Fiber.join(launch))).toBe(true)
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
)

it.live("reads the database target from Effect config", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const artifacts = yield* Effect.promise(() => initializeInstance())
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => rm(artifacts, { recursive: true, force: true })),
      )
      const instance = yield* OpenCodeInstance.make({
        artifacts,
        name: "database-config-test",
        scripted: true,
        command: fakeOpenCode,
      })
      yield* Effect.addFinalizer(() => instance.stop)

      yield* instance.launchServer
      expect(yield* Effect.promise(() => Bun.file(`${artifacts}/service-db.txt`).text())).toBe("restart.sqlite")
    }),
  ).pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENCODE_DRIVE_DB: "restart.sqlite" }))),
    Effect.provide(NodeServices.layer),
  ),
)

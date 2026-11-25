import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { makeLocalDriver } from "@opencode/core/environment/local"
import { Location } from "@opencode/core/location"
import { Shell } from "@opencode/core/shell"
import { AppProcess } from "@opencode/util/process"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { it } from "./lib/effect"

const build = (environment: Layer.Layer<Environment.Service, unknown, unknown>) =>
  AppNodeBuilder.build(Shell.node, [
    Location.node.replace(tempLocationLayer),
    Global.node.replace(tempGlobalLayer),
    Config.node.replace(Config.testLayer()),
    Environment.node.replace(environment as never),
  ])

it.live("create fails instead of hanging when the spawner dies", () =>
  Effect.gen(function* () {
    // Not `local`, so the daemon is never tried and the fake spawner is the one that runs.
    const target = Environment.make(
      Environment.localID,
      makeLocalDriver(ChildProcessSpawner.make(() => Effect.die(new TypeError("spawn threw synchronously")))),
      { local: false, shell: "sh" },
    )

    const error = yield* Effect.gen(function* () {
      const shell = yield* Shell.Service
      return yield* shell
        .create({ shell: "sh", command: "echo hi", timeout: 1_000, environment: target })
        .pipe(Effect.flip)
    }).pipe(Effect.provide(build(Layer.succeed(Environment.Service, target))), Effect.timeout("5 seconds"))
    expect(error).toBeInstanceOf(AppProcess.AppProcessError)
    expect(String((error as AppProcess.AppProcessError).cause)).toContain("spawn threw synchronously")
  }),
)

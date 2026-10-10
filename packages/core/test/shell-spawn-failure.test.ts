import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { Shell } from "@opencode/core/shell"
import { AppProcess } from "@opencode/util/process"
import { Global } from "@opencode/util/global"
import { hostEnvironmentLayer } from "./fixture/environment"
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
    const environment = Layer.effect(
      Environment.Service,
      Effect.gen(function* () {
        const host = yield* Environment.Service
        return Environment.Service.of({
          ...host,
          spawner: ChildProcessSpawner.make(() => Effect.die(new TypeError("spawn threw synchronously"))),
        })
      }),
    ).pipe(Layer.provide(hostEnvironmentLayer))

    const error = yield* Effect.gen(function* () {
      const shell = yield* Shell.Service
      return yield* shell.create({ shell: "sh", command: "echo hi", timeout: 1_000 }).pipe(Effect.flip)
    }).pipe(Effect.provide(build(environment)), Effect.timeout("5 seconds"))
    expect(error).toBeInstanceOf(AppProcess.AppProcessError)
    expect(String((error as AppProcess.AppProcessError).cause)).toContain("spawn threw synchronously")
  }),
)

it.live("create rejects a command containing NUL with an explanation", () =>
  Effect.gen(function* () {
    const error = yield* Effect.gen(function* () {
      const shell = yield* Shell.Service
      return yield* shell.create({ shell: "sh", command: "printf 'a\u0000b'", timeout: 1_000 }).pipe(Effect.flip)
    }).pipe(Effect.provide(build(hostEnvironmentLayer)), Effect.timeout("5 seconds"))
    expect(error).toBeInstanceOf(AppProcess.AppProcessError)
    expect(String((error as AppProcess.AppProcessError).cause)).toContain("NUL character")
  }),
)

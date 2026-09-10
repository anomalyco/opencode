import { expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { Shell } from "@opencode/core/shell"
import { Global } from "@opencode/util/global"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { it } from "./lib/effect"

it.live("stop terminates a command and preserves its output", () =>
  Effect.gen(function* () {
    const shell = yield* Shell.Service
    const info = yield* shell.create({ command: "sleep 60", timeout: 0 })
    expect((yield* shell.stop(info.id)).status).toBe("killed")
    expect((yield* shell.wait(info.id)).status).toBe("killed")
    expect((yield* shell.result(info)).capture).toBeDefined()
    expect((yield* shell.list()).some((item) => item.id === info.id)).toBe(false)
    expect((yield* shell.stop(info.id)).status).toBe("killed")

    const completed = yield* shell.create({ command: "echo retained", timeout: 0 })
    yield* shell.wait(completed.id)
    expect((yield* shell.stop(completed.id)).status).toBe("exited")
    expect((yield* shell.result(completed)).capture?.output).toContain("retained")
    yield* shell.remove(completed.id)
    expect(yield* shell.stop(completed.id).pipe(Effect.flip)).toBeInstanceOf(Shell.NotFoundError)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(Shell.node, [
        Location.node.replace(tempLocationLayer),
        Global.node.replace(tempGlobalLayer),
        Config.node.replace(Config.testLayer()),
        Environment.node.replace(hostEnvironmentLayer),
      ]),
    ),
  ),
)

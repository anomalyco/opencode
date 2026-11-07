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

it.live("returns an empty page for a zero output limit instead of failing", () =>
  Effect.gen(function* () {
    const shell = yield* Shell.Service
    const info = yield* shell.create({ shell: "/bin/sh", command: "printf fixture-output", timeout: 0 })
    const done = yield* shell.wait(info.id)

    const page = yield* shell.output(done.id, { limit: 0 })
    expect(page.output).toBe("")
    expect(page.cursor).toBe(0)

    const full = yield* shell.output(done.id)
    expect(full.output).toBe("fixture-output")
    expect(page.size).toBe(full.size)
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

import { expect } from "bun:test"
import { Effect, Fiber, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { Shell } from "@opencode/core/shell"
import { Event } from "@opencode/schema/shell"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Bus.node, Shell.node]), [
    Location.node.replace(tempLocationLayer),
    Global.node.replace(tempGlobalLayer),
    Config.node.replace(Config.testLayer()),
    Environment.node.replace(hostEnvironmentLayer),
  ]),
)

it.live("publishes the spawned process pid in shell.created", () =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const shell = yield* Shell.Service
    const created = yield* bus.subscribe(Event.Created).pipe(
      Stream.take(1),
      Stream.runCollect,
      Effect.forkScoped({ startImmediately: true }),
    )
    const info = yield* shell.create({
      shell: process.platform === "win32" ? "powershell.exe" : "/bin/sh",
      command: process.platform === "win32" ? "Start-Sleep -Seconds 60" : "sleep 60",
      timeout: 0,
    })
    yield* Effect.addFinalizer(() => shell.remove(info.id).pipe(Effect.orDie))
    const [event] = yield* Fiber.join(created)

    expect(info.pid).toBeGreaterThan(0)
    expect(event.data.info).toEqual(info)
    expect(event.data.info.pid).toBe(info.pid)
  }),
)

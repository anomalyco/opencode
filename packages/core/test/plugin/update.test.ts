import { expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { PluginUpdate } from "@opencode-ai/core/plugin/update"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Npm } from "@opencode-ai/util/npm"
import { Effect, Fiber, Layer, Option, Stream } from "effect"
import { testEffect } from "../lib/effect"

const checks: string[] = []
const npm = makeGlobalNode({
  service: Npm.Service,
  layer: Layer.succeed(
    Npm.Service,
    Npm.Service.of({
      add: () => Effect.die("unused add"),
      resolve: () => Effect.die("unused resolve"),
      check: (target) => Effect.sync(() => checks.push(target)).pipe(Effect.as(true)),
      update: () => Effect.succeed({ directory: "" }),
      which: () => Effect.die("unused which"),
    }),
  ),
  deps: [],
})

const it = testEffect(AppNodeBuilder.build(PluginUpdate.node, [Npm.node.replace(npm)]))

it.effect("caches checks by target", () =>
  Effect.gen(function* () {
    checks.length = 0
    const updates = yield* PluginUpdate.Service
    const first = yield* updates.check("fixture")
    const second = yield* updates.check("fixture")

    expect(checks).toEqual(["fixture"])
    expect(first).toBeTrue()
    expect(second).toBeTrue()
  }),
)

it.effect("publishes successful package updates", () =>
  Effect.gen(function* () {
    const updates = yield* PluginUpdate.Service
    const changed = yield* updates
      .changes()
      .pipe(Stream.take(1), Stream.runHead, Effect.forkScoped({ startImmediately: true }))

    yield* updates.update("fixture")

    expect(Option.getOrUndefined(yield* Fiber.join(changed))).toBe("fixture")
  }),
)

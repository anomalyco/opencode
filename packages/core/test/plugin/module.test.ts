import { expect } from "bun:test"
import path from "node:path"
import { Deferred, Effect, Exit, Fiber, Layer, Schedule, Scope, Stream } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { PluginModule } from "@opencode-ai/core/plugin/module"
import { Global } from "@opencode-ai/util/global"
import { Npm } from "@opencode-ai/util/npm"
import { tempGlobalLayer } from "../fixture/global"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.merge(
    AppNodeBuilder.build(Npm.node, [Global.node.replace(tempGlobalLayer)]),
    Watcher.layer().pipe(Layer.provide(Watcher.nativeLayer)),
  ),
)

it.live("watches creation of an external helper with missing parent directories", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const entry = path.join(directory.path, "plugin/index.ts")
    yield* Effect.promise(() => Bun.write(entry, 'export { default } from "../shared/new/nested/helper.ts"'))
    const modules = yield* PluginModule.make()
    const operation = { type: "add" as const, target: path.dirname(entry), options: {} }
    expect(Exit.isFailure(yield* modules.load(operation).pipe(Effect.exit))).toBe(true)
    const changed = yield* modules
      .changes()
      .pipe(Stream.runHead, Effect.timeout("5 seconds"), Effect.forkScoped({ startImmediately: true }))
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory.path, "shared/new/nested/helper.ts"),
        'export default { id: "appeared", async setup() {} }',
      ),
    )
    yield* Fiber.join(changed)
    const loaded = yield* modules.load(operation)
    expect(loaded).toMatchObject({ id: "appeared" })
  }),
)

it.live("interrupts pending watcher setup when the loader scope closes during module evaluation", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const entry = path.join(directory.path, "index.ts")
    const entered = path.join(directory.path, "entered")
    const release = path.join(directory.path, "release")
    const started = yield* Deferred.make<void>()
    const stopped = yield* Deferred.make<void>()
    const gate = yield* Deferred.make<void>()
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => Bun.write(release, "release")).pipe(
        Effect.andThen(Deferred.succeed(gate, undefined)),
        Effect.andThen(Scope.close(scope, Exit.void)),
      ),
    )
    yield* Effect.promise(() =>
      Bun.write(
        entry,
        `
        await Bun.write(${JSON.stringify(entered)}, "entered")
        while (!(await Bun.file(${JSON.stringify(release)}).exists())) await Bun.sleep(5)
        export default { id: "pending", async setup() {} }
      `,
      ),
    )
    const modules = yield* PluginModule.make().pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provideService(Watcher.Service, {
        subscribe: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(gate)),
            Effect.ensuring(Deferred.succeed(stopped, undefined)),
            Effect.as(Stream.never),
          ),
      }),
    )
    yield* modules.load({ type: "add", target: directory.path, options: {} }).pipe(Effect.forkIn(scope))
    yield* Deferred.await(started)
    yield* Effect.promise(() => Bun.file(entered).exists()).pipe(
      Effect.repeat({ until: (exists) => exists, schedule: Schedule.spaced("5 millis") }),
      Effect.timeout("2 seconds"),
    )
    yield* Scope.close(scope, Exit.void)
    expect(yield* Deferred.isDone(stopped)).toBe(true)
    yield* Effect.promise(() => Bun.write(release, "release"))
    // Let the uncancellable native import finish; Bun's test runner detects unhandled rejections.
    yield* Effect.promise(() => Bun.sleep(50))
  }),
)

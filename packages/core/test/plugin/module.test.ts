import path from "path"
import { pathToFileURL } from "url"
import { expect, test } from "bun:test"
import { PluginModule } from "@opencode-ai/core/plugin/module"
import { Npm } from "@opencode-ai/util/npm"
import { Effect, Latch } from "effect"

test("loads cached plugin packages without requesting a refresh", async () => {
  const calls: unknown[] = []
  const entrypoint = path.join(import.meta.dir, "fixtures", "config-effect-plugin.ts")
  const plugin = await PluginModule.load({ type: "add", target: "fixture-plugin", options: {} }).pipe(
    Effect.provideService(
      Npm.Service,
      Npm.Service.of({
        add: (_pkg, options) =>
          Effect.sync(() => {
            calls.push(options)
            return { directory: path.dirname(entrypoint), entrypoint: pathToFileURL(entrypoint).href }
          }),
        resolve: () => Effect.die(new Error("Unexpected resolve")),
        which: () => Effect.die(new Error("Unexpected which")),
      }),
    ),
    Effect.runPromise,
  )

  expect(plugin.id).toBe("config-effect-plugin")
  expect(calls).toEqual([{ subpaths: ["server", ""] }])
})

test("refreshes package plugins in the background after importing them", async () => {
  const result = await Effect.gen(function* () {
    const started = yield* Latch.make()
    const calls: unknown[] = []
    const entrypoint = path.join(import.meta.dir, "fixtures", "config-effect-plugin.ts")
    const installed = { directory: path.dirname(entrypoint), entrypoint: pathToFileURL(entrypoint).href }
    const npm = Npm.Service.of({
      add: (_pkg, options) => {
        calls.push(options)
        if (options?.refresh) return started.open.pipe(Effect.andThen(Effect.never))
        return Effect.succeed(installed)
      },
      resolve: () => Effect.die(new Error("Unexpected resolve")),
      which: () => Effect.die(new Error("Unexpected which")),
    })
    const plugin = yield* PluginModule.load(
      { type: "add", target: "fixture-plugin", options: {} },
      { refresh: true },
    ).pipe(Effect.provideService(Npm.Service, npm))
    yield* started.await
    return { calls, plugin }
  }).pipe(Effect.runPromise)

  expect(result.plugin.id).toBe("config-effect-plugin")
  expect(result.calls).toEqual([{ subpaths: ["server", ""] }, { subpaths: ["server", ""], refresh: true }])
})

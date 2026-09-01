import path from "path"
import { pathToFileURL } from "url"
import { expect, test } from "bun:test"
import { PluginModule } from "@opencode-ai/core/plugin/module"
import { Npm } from "@opencode-ai/util/npm"
import { Effect } from "effect"

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
            return { directory: path.dirname(entrypoint), entrypoint: pathToFileURL(entrypoint).href, version: "1.2.3" }
          }),
        resolve: (_pkg, options) =>
          Effect.sync(() => {
            calls.push(options)
            return { directory: path.dirname(entrypoint), entrypoint: pathToFileURL(entrypoint).href }
          }),
        check: () => Effect.die(new Error("Unexpected check")),
        update: () => Effect.die(new Error("Unexpected update")),
        which: () => Effect.die(new Error("Unexpected which")),
      }),
    ),
    Effect.runPromise,
  )

  expect(plugin.id).toBe("config-effect-plugin")
  expect(plugin.features).toEqual({ tui: true, rpc: true })
  expect(plugin.source).toEqual({ type: "package", target: "fixture-plugin", version: "1.2.3" })
  expect(calls).toEqual([{ subpaths: ["server", ""] }, { subpaths: ["tui"] }, { subpaths: ["rpc"] }])
})

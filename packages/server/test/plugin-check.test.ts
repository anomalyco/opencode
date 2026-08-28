import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Npm } from "@opencode-ai/util/npm"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("plugin check honors Location query, omits unknown revisions, and returns readable 400 errors", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("plugin-check-http-")))
    const global = path.join(tmp.path, "global")
    const project = path.join(tmp.path, "project")
    yield* Effect.promise(() => Promise.all([fs.mkdir(global), fs.mkdir(project)]))
    const target = "inspection-plugin@latest"
    const config = JSON.stringify({ plugins: ["-*", target] })
    yield* Effect.promise(() => Bun.write(path.join(project, "opencode.json"), config))
    let fail = false
    let checks = 0
    const handler = yield* ServerFetch.make(
      { database: { path: ":memory:" }, config: { directory: global }, fs: { filewatcher: false } },
      {
        overrides: [
          [
            Npm.node,
            Layer.succeed(Npm.Service, {
              add: () => Effect.fail(new Npm.InstallFailedError({ dir: tmp.path })),
              resolve: () => Effect.succeed({ directory: tmp.path }),
              which: () => Effect.undefined,
              check: () => {
                checks++
                if (fail)
                  return Effect.fail(
                    new Npm.InstallFailedError({ dir: tmp.path, cause: new Error("registry unavailable") }),
                  )
                return Effect.succeed({ installed: undefined, available: "2.0.0", mutable: true })
              },
            }),
          ],
        ],
      },
    )
    const request = (directory: string, target: string) =>
      Effect.promise(async () => {
        const url = new URL("http://opencode.local/api/plugin/check")
        url.searchParams.set("location[directory]", directory)
        const response = await handler(
          new Request(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ target }),
          }),
        )
        const body: unknown = await response.json()
        return { status: response.status, body }
      })
    const result = yield* request(project, target)
    expect(result).toMatchObject({
      status: 200,
      body: { location: { directory: project }, data: { available: "2.0.0", mutable: true } },
    })
    expect(result).not.toHaveProperty("body.data.installed")
    expect(yield* request(global, target)).toMatchObject({
      status: 400,
      body: { _tag: "PluginCheckError", message: expect.stringContaining("server inventory") },
    })
    expect(checks).toBe(1)
    fail = true
    expect(yield* request(project, target)).toMatchObject({
      status: 400,
      body: { _tag: "PluginCheckError", message: expect.stringContaining("registry unavailable") },
    })
    expect(yield* Effect.promise(() => Bun.file(path.join(project, "opencode.json")).text())).toBe(config)
  }),
)

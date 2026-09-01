import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { expect } from "bun:test"
import { Effect, Layer, Schedule } from "effect"
import { Npm } from "@opencode-ai/util/npm"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("updates package plugins in the requested Location", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("plugin-update-http-")))
    const global = path.join(tmp.path, "global")
    const project = path.join(tmp.path, "project")
    const plugin = path.join(tmp.path, "plugin")
    yield* Effect.promise(async () => {
      await Promise.all([fs.mkdir(global), fs.mkdir(project), fs.mkdir(plugin)])
      await Bun.write(path.join(project, "opencode.json"), JSON.stringify({ plugins: ["fixture-plugin"] }))
      await Bun.write(path.join(plugin, "index.js"), 'export default { id: "fixture.plugin", setup() {} }')
    })
    let version = "1.0.0"
    let fail = false
    const entry = () => ({
      directory: plugin,
      entrypoint: pathToFileURL(path.join(plugin, "index.js")).href,
      version,
      revision: version,
    })
    const handler = yield* ServerFetch.make(
      { database: { path: ":memory:" }, config: { directory: global }, fs: { filewatcher: false } },
      {
        overrides: [
          Npm.node.replace(
            Layer.succeed(
              Npm.Service,
              Npm.Service.of({
                add: () => Effect.sync(entry),
                resolve: () => Effect.sync(entry),
                check: () => Effect.succeed(false),
                update: () => {
                  if (fail) return Effect.fail(new Npm.InstallFailedError({ dir: plugin }))
                  return Effect.sync(() => (version = "2.0.0")).pipe(Effect.map(entry))
                },
                which: () => Effect.undefined,
              }),
            ),
          ),
        ],
      },
    )
    const update = (target: string) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local/api/plugin/update?location[directory]=${encodeURIComponent(project)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ target }),
          }),
        ),
      )

    expect((yield* update("fixture-plugin")).status).toBe(204)
    const listedVersion = yield* Effect.promise(async () => {
      const response = await handler(
        new Request(`http://opencode.local/api/plugin?location[directory]=${encodeURIComponent(project)}`),
      )
      const body = (await response.json()) as { data: Array<{ id?: string; source: { version?: string } }> }
      return body.data.find((item) => item.id === "fixture.plugin")?.source.version
    }).pipe(
      Effect.filterOrFail((version) => version === "2.0.0"),
      Effect.retry(Schedule.spaced("10 millis")),
      Effect.timeout("2 seconds"),
    )
    expect(listedVersion).toBe("2.0.0")
    expect((yield* update("missing")).status).toBe(400)
    fail = true
    expect((yield* update("fixture-plugin")).status).toBe(503)
  }),
)

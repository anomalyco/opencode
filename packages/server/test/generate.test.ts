import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Config } from "@opencode-ai/core/config"
import { Generate } from "@opencode-ai/core/generate"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Effect, Layer, Predicate } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const generate = makeLocationNode({
  service: Generate.Service,
  layer: Layer.effect(
    Generate.Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      return Generate.Service.of({
        text: () =>
          config.entries().pipe(
            Effect.map((entries) =>
              JSON.stringify({
                model: Config.latest(entries, "model"),
              }),
            ),
          ),
      })
    }),
  ),
  deps: [Config.node],
})

it.live("uses base configuration without depending on process.cwd()", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-generate-endpoint-")))
    const global = path.join(tmp.path, "global")
    const project = path.join(tmp.path, "project")
    yield* Effect.promise(() => Promise.all([fs.mkdir(global), fs.mkdir(project)]))
    yield* Effect.promise(() =>
      Promise.all([
        fs.writeFile(path.join(global, "opencode.json"), JSON.stringify({ model: "base/default" })),
        fs.writeFile(path.join(project, "opencode.json"), JSON.stringify({ model: "project/default" })),
      ]),
    )
    const handler = yield* ServerFetch.make(
      {
        database: { path: ":memory:" },
        config: { directory: global },
        fs: { filewatcher: false },
      },
      { overrides: [Generate.node.replace(generate)] },
    )

    expect(global).not.toBe(process.cwd())
    expect(yield* request(handler, new URL("http://opencode.local/api/generate"))).toEqual({
      model: { providerID: "base", model: "default" },
    })

    const legacy = new URL("http://opencode.local/api/generate")
    legacy.searchParams.set("location[directory]", project)
    expect(yield* request(handler, legacy)).toEqual({
      model: { providerID: "base", model: "default" },
    })
  }),
)

function request(handler: (request: Request) => Promise<Response>, url: URL) {
  return Effect.promise(() =>
    handler(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      }),
    ).then(async (response) => {
      expect(response.status).toBe(200)
      const body: unknown = await response.json()
      if (!Predicate.isObject(body) || !Predicate.isObject(body.data) || typeof body.data.text !== "string")
        throw new Error("Expected a generate response")
      const result: unknown = JSON.parse(body.data.text)
      return result
    }),
  )
}

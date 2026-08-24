import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Config } from "@opencode-ai/core/config"
import { Generate } from "@opencode-ai/core/generate"
import { Location } from "@opencode-ai/core/location"
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
      const location = yield* Location.Service
      return Generate.Service.of({
        text: () =>
          config.entries().pipe(
            Effect.map((entries) =>
              JSON.stringify({
                directory: location.directory,
                model: Config.latest(entries, "model"),
              }),
            ),
          ),
      })
    }),
  ),
  deps: [Config.node, Location.node],
})

it.live("uses base configuration without a location and location configuration when explicit", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir("opencode-generate-endpoint-")),
    (tmp) =>
      Effect.gen(function* () {
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
          { overrides: [[Generate.node, generate]] },
        )

        expect(global).not.toBe(process.cwd())
        expect(yield* request(handler, new URL("http://opencode.local/api/generate"))).toEqual({
          directory: global,
          model: { providerID: "base", model: "default" },
        })

        const url = new URL("http://opencode.local/api/generate")
        url.searchParams.set("location[directory]", project)
        expect(yield* request(handler, url)).toEqual({
          directory: project,
          model: { providerID: "project", model: "default" },
        })

        const location = yield* Effect.promise(() =>
          handler(new Request("http://opencode.local/api/location")).then((response) => response.json()),
        )
        expect(Predicate.isObject(location) && location.directory).toBe(process.cwd())
      }),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ),
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

import { expect } from "bun:test"
import { Config } from "@opencode/schema/config"
import { Effect, Schema } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

const Decode = {
  integrations: Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) })),
  credential: Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })),
  config: Schema.decodeUnknownSync(Schema.Array(Config.Entry)),
}

it.live("removing the last credential removes its well-known source", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      Bun.serve({
        port: 0,
        fetch: () => Response.json({ auth: { command: ["login"], env: "TOKEN" }, config: { model: "embedded/model" } }),
      }),
    ),
    (manifest) =>
      Effect.gen(function* () {
        const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-credential-wellknown-")))
        const server = yield* startServer(tmp.path)
        const origin = manifest.url.origin
        const directory = new URLSearchParams({ "location[directory]": tmp.path })
        const request = (path: string, init: RequestInit) =>
          Effect.promise(() =>
            fetch(new URL(`${path}?${directory}`, server.base), {
              ...init,
              headers: { ...server.headers, "content-type": "application/json" },
            }),
          )
        const json = (response: Response) => Effect.promise(() => response.json())
        const integrations = () =>
          request("/api/integration", { method: "GET" }).pipe(
            Effect.flatMap(json),
            Effect.map((body) => Decode.integrations(body).data.map((item) => item.id)),
          )
        const models = () =>
          request("/api/config", { method: "GET" }).pipe(
            Effect.flatMap(json),
            Effect.map((body) => Decode.config(body)),
            Effect.map((entries) =>
              entries.flatMap((entry) =>
                entry.type === "document" && entry.info.model
                  ? [`${entry.info.model.providerID}/${entry.info.model.model}`]
                  : [],
              ),
            ),
          )
        const create = (label: string) =>
          request("/api/credential", {
            method: "POST",
            body: JSON.stringify({ integrationID: origin, label, value: { type: "key", key: `key-${label}` } }),
          }).pipe(
            Effect.flatMap(json),
            Effect.map((body) => Decode.credential(body).data.id),
          )
        const remove = (id: string) =>
          request(`/api/credential/${id}`, { method: "DELETE" }).pipe(Effect.map((response) => response.status))

        expect(
          (yield* request("/api/experimental/integration/wellknown", {
            method: "POST",
            body: JSON.stringify({ url: origin }),
          })).status,
        ).toBe(204)
        expect(yield* integrations()).toContain(origin)

        const first = yield* create("first")
        const second = yield* create("second")
        expect(
          yield* eventually(() => models().pipe(Effect.map((ids) => ids.includes("embedded/model")))),
        ).toBe(true)

        expect(yield* remove(first)).toBe(204)
        expect(yield* integrations()).toContain(origin)
        expect(yield* models()).toContain("embedded/model")

        expect(yield* remove(second)).toBe(204)
        expect(yield* eventually(() => integrations().pipe(Effect.map((ids) => !ids.includes(origin))))).toBe(true)
        expect(
          yield* eventually(() => models().pipe(Effect.map((ids) => !ids.includes("embedded/model")))),
        ).toBe(true)
      }),
    (manifest) => Effect.promise(() => manifest.stop(true)),
  ),
)

const eventually = (condition: () => Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (yield* condition()) return true
      yield* Effect.sleep("100 millis")
    }
    return false
  })

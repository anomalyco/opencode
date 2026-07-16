import { expect } from "bun:test"
import { Effect, Fiber, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { KV } from "@opencode-ai/core/kv"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { WellKnown } from "@opencode-ai/core/wellknown"
import { testEffect } from "./lib/effect"

const it = testEffect(FetchHttpClient.layer)
const serviceIt = testEffect(LayerNode.compile(LayerNode.group([WellKnown.node, KV.node, EventV2.node])))

it.live("loads embedded and remote configuration", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      Bun.serve({
        port: 0,
        fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/.well-known/opencode") {
            return Response.json({
              auth: { command: ["login"], env: "TOKEN" },
              config: { model: "embedded/model" },
              remote_config: {
                url: `${url.origin}/config/{env:TOKEN}`,
                headers: { authorization: "Bearer {env:TOKEN}" },
              },
            })
          }
          if (url.pathname === "/config/secret" && request.headers.get("authorization") === "Bearer secret") {
            return Response.json({ config: { model: "remote/model" } })
          }
          return new Response("Not found", { status: 404 })
        },
      }),
    ),
    (server) =>
      Effect.gen(function* () {
        const origin = server.url.origin
        expect(yield* WellKnown.inspect(`${origin}/`)).toEqual({
          auth: { command: ["login"], env: "TOKEN" },
          config: { model: "embedded/model" },
          remote_config: {
            url: `${origin}/config/{env:TOKEN}`,
            headers: { authorization: "Bearer {env:TOKEN}" },
          },
        })
        expect(yield* WellKnown.resolve({ origin, variables: { TOKEN: "secret" } })).toEqual([
          { model: "embedded/model" },
          { model: "remote/model" },
        ])
      }),
    (server) => Effect.promise(() => server.stop(true)),
  ),
)

serviceIt.live("persists sources in one KV value", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      Bun.serve({
        port: 0,
        fetch: () => Response.json({ auth: { command: ["login"], env: "TOKEN" } }),
      }),
    ),
    (server) =>
      Effect.gen(function* () {
        const wellknown = yield* WellKnown.Service
        const kv = yield* KV.Service
        const events = yield* EventV2.Service
        const changed = yield* events
          .subscribe(WellKnown.Event.Updated)
          .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
        const entry = yield* wellknown.add(`${server.url.origin}/`)

        expect(entry.origin).toBe(server.url.origin)
        expect(yield* kv.get("wellknown:sources")).toEqual([server.url.origin])
        expect(yield* wellknown.entries()).toEqual([entry])
        expect(yield* Fiber.join(changed)).toHaveLength(1)

        yield* wellknown.remove(server.url.origin)
        expect(yield* kv.get("wellknown:sources")).toEqual([])
        expect(yield* wellknown.entries()).toEqual([])
      }),
    (server) => Effect.promise(() => server.stop(true)),
  ),
)

serviceIt.live("refreshes changed manifests", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      let command = "first"
      return {
        server: Bun.serve({
          port: 0,
          fetch: () => Response.json({ auth: { command: [command], env: "TOKEN" } }),
        }),
        update: () => {
          command = "second"
        },
      }
    }),
    ({ server, update }) =>
      Effect.gen(function* () {
        const wellknown = yield* WellKnown.Service
        const events = yield* EventV2.Service
        yield* wellknown.add(server.url.origin)
        expect(yield* wellknown.refresh()).toBe(false)

        const changed = yield* events
          .subscribe(WellKnown.Event.Updated)
          .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
        update()
        expect(yield* wellknown.refresh()).toBe(true)
        expect(yield* Fiber.join(changed)).toHaveLength(1)
        expect(wellknown.snapshot()[0]?.manifest.auth?.command).toEqual(["second"])
      }),
    ({ server }) => Effect.promise(() => server.stop(true)),
  ),
)

import { expect } from "bun:test"
import { Context, Effect, Exit, Layer, Scope, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { AbsolutePath, Location, OpenCode, Session } from "../src/effect"

const it = testEffect(Layer.empty)

for (const entrypoint of ["create", "layer"] as const) {
  it.live(`${entrypoint} keeps requests and streams on its own transport despite an ambient Fetch`, () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const calls: string[] = []
      const ambient = Object.assign(
        (input: RequestInfo | URL) => {
          calls.push(input instanceof Request ? input.url : String(input))
          return Promise.reject(new Error("The caller's Fetch must not receive embedded SDK requests"))
        },
        { preconnect: () => undefined },
      )
      const parent = yield* Effect.scope
      const scope = yield* Scope.fork(parent)
      const options: OpenCode.CreateOptions = {
        app: { version: "transport-test" },
        config: { directory: directory.path, project: false, content: "{}" },
        events: { persist: true },
        models: { fetch: false },
        fs: { filewatcher: false },
      }
      const client = yield* (
        entrypoint === "create"
          ? OpenCode.create(options).pipe(Scope.provide(scope))
          : Layer.buildWithScope(OpenCode.layer(options), scope).pipe(Effect.map(Context.get(OpenCode.Service)))
      ).pipe(Effect.provideService(FetchHttpClient.Fetch, ambient))

      yield* Effect.gen(function* () {
        expect(yield* client.health.get()).toMatchObject({ healthy: true, version: "transport-test" })
        const session = yield* client.sessions.create({
          location: Location.Ref.make({ directory: AbsolutePath.make(directory.path) }),
        })
        expect((yield* client.sessions.get({ sessionID: session.id })).id).toBe(session.id)
        const events = yield* client.sessions.log({ sessionID: session.id }).pipe(Stream.runCollect)
        expect(events.some((event) => event.type === "session.created")).toBe(true)
        expect(yield* client.events.subscribe().pipe(Stream.take(1), Stream.runCollect)).toMatchObject([
          { type: "server.connected" },
        ])
        expect(yield* client.sessions.get({ sessionID: Session.ID.create() }).pipe(Effect.flip)).toMatchObject({
          _tag: "SessionNotFoundError",
        })
        // Binding the SDK's transport must not change the caller's surrounding context.
        expect(yield* FetchHttpClient.Fetch).toBe(ambient)
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, ambient))
      expect(calls).toEqual([])

      yield* Scope.close(scope, Exit.void)
      expect(
        Exit.isFailure(
          yield* client.health.get().pipe(Effect.provideService(FetchHttpClient.Fetch, ambient), Effect.exit),
        ),
      ).toBe(true)
      expect(calls).toEqual([])
    }),
  )
}

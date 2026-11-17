import { expect } from "bun:test"
import { Context, Deferred, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const locations = Effect.gen(function* () {
  const layer = LayerNode.compile(LayerNode.group([Integration.node, Credential.node]), {
    shared: Node.tags.values.global,
  })
  const memo = yield* Layer.makeMemoMap
  const scope = yield* Effect.scope
  const first = yield* Layer.buildWithMemoMap(layer, memo, scope)
  const second = yield* Layer.buildWithMemoMap(layer, memo, scope)
  const a = Context.get(first, Integration.Service)
  const b = Context.get(second, Integration.Service)
  const credentials = Context.get(first, Credential.Service)
  expect(a).not.toBe(b)
  expect(credentials).toBe(Context.get(second, Credential.Service))
  return { a, b, credentials }
})

for (const cancel of [false, true]) {
  it.effect(`shares refresh across Locations${cancel ? " after the first caller is interrupted" : ""}`, () =>
    Effect.gen(function* () {
      const services = yield* locations
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const integrationID = Integration.ID.make("openai")
      const methodID = Integration.MethodID.make("oauth")
      let calls = 0
      const registration = {
        integrationID,
        method: { id: methodID, type: "oauth" as const, label: "OAuth" },
        authorize: () => Effect.die("unused sign-in"),
        refresh: (value: Credential.OAuth) =>
          Effect.gen(function* () {
            calls++
            expect(value.refresh).toBe("old-refresh")
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            return Credential.OAuth.make({
              ...value,
              access: "new-access",
              refresh: "new-refresh",
              expires: Number.MAX_SAFE_INTEGER,
            })
          }),
      }
      yield* services.a.transform((editor) => editor.method.update(registration))
      yield* services.b.transform((editor) => editor.method.update(registration))
      const stored = yield* services.credentials.create({
        integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: "old-access",
          refresh: "old-refresh",
          expires: 1,
        }),
      })
      const connection = { type: "credential" as const, id: stored.id, label: stored.label, method: "oauth" as const }
      const first = yield* services.a.connection.resolve(connection).pipe(Effect.forkScoped)
      yield* Deferred.await(entered)
      if (cancel) yield* Fiber.interrupt(first)
      const second = yield* services.b.connection.resolve(connection).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      expect(calls).toBe(1)
      yield* Deferred.succeed(release, undefined)
      const value = yield* Fiber.join(second)
      if (!cancel) expect(yield* Fiber.join(first)).toEqual(value)
      expect((yield* services.credentials.get(stored.id))?.value).toEqual(value)
      expect(yield* services.b.connection.resolve(connection)).toEqual(value)
      expect(calls).toBe(1)
    }),
  )
}

it.effect("bounds a stuck integration refresh and allows a later attempt", () =>
  Effect.gen(function* () {
    const services = yield* locations
    const entered = yield* Deferred.make<void>()
    const integrationID = Integration.ID.make("openai")
    const methodID = Integration.MethodID.make("oauth")
    const stored = yield* services.credentials.create({
      integrationID,
      value: Credential.OAuth.make({ type: "oauth", methodID, access: "old", refresh: "refresh", expires: 1 }),
    })
    yield* services.a.transform((editor) =>
      editor.method.update({
        integrationID,
        method: { id: methodID, type: "oauth", label: "OAuth" },
        authorize: () => Effect.die("unused sign-in"),
        refresh: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
      }),
    )
    const connection = { type: "credential" as const, id: stored.id, label: stored.label, method: "oauth" as const }
    const first = yield* services.a.connection.resolve(connection).pipe(Effect.flip, Effect.forkScoped)
    yield* Deferred.await(entered)
    yield* TestClock.adjust("30 seconds")
    expect(yield* Fiber.join(first)).toBeInstanceOf(Integration.AuthorizationError)
    yield* services.a.transform((editor) =>
      editor.method.update({
        integrationID,
        method: { id: methodID, type: "oauth", label: "OAuth" },
        authorize: () => Effect.die("unused sign-in"),
        refresh: (value) =>
          Effect.succeed(Credential.OAuth.make({ ...value, access: "new", expires: Number.MAX_SAFE_INTEGER })),
      }),
    )
    expect(yield* services.a.connection.resolve(connection)).toMatchObject({ access: "new" })
  }),
)

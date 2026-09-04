import { expect } from "bun:test"
import { createECDH, randomBytes } from "node:crypto"
import { like } from "drizzle-orm"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { KVTable } from "@opencode-ai/core/kv/sql"
import { PushSubscription } from "@opencode-ai/protocol/groups/push"
import { Session } from "@opencode-ai/schema/session"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { Context, Effect, Layer, Queue, Schema } from "effect"
import { FetchHttpClient, HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createEmbeddedRoutes, createRoutes } from "../src/routes"

const boot = Effect.fnUntraced(function* (path: string, password?: string, embedded = false) {
  const sent = yield* Queue.dropping<string>(16)
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      Queue.offerUnsafe(sent, input instanceof Request ? input.url : String(input))
      return new Response(null, { status: 201 })
    },
    { preconnect: () => {} },
  )
  const context = yield* Layer.build(
    (embedded ? createEmbeddedRoutes : createRoutes)({
      password,
      database: { path },
      models: { fetch: false },
      fs: { filewatcher: false },
      config: { project: false },
    }).pipe(Layer.provide(HttpServer.layerServices)),
  ).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch))
  const handler = Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(context))
  const db = Context.get(context, Database.Service).db
  const bus = Context.get(context, Bus.Service)
  const request = (path: string, body?: unknown, credential = embedded ? undefined : password) =>
    Effect.promise(() =>
      handler(
        new Request(`https://opencode.local${path}`, {
          method: body === undefined ? "GET" : path === "/api/session" ? "POST" : "PUT",
          headers: {
            "content-type": "application/json",
            ...(credential ? { authorization: `Basic ${btoa(`opencode:${credential}`)}` } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      ),
    )
  return {
    request,
    sent,
    subscriptions: () => db.select().from(KVTable).where(like(KVTable.key, "web-push:v1:subscription:%")).all(),
    values: () => db.select().from(KVTable).where(like(KVTable.key, "web-push:v1:%")).all(),
    notify: Effect.gen(function* () {
      const response = yield* request("/api/session", { title: "Push authentication test" })
      expect(response.status).toBe(200)
      const session = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Session.ID }) }))(
        yield* Effect.promise(() => response.json()),
      )
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: session.data.id })
    }),
  }
})

function subscription(endpoint: string): PushSubscription {
  const key = createECDH("prime256v1")
  key.generateKeys()
  return {
    id: crypto.randomUUID(),
    endpoint,
    keys: { p256dh: key.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
    url: "https://app.opencode.ai/server/aGVsbG8/session/",
    notifications: { agent: true, errors: true },
    titles: { agent: "Ready", errors: "Error" },
  }
}

it.live("server password rotation revokes stored push subscriptions and permits fresh authenticated registration", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-push-auth-")
    const original = subscription("https://fcm.googleapis.com/old-browser")
    const replacement = subscription("https://web.push.apple.com/new-browser")
    const publicKey = yield* Effect.gen(function* () {
      const server = yield* boot(`${tmp.path}/push.db`, "original-password")
      expect((yield* server.request("/api/push/subscription", original)).status).toBe(204)
      const response = yield* server.request("/api/push")
      return Schema.decodeUnknownSync(Schema.Struct({ publicKey: Schema.String }))(
        yield* Effect.promise(() => response.json()),
      ).publicKey
    }).pipe(Effect.scoped)

    yield* Effect.gen(function* () {
      const server = yield* boot(`${tmp.path}/push.db`, "original-password")
      expect(yield* server.subscriptions()).toHaveLength(1)
      yield* server.notify
      expect(yield* Queue.take(server.sent)).toBe(original.endpoint)
    }).pipe(Effect.scoped)

    yield* Effect.gen(function* () {
      const server = yield* boot(`${tmp.path}/push.db`, "rotated-password")
      expect(yield* server.subscriptions()).toHaveLength(0)
      yield* server.notify
      expect(yield* Queue.size(server.sent)).toBe(0)
      expect((yield* server.request("/api/push/subscription", original, "original-password")).status).toBe(401)
      expect((yield* server.request("/api/push/subscription", replacement)).status).toBe(204)
      yield* server.notify
      expect(yield* Queue.take(server.sent)).toBe(replacement.endpoint)
      expect(yield* Queue.size(server.sent)).toBe(0)
      const response = yield* server.request("/api/push")
      expect(yield* Effect.promise(() => response.json())).toEqual({ publicKey })
      const persisted = JSON.stringify(yield* server.values())
      expect(persisted.includes("original-password")).toBe(false)
      expect(persisted.includes("rotated-password")).toBe(false)
    }).pipe(Effect.scoped)

    // Returning to the old password must not resurrect already-revoked records.
    yield* Effect.gen(function* () {
      const server = yield* boot(`${tmp.path}/push.db`, "original-password")
      expect(yield* server.subscriptions()).toHaveLength(0)
      yield* server.notify
      expect(yield* Queue.size(server.sent)).toBe(0)
    }).pipe(Effect.scoped)
  }),
)

it.live("auth enabled/disabled transitions revoke subscriptions while equivalent disabled modes preserve them", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-push-modes-")
    const device = subscription("https://fcm.googleapis.com/browser")
    for (const phase of [
      { password: undefined, retained: false },
      { password: "", retained: true },
      { password: "enabled", retained: false },
      { password: undefined, retained: false },
    ])
      yield* Effect.gen(function* () {
        const server = yield* boot(`${tmp.path}/push.db`, phase.password)
        expect((yield* server.subscriptions()).length).toBe(phase.retained ? 1 : 0)
        if (!phase.retained) {
          yield* server.notify
          expect(yield* Queue.size(server.sent)).toBe(0)
          expect((yield* server.request("/api/push/subscription", device)).status).toBe(204)
        }
        yield* server.notify
        expect(yield* Queue.take(server.sent)).toBe(device.endpoint)
      }).pipe(Effect.scoped)
  }),
)

it.live("embedded routes bind the actual no-password auth mode, not an ignored options.password", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-push-embedded-")
    const device = subscription("https://fcm.googleapis.com/embedded")
    yield* Effect.gen(function* () {
      const server = yield* boot(`${tmp.path}/push.db`, "ignored-one", true)
      expect((yield* server.request("/api/push/subscription", device)).status).toBe(204)
    }).pipe(Effect.scoped)
    yield* Effect.gen(function* () {
      const server = yield* boot(`${tmp.path}/push.db`, "ignored-two", true)
      expect(yield* server.subscriptions()).toHaveLength(1)
      yield* server.notify
      expect(yield* Queue.take(server.sent)).toBe(device.endpoint)
    }).pipe(Effect.scoped)
  }),
)

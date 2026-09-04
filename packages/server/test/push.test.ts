import { expect, test } from "bun:test"
import { createECDH, createPublicKey, randomBytes, verify, type ECDH } from "node:crypto"
import { createRequire } from "node:module"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { KV } from "@opencode-ai/core/kv"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { PushSubscription } from "@opencode-ai/protocol/groups/push"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Session } from "@opencode-ai/schema/session"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Deferred, Effect, Exit, Logger, Queue, Schema, Scope } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { TestClock } from "effect/testing"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { Push } from "../src/push"

// Use the same established RFC 8188 library as web-push to inspect real encrypted deliveries.
const ece: { decrypt: (body: Buffer, options: { version: string; privateKey: ECDH; authSecret: string }) => Buffer } =
  createRequire(import.meta.url)("http_ece")

const nodes = LayerNode.group([Bus.node, Database.node, KV.node, SessionStore.node])
const layer = LayerNode.compile(nodes)
const run = testEffect(layer)
const Payload = Schema.Struct({ title: Schema.String, body: Schema.String, url: Schema.String, tag: Schema.String })

function browser(overrides: Partial<PushSubscription> = {}) {
  const key = createECDH("prime256v1")
  key.generateKeys()
  const subscription: PushSubscription = {
    id: crypto.randomUUID(),
    endpoint: "https://fcm.googleapis.com/fcm/send/test-subscription",
    keys: { p256dh: key.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
    url: "https://app.opencode.ai/server/aHR0cHM6Ly9zZXJ2ZXIuZXhhbXBsZQ/session/",
    notifications: { agent: true, errors: true },
    titles: { agent: "Response ready", errors: "Session error" },
    ...overrides,
  }
  return {
    subscription,
    decrypt: (body: Uint8Array) =>
      Schema.decodeUnknownSync(Schema.fromJsonString(Payload))(
        ece
          .decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: key, authSecret: subscription.keys.auth })
          .toString(),
      ),
  }
}

const seed = Effect.fnUntraced(function* (parentID?: Session.ID) {
  const database = yield* Database.Service
  const id = Session.ID.create()
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
  yield* database.db
    .insert(SessionTable)
    .values({
      id,
      project_id: Project.ID.global,
      parent_id: parentID,
      directory: "/project",
      slug: "push-test",
      version: "test",
      title: "A private session title",
    })
    .run()
  return id
})

const transport = Effect.gen(function* () {
  const sent = yield* Queue.dropping<{ url: string; options: RequestInit; body: Uint8Array }>(500)
  const state = { status: 201, fail: false }
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: string | URL | Request, options?: RequestInit) => {
      if (!options || !(options.body instanceof Uint8Array)) throw new Error("Expected encrypted push body")
      Queue.offerUnsafe(sent, {
        url: input instanceof Request ? input.url : String(input),
        options,
        body: options.body,
      })
      if (state.fail) throw new Error("transport failure with a sensitive URL that must not be logged")
      return new Response(null, { status: state.status })
    },
    { preconnect: () => {} },
  )
  return { sent, state, fetch }
})

test("push endpoint allowlist rejects SSRF destinations and unsafe URL forms", () => {
  for (const value of [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns.notify.windows.com/abc",
  ])
    expect(Push.validEndpoint(value)).toBe(true)
  for (const value of [
    "https://example.com/send",
    "http://fcm.googleapis.com/send",
    "https://fcm.googleapis.com.evil.test/send",
    "https://evilpush.apple.com/send",
    "https://push.apple.com/send",
    "https://127.0.0.1/send",
    "https://169.254.169.254/send",
    "https://[::1]/send",
    "https://localhost/send",
    "https://user:secret@fcm.googleapis.com/send",
    "https://fcm.googleapis.com:8443/send",
    "https://fcm.googleapis.com/send#fragment",
    "https://fcm.googleapis.com/send#",
    " https://fcm.googleapis.com/send",
    "not a URL",
  ])
    expect(Push.validEndpoint(value)).toBe(false)
})

test("session URLs stay on secure app routes without credentials or query strings", () => {
  for (const origin of [
    "https://app.opencode.ai",
    "http://localhost:4444",
    "http://127.0.0.1:4444",
    "http://[::1]:4444",
  ])
    expect(Push.validSessionURL(`${origin}/server/aGVsbG8/session/`)).toBe(true)
  for (const value of [
    "http://app.example.com/server/key/session/",
    "https://user:pass@app.example.com/server/key/session/",
    "https://app.example.com/server/key/session/?secret=1",
    "https://app.example.com/server/key/session/#",
    "https://app.example.com/server/key/session/?",
    "https://app.example.com/session/",
    "https://app.example.com/server/key/session/ses_existing",
    "https://app.example.com/server/%2f/session/",
    "javascript:alert(1)",
  ])
    expect(Push.validSessionURL(value)).toBe(false)
})

test("wire schema bounds IDs, endpoints, keys, URLs, and notification titles", () => {
  const input = browser().subscription
  const valid = Schema.is(PushSubscription)
  expect(valid(input)).toBe(true)
  expect(valid({ ...input, id: "not-a-uuid" })).toBe(false)
  expect(valid({ ...input, endpoint: "x".repeat(2049) })).toBe(false)
  expect(valid({ ...input, url: "x".repeat(1025) })).toBe(false)
  expect(valid({ ...input, titles: { ...input.titles, agent: "x".repeat(101) } })).toBe(false)
  expect(valid({ ...input, keys: { ...input.keys, auth: "x".repeat(23) } })).toBe(false)
  expect(valid({ ...input, keys: { ...input.keys, p256dh: "invalid" } })).toBe(false)
})

run.effect("publishes encrypted, signed Web Push with no browser or SSE connection", () =>
  Effect.gen(function* () {
    const network = yield* transport
    const push = yield* Push.make.pipe(Effect.provideService(FetchHttpClient.Fetch, network.fetch))
    const device = browser()
    yield* push.subscribe(device.subscription)
    const sessionID = yield* seed()
    const bus = yield* Bus.Service
    const event = yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
    const sent = yield* Queue.take(network.sent)
    expect(device.decrypt(sent.body)).toEqual({
      title: "Response ready",
      body: "A private session title",
      url: device.subscription.url + sessionID,
      tag: event.id,
    })
    expect(Buffer.from(sent.body).includes(Buffer.from("A private session title"))).toBe(false)
    expect(sent.options.redirect).toBe("error")
    expect(sent.options.credentials).toBe("omit")
    const headers = new Headers(sent.options.headers)
    expect(headers.get("ttl")).toBe(String(Push.TTL))
    expect(headers.get("content-encoding")).toBe("aes128gcm")
    const authorization = headers.get("authorization")!
    const [, token, encoded] = /^vapid t=(.+), k=(.+)$/.exec(authorization)!
    const [header, payload, signature] = token.split(".")
    const point = Buffer.from(encoded, "base64url")
    const publicKey = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33).toString("base64url"),
      },
    })
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true)
    expect(encoded).toBe((yield* push.get).publicKey)
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({
      aud: "https://fcm.googleapis.com",
      sub: "https://opencode.ai",
    })
  }),
)

run.effect("ignores child completions, interruption, and disabled kinds; preserves error privacy", () =>
  Effect.gen(function* () {
    const network = yield* transport
    const push = yield* Push.make.pipe(Effect.provideService(FetchHttpClient.Fetch, network.fetch))
    const device = browser({ notifications: { agent: false, errors: true } })
    yield* push.subscribe(device.subscription)
    const parent = yield* seed()
    const child = yield* seed(parent)
    const bus = yield* Bus.Service
    yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: child })
    yield* bus.publish(SessionEvent.Execution.Failed, {
      sessionID: child,
      error: { type: "failure", message: "private details" },
    })
    yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID: parent, reason: "user" })
    yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: parent })
    const event = yield* bus.publish(SessionEvent.Execution.Failed, {
      sessionID: parent,
      error: { type: "failure", message: "private details" },
    })
    const sent = yield* Queue.take(network.sent)
    expect(device.decrypt(sent.body)).toEqual({
      title: "Session error",
      body: "A private session title",
      url: device.subscription.url + parent,
      tag: event.id,
    })
    expect(yield* Queue.size(network.sent)).toBe(0)
  }),
)

run.effect("upserts preferences, enforces the subscription cap, and removes idempotently", () =>
  Effect.gen(function* () {
    const push = yield* Push.make
    const input = browser().subscription
    yield* Effect.forEach(
      Array.from({ length: Push.SubscriptionLimit }, () => crypto.randomUUID()),
      (id) => push.subscribe({ ...input, id }),
    )
    expect(yield* push.subscribe(input).pipe(Effect.flip)).toMatchObject({ _tag: "InvalidRequestError" })
    const kv = yield* KV.Service
    const stored = yield* kv.scan({ prefix: "web-push:v1:subscription:" })
    const id = Schema.decodeUnknownSync(PushSubscription)(stored.entries[0].value).id
    yield* push.subscribe({ ...input, id, notifications: { agent: false, errors: false } })
    expect(yield* kv.get(`web-push:v1:subscription:${id}`)).toMatchObject({
      notifications: { agent: false, errors: false },
    })
    yield* push.unsubscribe(id)
    yield* push.unsubscribe(id)
    yield* push.subscribe(input)
  }),
)

run.effect("rejects invalid curve keys and URLs without storing a subscription", () =>
  Effect.gen(function* () {
    const push = yield* Push.make
    const input = browser().subscription
    for (const invalid of [
      { ...input, endpoint: "https://127.0.0.1/send" },
      { ...input, url: "https://example.com/unrelated" },
      { ...input, keys: { ...input.keys, p256dh: Buffer.alloc(65).toString("base64url") } },
    ])
      expect(yield* push.subscribe(invalid).pipe(Effect.flip)).toMatchObject({ _tag: "InvalidRequestError" })
    const kv = yield* KV.Service
    expect((yield* kv.scan({ prefix: "web-push:v1:subscription:" })).entries).toHaveLength(0)
  }),
)

run.effect("expired subscriptions are removed while sender failures stay isolated", () =>
  Effect.gen(function* () {
    const network = yield* transport
    const push = yield* Push.make.pipe(Effect.provideService(FetchHttpClient.Fetch, network.fetch))
    const stale = browser()
    const active = browser({ endpoint: "https://web.push.apple.com/active" })
    yield* push.subscribe(stale.subscription)
    yield* push.subscribe(active.subscription)
    const kv = yield* KV.Service
    const bus = yield* Bus.Service
    const sessionID = yield* seed()
    network.state.status = 410
    yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
    yield* Queue.take(network.sent)
    yield* Queue.take(network.sent)
    yield* Effect.gen(function* () {
      const records = yield* kv.scan({ prefix: "web-push:v1:subscription:" })
      if (records.entries.length) yield* Effect.fail("pending cleanup")
    }).pipe(Effect.retry({ times: 100 }))
    yield* push.subscribe(active.subscription)
    network.state.fail = true
    yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
    yield* Queue.take(network.sent)
    network.state.fail = false
    network.state.status = 201
    const event = yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
    const sent = yield* Queue.take(network.sent)
    expect(active.decrypt(sent.body).tag).toBe(event.id)
    expect(yield* kv.get(`web-push:v1:subscription:${active.subscription.id}`)).toBeDefined()
  }),
)

run.effect("a stalled provider times out without blocking publication or subsequent delivery", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const aborted = yield* Deferred.make<void>()
    const network = yield* transport
    let first = true
    const request: typeof globalThis.fetch = Object.assign(
      (input: string | URL | Request, options?: RequestInit) => {
        if (!first) return network.fetch(input, options)
        first = false
        Deferred.doneUnsafe(entered, Effect.void)
        return new Promise<Response>((_, reject) =>
          options?.signal?.addEventListener(
            "abort",
            () => {
              Deferred.doneUnsafe(aborted, Effect.void)
              reject(new Error("aborted"))
            },
            { once: true },
          ),
        )
      },
      { preconnect: () => {} },
    )
    const push = yield* Push.make.pipe(Effect.provideService(FetchHttpClient.Fetch, request))
    const device = browser()
    yield* push.subscribe(device.subscription)
    const bus = yield* Bus.Service
    const sessionID = yield* seed()
    yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
    yield* Deferred.await(entered)
    const next = yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
    yield* TestClock.adjust("11 seconds")
    yield* Deferred.await(aborted)
    expect(device.decrypt((yield* Queue.take(network.sent)).body).tag).toBe(next.id)
  }),
)

run.effect("bounds queued events and aborts delivery on shutdown", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const entered = yield* Deferred.make<void>()
    const aborted = yield* Deferred.make<void>()
    const messages: unknown[] = []
    const logger = Logger.make((entry) => messages.push(entry.message))
    const request: typeof globalThis.fetch = Object.assign(
      (_input: string | URL | Request, options?: RequestInit) => {
        Deferred.doneUnsafe(entered, Effect.void)
        return new Promise<Response>((_, reject) =>
          options?.signal?.addEventListener(
            "abort",
            () => {
              Deferred.doneUnsafe(aborted, Effect.void)
              reject(new Error("secret provider response"))
            },
            { once: true },
          ),
        )
      },
      { preconnect: () => {} },
    )
    yield* Effect.gen(function* () {
      const push = yield* Push.make.pipe(
        Effect.provideService(FetchHttpClient.Fetch, request),
        Effect.provideService(Scope.Scope, scope),
      )
      yield* push.subscribe(browser().subscription)
      const bus = yield* Bus.Service
      const sessionID = yield* seed()
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
      yield* Deferred.await(entered)
      yield* Effect.forEach(Array.from({ length: Push.QueueCapacity + 3 }), () =>
        bus.publish(SessionEvent.Execution.Succeeded, { sessionID }),
      )
      expect(messages).toHaveLength(3)
      expect(messages).toEqual(Array.from({ length: 3 }, () => ["Web Push queue full; notification dropped"]))
      yield* Scope.close(scope, Exit.void)
      yield* Deferred.await(aborted)
      // Publishing after teardown must not call the old listener or queue.
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
      expect(messages).toHaveLength(3)
    }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })))
  }),
)

test("VAPID keys and subscriptions survive server scope restart over the same database", async () => {
  await using tmp = await tmpdir("opencode-push-")
  const persistent = LayerNode.compile(nodes, {
    replacements: [Database.node.replace(Database.configured({ path: `${tmp.path}/push.db` }))],
  })
  const device = browser()
  const publicKey = await Effect.runPromise(
    Effect.gen(function* () {
      const push = yield* Push.make
      yield* push.subscribe(device.subscription)
      const keys = yield* Effect.all([push.get, push.get], { concurrency: 2 })
      expect(keys[0]).toEqual(keys[1])
      expect(Object.keys(keys[0])).toEqual(["publicKey"])
      return keys[0].publicKey
    }).pipe(Effect.scoped, Effect.provide(persistent)),
  )
  await Effect.runPromise(
    Effect.gen(function* () {
      const network = yield* transport
      const push = yield* Push.make.pipe(Effect.provideService(FetchHttpClient.Fetch, network.fetch))
      expect((yield* push.get).publicKey).toBe(publicKey)
      const bus = yield* Bus.Service
      const sessionID = yield* seed()
      const event = yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
      expect(device.decrypt((yield* Queue.take(network.sent)).body).tag).toBe(event.id)
    }).pipe(Effect.scoped, Effect.provide(persistent)),
  )
})

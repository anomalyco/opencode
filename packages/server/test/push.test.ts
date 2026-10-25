import { expect, test } from "bun:test"
import { createECDH, randomBytes } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { HttpServer } from "effect/http"
import { FetchHttpClient } from "effect/http"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AbsolutePath } from "@opencode/schema/schema"
import { Project } from "@opencode/schema/project"
import { SessionID } from "@opencode/schema/session-id"
import { SessionEvent } from "@opencode/schema/session-event"
import { Permission } from "@opencode/schema/permission"
import { Form } from "@opencode/schema/form"
import { PushSubscription } from "@opencode/protocol/groups/push"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { KV } from "@opencode/core/kv"
import { SessionStore } from "@opencode/core/session/store"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionTable } from "@opencode/core/session/sql"
import { Push } from "../src/push"
import { ServerProcess } from "../src/process"
import { generateVAPIDKeys } from "web-push"
import { decrypt } from "http_ece"

const projectID = Project.ID.make("prj_push_test")

function subscription(overrides: Partial<PushSubscription> = {}): PushSubscription {
  const keys = generateVAPIDKeys()
  return {
    id: "0f0e0d0c-0b0a-4908-8706-050403020100",
    endpoint: "https://fcm.googleapis.com/fcm/send/push-test",
    keys: { p256dh: keys.publicKey, auth: randomBytes(16).toString("base64url") },
    url: "https://example.com/server/a2V5/session/",
    preferences: { agent: true, permissions: true, questions: true, errors: true },
    titles: { agent: "Agent finished", permissions: "Approval needed", questions: "Input needed", errors: "Error" },
    ...overrides,
  }
}

test("accepts only supported push services and app session routes", () => {
  expect(Push.validEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true)
  expect(Push.validEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true)
  expect(Push.validEndpoint("https://web.push.apple.com/QGVsbG8")).toBe(true)
  expect(Push.validEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true)
  expect(Push.validEndpoint("http://fcm.googleapis.com/fcm/send/x")).toBe(false)
  expect(Push.validEndpoint("https://example.com/fcm/send/x")).toBe(false)
  expect(Push.validEndpoint("https://fcm.googleapis.com:8443/fcm/send/x")).toBe(false)
  expect(Push.validEndpoint("https://user:pass@fcm.googleapis.com/fcm/send/x")).toBe(false)

  expect(Push.validSessionURL("https://example.com/server/a2V5/session/")).toBe(true)
  expect(Push.validSessionURL("http://localhost:4096/server/a2V5/session/")).toBe(true)
  expect(Push.validSessionURL("http://192.168.1.2:4096/server/a2V5/session/")).toBe(false)
  expect(Push.validSessionURL("https://example.com/server/a2V5/session/ses_1")).toBe(false)
  expect(Push.validSessionURL("https://example.com/elsewhere/")).toBe(false)
  expect(Push.validSessionURL("https://example.com/server/a2V5/session/?next=x")).toBe(false)
})

test("sends encrypted notifications for top-level sessions and drops expired endpoints", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-push-"))
  const calls: { endpoint: string; body: Uint8Array; headers: Headers }[] = []
  let status = 201
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const endpoint = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const body = init?.body instanceof Uint8Array ? init.body : new Uint8Array()
    calls.push({ endpoint, body, headers: new Headers(init?.headers) })
    return new Response(null, { status })
  }

  const layer = LayerNode.compile(
    LayerNode.group([Global.node, Database.node, Bus.node, KV.node, SessionStore.node, Push.node]),
    {
      replacements: [
        Database.node.replace(Database.configured({ path: path.join(directory, "push.sqlite") })),
        Push.node.replace(Push.configured({ password: "secret" })),
      ],
    },
  ).pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, request as typeof fetch)))

  try {
    await Effect.gen(function* () {
      const push = yield* Push.Service
      const bus = yield* Bus.Service
      const db = (yield* Database.Service).db
      const id = SessionID.make("ses_push_test")

      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make(directory), sandboxes: [] })
        .run()
      yield* db
        .insert(SessionTable)
        .values({
          id,
          project_id: projectID,
          slug: "push-test",
          directory: AbsolutePath.make(directory),
          version: "test",
        })
        .run()

      const receiver = generateVAPIDKeys()
      const auth = randomBytes(16)
      const current = subscription({
        keys: { p256dh: receiver.publicKey, auth: auth.toString("base64url") },
      })
      yield* push.subscribe(current)
      const sessions = yield* SessionStore.Service
      expect(yield* sessions.get(id)).toBeDefined()
      yield* Effect.sleep("250 millis")

      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: id })
      yield* Effect.sleep("100 millis")
      expect(calls).toHaveLength(1)
      expect(calls[0].endpoint).toBe(current.endpoint)
      expect(calls[0].headers.get("content-encoding")).toBe("aes128gcm")
      expect(calls[0].headers.get("authorization")).toStartWith("vapid t=")
      expect(calls[0].body.byteLength).toBeGreaterThan(0)

      const ecdh = createECDH("prime256v1")
      ecdh.setPrivateKey(Buffer.from(receiver.privateKey, "base64url"))
      const decrypted = JSON.parse(
        decrypt(Buffer.from(calls[0].body), {
          version: "aes128gcm",
          privateKey: ecdh,
          authSecret: auth,
        }).toString(),
      )
      expect(decrypted).toEqual({
        title: "Agent finished",
        body: "",
        url: `${current.url}${id}`,
        tag: id,
        kind: "agent",
      })

      status = 410
      yield* bus.publish(SessionEvent.Execution.Failed, { sessionID: id, error: { type: "api", message: "test" } })
      yield* Effect.sleep("50 millis")
      expect(calls).toHaveLength(2)

      status = 201
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: id })
      yield* Effect.sleep("50 millis")
      expect(calls).toHaveLength(2)

      const child = SessionID.make("ses_push_child")
      yield* db
        .insert(SessionTable)
        .values({
          id: child,
          parent_id: id,
          project_id: projectID,
          slug: "push-child",
          directory: AbsolutePath.make(directory),
          version: "test",
        })
        .run()
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: child })
      yield* Effect.sleep("50 millis")
      expect(calls).toHaveLength(2)
    }).pipe(
      Effect.provide(layer),
      Effect.scoped,
      Effect.runPromise,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("ignores events a subscription opted out of and question forms for other purposes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-push-"))
  const calls: string[] = []
  const request = async (input: string | URL | Request) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    return new Response(null, { status: 201 })
  }
  const layer = LayerNode.compile(
    LayerNode.group([Global.node, Database.node, Bus.node, KV.node, SessionStore.node, Push.node]),
    {
      replacements: [
        Database.node.replace(Database.configured({ path: path.join(directory, "push.sqlite") })),
        Push.node.replace(Push.configured({ password: "secret" })),
      ],
    },
  ).pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, request as typeof fetch)))

  try {
    await Effect.gen(function* () {
      const push = yield* Push.Service
      const bus = yield* Bus.Service
      const db = (yield* Database.Service).db
      const id = SessionID.make("ses_push_filter")

      yield* db.insert(ProjectTable).values({ id: projectID, worktree: AbsolutePath.make(directory), sandboxes: [] }).run()
      yield* db
        .insert(SessionTable)
        .values({ id, project_id: projectID, slug: "push-filter", directory: AbsolutePath.make(directory), version: "test" })
        .run()

      yield* push.subscribe(
        subscription({
          preferences: { agent: false, permissions: false, questions: false, errors: false },
          titles: { agent: "Agent", permissions: "Permission", questions: "Question", errors: "Error" },
        }),
      )
      yield* Effect.sleep("250 millis")

      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: id })
      yield* bus.publish(Permission.Event.Asked, {
        id: Permission.ID.create(),
        sessionID: id,
        action: "bash",
        resources: ["*"],
      })
      yield* bus.publish(Form.Event.Created, {
        form: {
          id: Form.ID.create(),
          sessionID: id,
          title: "Questions",
          metadata: { kind: "websearch.provider" },
          fields: [{ key: "q0", type: "string" }],
        },
      })
      yield* Effect.sleep("1 second")
      expect(calls).toEqual([])

      yield* bus.publish(Form.Event.Created, {
        form: {
          id: Form.ID.create(),
          sessionID: id,
          title: "Questions",
          metadata: { kind: "question" },
          fields: [{ key: "q0", type: "string" }],
        },
      })
      yield* Effect.sleep("50 millis")
      expect(calls).toEqual([])
    }).pipe(
      Effect.provide(layer),
      Effect.scoped,
      Effect.runPromise,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("registers, authenticates, and removes a subscription over HTTP", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* ServerProcess.start<never, never>({
          hostname: "127.0.0.1",
          port: 0,
          password: "secret",
          database: { path: ":memory:" },
        })
        const base = HttpServer.formatAddress(server.address)
        const auth = { authorization: `Basic ${btoa("opencode:secret")}` }
        const current = subscription({ url: `${base}/server/a2V5/session/` })
        const request = (path: string, init?: RequestInit) =>
          Effect.promise(() => fetch(new URL(path, base), init))

        const unauthorized = yield* request("/api/push")
          expect(unauthorized.status).toBe(401)

          const key = yield* request("/api/push", { headers: auth })
          expect(key.status).toBe(200)
          expect(yield* Effect.promise(() => key.json())).toMatchObject({ publicKey: expect.any(String) })

          const origin = { ...auth, origin: base }
          const subscribed = yield* request("/api/push/subscription", {
            method: "PUT",
            headers: { ...origin, "content-type": "application/json" },
            body: JSON.stringify(current),
          })
          expect(subscribed.status).toBe(200)
          expect(yield* Effect.promise(() => subscribed.json())).toBe(current.id)

          const wrongOrigin = yield* request("/api/push/subscription", {
            method: "PUT",
            headers: { ...auth, origin: "https://evil.example", "content-type": "application/json" },
            body: JSON.stringify({ ...current, id: crypto.randomUUID() }),
          })
          expect(wrongOrigin.status).toBe(403)

          const unsupported = yield* request("/api/push/subscription", {
            method: "PUT",
            headers: { ...origin, "content-type": "application/json" },
            body: JSON.stringify({ ...current, id: crypto.randomUUID(), endpoint: "https://example.com/push" }),
          })
          expect(unsupported.status).toBe(400)

          const removed = yield* request(`/api/push/subscription/${current.id}`, {
            method: "DELETE",
            headers: origin,
          })
          expect(removed.status).toBe(204)
      }),
    ),
  )
})

test("revokes stored subscriptions when the server password changes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-push-"))
  const dbFile = path.join(directory, "push.sqlite")
  const calls: string[] = []
  const request = async (input: string | URL | Request) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    return new Response(null, { status: 201 })
  }

  const build = (password: string) =>
    LayerNode.compile(
      LayerNode.group([Global.node, Database.node, Bus.node, KV.node, SessionStore.node, Push.node]),
      {
        replacements: [
          Database.node.replace(Database.configured({ path: dbFile })),
          Push.node.replace(Push.configured({ password })),
        ],
      },
    ).pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, request as typeof fetch)))

  const phase = (
    password: string,
    run: (input: { push: Push.Interface; bus: Bus.Interface; id: SessionID }) => Effect.Effect<void, unknown>,
  ) =>
    Effect.gen(function* () {
      const push = yield* Push.Service
      const bus = yield* Bus.Service
      const db = (yield* Database.Service).db
      const id = SessionID.make("ses_push_rotate")
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make("/push-rotate"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
      yield* db
        .insert(SessionTable)
        .values({
          id,
          project_id: projectID,
          slug: "rotate",
          directory: AbsolutePath.make("/push-rotate"),
          version: "test",
        })
        .onConflictDoNothing()
        .run()
      yield* run({ push, bus, id })
    }).pipe(
      Effect.provide(build(password)),
      Effect.scoped,
      Effect.runPromise,
    )

  let publicKey = ""

  try {
    await phase("secret", ({ push, bus, id }) =>
      Effect.gen(function* () {
        publicKey = (yield* push.get).publicKey
        yield* push.subscribe(subscription())
        yield* Effect.sleep("250 millis")
        yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: id })
        yield* Effect.sleep("100 millis")
      }),
    )
    expect(calls).toHaveLength(1)

    await phase("changed", ({ push, bus, id }) =>
      Effect.gen(function* () {
        expect((yield* push.get).publicKey).toBe(publicKey)
        yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: id })
        yield* Effect.sleep("250 millis")
      }),
    )
    expect(calls).toHaveLength(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

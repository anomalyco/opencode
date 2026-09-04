import { expect } from "bun:test"
import { createECDH, randomBytes } from "node:crypto"
import { PushSubscription } from "@opencode-ai/protocol/groups/push"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const setup = Effect.gen(function* () {
  const handler = yield* ServerFetch.make({
    password: "test-secret",
    database: { path: ":memory:" },
    config: { project: false },
    fs: { filewatcher: false },
    models: { fetch: false },
  })
  const key = createECDH("prime256v1")
  key.generateKeys()
  const subscription: PushSubscription = {
    id: crypto.randomUUID(),
    endpoint: "https://web.push.apple.com/test",
    keys: { p256dh: key.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
    url: "https://app.opencode.ai/server/aGVsbG8/session/",
    notifications: { agent: true, errors: true },
    titles: { agent: "Response ready", errors: "Session error" },
  }
  const request = (path: string, init: RequestInit = {}, authenticated = true) =>
    Effect.promise(() =>
      handler(
        new Request(`http://opencode.local${path}`, {
          ...init,
          headers: {
            "content-type": "application/json",
            ...(authenticated ? { authorization: `Basic ${btoa("opencode:test-secret")}` } : {}),
            ...Object.fromEntries(new Headers(init.headers)),
          },
        }),
      ),
    )
  return { request, subscription }
})

it.live(
  "push routes require server authentication, expose only the public key, and return empty mutation responses",
  () =>
    Effect.gen(function* () {
      const { request, subscription } = yield* setup
      for (const [path, init] of [
        ["/api/push", {}],
        ["/api/push/subscription", { method: "PUT", body: JSON.stringify(subscription) }],
        [`/api/push/subscription/${subscription.id}`, { method: "DELETE" }],
      ] as const)
        expect((yield* request(path, init, false)).status).toBe(401)
      expect(
        (yield* request("/api/push", { headers: { authorization: `Basic ${btoa("opencode:wrong")}` } })).status,
      ).toBe(401)

      const response = yield* request("/api/push")
      expect(response.status).toBe(200)
      const value = yield* Effect.promise(() => response.json())
      expect(Object.keys(value)).toEqual(["publicKey"])
      expect(value.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/)
      const second = yield* request("/api/push")
      expect(yield* Effect.promise(() => second.json())).toEqual(value)

      for (const notifications of [
        { agent: true, errors: true },
        { agent: false, errors: false },
      ]) {
        const response = yield* request("/api/push/subscription", {
          method: "PUT",
          headers: { origin: "https://app.opencode.ai" },
          body: JSON.stringify({ ...subscription, notifications }),
        })
        expect(response.status).toBe(204)
        expect(yield* Effect.promise(() => response.text())).toBe("")
      }
      for (let index = 0; index < 2; index++)
        expect((yield* request(`/api/push/subscription/${subscription.id}`, { method: "DELETE" })).status).toBe(204)
    }),
)

it.live("push mutations reject untrusted browser origins even with valid server credentials", () =>
  Effect.gen(function* () {
    const { request, subscription } = yield* setup
    for (const [path, init] of [
      ["/api/push/subscription", { method: "PUT", body: JSON.stringify(subscription) }],
      [`/api/push/subscription/${subscription.id}`, { method: "DELETE" }],
    ] as const) {
      const response = yield* request(path, { ...init, headers: { origin: "https://untrusted.example" } })
      expect(response.status).toBe(403)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({ _tag: "ForbiddenError" })
    }
  }),
)

it.live("push routes validate IDs, lengths, destination URLs, and subscription keys", () =>
  Effect.gen(function* () {
    const { request, subscription } = yield* setup
    for (const invalid of [
      { ...subscription, id: "not-a-uuid" },
      { ...subscription, endpoint: "https://localhost/push" },
      { ...subscription, endpoint: `https://web.push.apple.com/${"x".repeat(2048)}` },
      { ...subscription, url: "https://app.opencode.ai/" },
      { ...subscription, keys: { p256dh: "invalid", auth: "invalid" } },
      { ...subscription, keys: { ...subscription.keys, p256dh: Buffer.alloc(65).toString("base64url") } },
    ]) {
      const response = yield* request("/api/push/subscription", { method: "PUT", body: JSON.stringify(invalid) })
      expect(response.status).toBe(400)
    }
    expect((yield* request("/api/push/subscription/not-a-uuid", { method: "DELETE" })).status).toBe(400)
    const spec = yield* request("/openapi.json")
    const document = yield* Effect.promise(() => spec.json())
    expect(Object.keys(document.paths)).toContain("/api/push")
    expect(Object.keys(document.paths)).toContain("/api/push/subscription")
    expect(Object.keys(document.paths)).toContain("/api/push/subscription/{id}")
  }),
)

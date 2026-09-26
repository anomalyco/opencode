import { beforeEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Logger, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"

import { AccessToken, AccountID, OrgID, RefreshToken } from "../../src/account/schema"
import { AccountRepo } from "../../src/account/repo"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Session } from "@/session/session"
import { MessageID } from "../../src/session/schema"
import type { SessionID } from "../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ShareNext, boundQueueMaps, rememberRemoval, reportRemovalEviction, trimQueue } from "@/share/share-next"
import { SessionShareTable } from "@opencode-ai/core/share/sql"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { provideTmpdirInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { pollWithTimeout, testEffect } from "../lib/effect"

const env = LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node]))
const it = testEffect(env)

const json = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const none = HttpClient.make(() => Effect.die("unexpected http call"))

function requestLayer(client: HttpClient.HttpClient) {
  const replacement = [httpClient, Layer.succeed(HttpClient.HttpClient, client)] as const
  return LayerNode.compile(LayerNode.group([ShareNext.node, AccountRepo.node]), [replacement])
}

function integrationLayer(client: HttpClient.HttpClient) {
  const replacement = [httpClient, Layer.succeed(HttpClient.HttpClient, client)] as const
  return LayerNode.compile(
    LayerNode.group([
      ShareNext.node,
      EventV2Bridge.node,
      Session.node,
      SessionProjector.node,
      AccountRepo.node,
      Database.node,
    ]),
    [replacement],
  )
}

const share = (id: SessionID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select()
      .from(SessionShareTable)
      .where(eq(SessionShareTable.session_id, id))
      .get()
      .pipe(Effect.orDie)
  })

const seed = (url: string, org?: string) =>
  AccountRepo.Service.use((repo) =>
    repo.persistAccount({
      id: AccountID.make("account-1"),
      email: "user@example.com",
      url,
      accessToken: AccessToken.make("st_test_token"),
      refreshToken: RefreshToken.make("rt_test_token"),
      expiry: Date.now() + 10 * 60_000,
      orgID: org ? Option.some(OrgID.make(org)) : Option.none(),
    }),
  )

beforeEach(async () => {
  await resetDatabase()
})

describe("ShareNext", () => {
  it.live("request uses legacy share API without active org account", () =>
    provideTmpdirInstance(
      () =>
        ShareNext.Service.use((svc) =>
          Effect.gen(function* () {
            const req = yield* svc.request()

            expect(req.api.create).toBe("/api/share")
            expect(req.api.sync("shr_123")).toBe("/api/share/shr_123/sync")
            expect(req.api.remove("shr_123")).toBe("/api/share/shr_123")
            expect(req.api.data("shr_123")).toBe("/api/share/shr_123/data")
            expect(req.baseUrl).toBe("https://legacy-share.example.com")
            expect(req.headers).toEqual({})
          }),
        ).pipe(Effect.provide(requestLayer(none))),
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("request uses default URL when no enterprise config", () =>
    provideTmpdirInstance(() =>
      ShareNext.Service.use((svc) =>
        Effect.gen(function* () {
          const req = yield* svc.request()

          expect(req.baseUrl).toBe("https://opncd.ai")
          expect(req.api.create).toBe("/api/share")
          expect(req.headers).toEqual({})
        }),
      ).pipe(Effect.provide(requestLayer(none))),
    ),
  )

  it.live("request uses org share API with auth headers when account is active", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        yield* seed("https://control.example.com", "org-1")

        const req = yield* ShareNext.use.request()

        expect(req.api.create).toBe("/api/shares")
        expect(req.api.sync("shr_123")).toBe("/api/shares/shr_123/sync")
        expect(req.api.remove("shr_123")).toBe("/api/shares/shr_123")
        expect(req.api.data("shr_123")).toBe("/api/shares/shr_123/data")
        expect(req.baseUrl).toBe("https://control.example.com")
        expect(req.headers).toEqual({
          authorization: "Bearer st_test_token",
          "x-org-id": "org-1",
        })
      }).pipe(Effect.provide(requestLayer(none))),
    ),
  )

  it.live("create posts share, persists it, and returns the result", () =>
    provideTmpdirInstance(
      () => {
        const createRequests: HttpClientRequest.HttpClientRequest[] = []
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/api/share")) {
            createRequests.push(req)
            return Effect.succeed(
              json(req, {
                id: "shr_abc",
                url: "https://legacy-share.example.com/share/abc",
                secret: "sec_123",
              }),
            )
          }
          return Effect.succeed(json(req, { ok: true }))
        })
        return Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "test" })

          const result = yield* (yield* ShareNext.Service).create(session.id)

          expect(result.id).toBe("shr_abc")
          expect(result.url).toBe("https://legacy-share.example.com/share/abc")
          expect(result.secret).toBe("sec_123")

          const row = yield* share(session.id)
          expect(row?.id).toBe("shr_abc")
          expect(row?.url).toBe("https://legacy-share.example.com/share/abc")
          expect(row?.secret).toBe("sec_123")

          expect(createRequests).toHaveLength(1)
          expect(createRequests[0].method).toBe("POST")
          expect(createRequests[0].url).toBe("https://legacy-share.example.com/api/share")
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("remove deletes the persisted share and calls the delete endpoint", () =>
    provideTmpdirInstance(
      () => {
        const seen: HttpClientRequest.HttpClientRequest[] = []
        const client = HttpClient.make((req) => {
          seen.push(req)
          if (req.method === "POST") {
            return Effect.succeed(
              json(req, {
                id: "shr_abc",
                url: "https://legacy-share.example.com/share/abc",
                secret: "sec_123",
              }),
            )
          }
          return Effect.succeed(HttpClientResponse.fromWeb(req, new Response(null, { status: 200 })))
        })
        return Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "test" })
          const service = yield* ShareNext.Service

          yield* service.create(session.id)
          yield* service.remove(session.id)

          expect(yield* share(session.id)).toBeUndefined()
          expect(seen.map((req) => [req.method, req.url])).toEqual([
            ["POST", "https://legacy-share.example.com/api/share"],
            ["DELETE", "https://legacy-share.example.com/api/share/shr_abc"],
          ])
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("create fails on a non-ok response and does not persist a share", () =>
    provideTmpdirInstance(() => {
      const client = HttpClient.make((req) => Effect.succeed(json(req, { error: "bad" }, 500)))
      return Effect.gen(function* () {
        const session = yield* (yield* Session.Service).create({ title: "test" })

        const exit = yield* ShareNext.Service.use((svc) => Effect.exit(svc.create(session.id)))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(yield* share(session.id)).toBeUndefined()
      }).pipe(Effect.provide(integrationLayer(client)))
    }),
  )

  it.live("ShareNext coalesces rapid diff events into one delayed sync with latest data", () =>
    provideTmpdirInstance(
      () => {
        const seen: Array<{ url: string; body: string }> = []
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/sync") && req.body._tag === "Uint8Array") {
            seen.push({ url: req.url, body: new TextDecoder().decode(req.body.body) })
          }
          return Effect.succeed(json(req, { ok: true }))
        })

        return Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          const share = yield* ShareNext.Service
          const session = yield* Session.Service

          const info = yield* session.create({ title: "first" })
          yield* share.init()
          yield* Effect.sleep(50)
          const { db } = yield* Database.Service
          yield* db
            .insert(SessionShareTable)
            .values({
              session_id: info.id,
              id: "shr_abc",
              url: "https://legacy-share.example.com/share/abc",
              secret: "sec_123",
            })
            .run()
            .pipe(Effect.orDie)

          yield* events.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [
              {
                file: "a.ts",
                patch:
                  "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,1 +1,1 @@\n-one\n\\ No newline at end of file\n+two\n\\ No newline at end of file\n",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          })
          yield* events.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [
              {
                file: "b.ts",
                patch:
                  "Index: b.ts\n===================================================================\n--- b.ts\t\n+++ b.ts\t\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
                additions: 2,
                deletions: 0,
                status: "modified",
              },
            ],
          })
          yield* pollWithTimeout(
            Effect.sync(() => (seen.length === 1 ? true : undefined)),
            "timed out waiting for share sync",
            "5 seconds",
          )

          expect(seen).toHaveLength(1)
          expect(seen[0].url).toBe("https://legacy-share.example.com/api/share/shr_abc/sync")

          const body = JSON.parse(seen[0].body) as {
            secret: string
            data: Array<{
              type: string
              data: Array<{
                file: string
                patch: string
                additions: number
                deletions: number
                status?: string
              }>
            }>
          }
          expect(body.secret).toBe("sec_123")
          expect(body.data).toHaveLength(1)
          expect(body.data[0].type).toBe("session_diff")
          expect(body.data[0].data).toEqual([
            {
              file: "b.ts",
              patch:
                "Index: b.ts\n===================================================================\n--- b.ts\t\n+++ b.ts\t\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
              additions: 2,
              deletions: 0,
              status: "modified",
            },
          ])
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("ShareNext forwards a dedicated turn diff event as a hydrated message", () =>
    provideTmpdirInstance(
      () => {
        const seen: string[] = []
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/sync") && req.body._tag === "Uint8Array") {
            seen.push(new TextDecoder().decode(req.body.body))
          }
          return Effect.succeed(json(req, { ok: true }))
        })

        return Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          const share = yield* ShareNext.Service
          const session = yield* Session.Service
          const info = yield* session.create({ title: "shared-diff" })
          yield* share.init()
          yield* Effect.sleep(50)
          const { db } = yield* Database.Service
          yield* db
            .insert(SessionShareTable)
            .values({
              session_id: info.id,
              id: "shr_diff",
              url: "https://legacy-share.example.com/share/diff",
              secret: "sec_diff",
            })
            .run()
            .pipe(Effect.orDie)

          const messageID = MessageID.ascending()
          yield* session.updateMessage({
            id: messageID,
            sessionID: info.id,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
          } satisfies SessionV1.User)
          yield* events.publish(Session.Event.MessageDiffUpdated, {
            sessionID: info.id,
            messageID,
            diffs: [{ file: "shared.ts", additions: 1, deletions: 0, status: "modified", patch: "SHARED-DIFF-PATCH" }],
          })
          yield* pollWithTimeout(
            Effect.sync(() => (seen.length >= 1 ? true : undefined)),
            "timed out waiting for share sync",
            "5 seconds",
          )

          expect(seen.join(" ")).toContain("SHARED-DIFF-PATCH")
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("remove clears the local share even when the DELETE fails", () =>
    provideTmpdirInstance(
      () => {
        const client = HttpClient.make((req) => {
          if (req.method === "POST") {
            return Effect.succeed(
              json(req, {
                id: "shr_abc",
                url: "https://legacy-share.example.com/share/abc",
                secret: "sec_123",
              }),
            )
          }
          return Effect.succeed(json(req, { error: "boom" }, 500))
        })
        return Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "test" })
          const service = yield* ShareNext.Service

          yield* service.create(session.id)
          yield* service.remove(session.id)

          expect(yield* share(session.id)).toBeUndefined()
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("create pages a large session into bounded sync payloads", () =>
    provideTmpdirInstance(
      () => {
        const syncBodies: string[] = []
        const client = HttpClient.make((req) => {
          if (req.method === "POST" && req.url.endsWith("/sync")) {
            if (req.body._tag === "Uint8Array") syncBodies.push(new TextDecoder().decode(req.body.body))
            return Effect.succeed(json(req, { ok: true }))
          }
          if (req.method === "POST") {
            return Effect.succeed(
              json(req, {
                id: "shr_big",
                url: "https://legacy-share.example.com/share/big",
                secret: "sec_big",
              }),
            )
          }
          return Effect.succeed(json(req, { ok: true }))
        })
        return Effect.gen(function* () {
          const sessions = yield* Session.Service
          const session = yield* sessions.create({ title: "big" })
          for (let index = 0; index < 60; index++) {
            yield* sessions.updateMessage({
              id: MessageID.ascending(),
              sessionID: session.id,
              role: "user",
              time: { created: Date.now() },
              agent: "build",
              model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
            } satisfies SessionV1.User)
          }

          yield* (yield* ShareNext.Service).create(session.id)
          yield* pollWithTimeout(
            Effect.sync(() => (syncBodies.length >= 2 ? true : undefined)),
            "timed out waiting for paged full sync",
            "10 seconds",
          )

          for (const body of syncBodies) {
            const parsed = JSON.parse(body) as { data: unknown[] }
            expect(parsed.data.length).toBeLessThanOrEqual(2000)
          }
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("ShareNext requeues a failed sync batch and retries it", () =>
    provideTmpdirInstance(
      () => {
        const bodies: string[] = []
        let status = 500
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/sync") && req.body._tag === "Uint8Array") {
            bodies.push(new TextDecoder().decode(req.body.body))
            const code = status
            status = 200
            return Effect.succeed(json(req, { ok: true }, code))
          }
          return Effect.succeed(json(req, { ok: true }))
        })

        return Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          const share = yield* ShareNext.Service
          const session = yield* Session.Service

          const info = yield* session.create({ title: "retry" })
          yield* share.init()
          yield* Effect.sleep(50)
          const { db } = yield* Database.Service
          yield* db
            .insert(SessionShareTable)
            .values({
              session_id: info.id,
              id: "shr_retry",
              url: "https://legacy-share.example.com/share/retry",
              secret: "sec_retry",
            })
            .run()
            .pipe(Effect.orDie)

          yield* events.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [{ file: "retry.ts", patch: "RETRY-PATCH", additions: 1, deletions: 0, status: "modified" }],
          })
          yield* pollWithTimeout(
            Effect.sync(() => (bodies.length >= 2 ? true : undefined)),
            "timed out waiting for share retry",
            "10 seconds",
          )

          expect(bodies).toHaveLength(2)
          expect(bodies[1]).toContain("RETRY-PATCH")
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("retries a failed remote unshare on a later sync from another session", () =>
    provideTmpdirInstance(
      () => {
        const deletes: string[] = []
        const client = HttpClient.make((req) => {
          if (req.method === "DELETE") {
            deletes.push(req.url)
            return Effect.succeed(json(req, { error: "boom" }, 500))
          }
          return Effect.succeed(json(req, { ok: true }))
        })
        return Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          const share = yield* ShareNext.Service
          const session = yield* Session.Service
          const first = yield* session.create({ title: "first" })
          const second = yield* session.create({ title: "second" })
          yield* share.init()
          yield* Effect.sleep(50)
          const { db } = yield* Database.Service
          yield* db
            .insert(SessionShareTable)
            .values([
              { session_id: first.id, id: "shr_first", url: "https://x/first", secret: "sec_first" },
              { session_id: second.id, id: "shr_second", url: "https://x/second", secret: "sec_second" },
            ])
            .run()
            .pipe(Effect.orDie)

          yield* share.remove(first.id)
          expect(deletes).toEqual(["https://legacy-share.example.com/api/share/shr_first"])

          yield* events.publish(Session.Event.Diff, {
            sessionID: second.id,
            diff: [{ file: "x.ts", patch: "P", additions: 1, deletions: 0, status: "modified" }],
          })
          yield* pollWithTimeout(
            Effect.sync(() => (deletes.length >= 2 ? true : undefined)),
            "timed out waiting for the remote unshare retry",
            "5 seconds",
          )

          expect(deletes).toEqual([
            "https://legacy-share.example.com/api/share/shr_first",
            "https://legacy-share.example.com/api/share/shr_first",
          ])
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )
})

describe("ShareNext.boundQueueMaps", () => {
  const id = (value: string) => value as SessionID
  const share = (value: string) => ({ id: value, url: value, secret: value })

  test("caps both maps even when every queued session is also shared", () => {
    const queue = new Map<SessionID, Map<string, { type: string }>>()
    const shared = new Map<SessionID, ReturnType<typeof share>>()
    for (let index = 0; index < 300; index++) {
      queue.set(id(`ses_${index}`), new Map([["session", { type: "session" }]]))
      shared.set(id(`ses_${index}`), share(`shr_${index}`))
    }

    const dropped = boundQueueMaps(
      queue,
      shared,
      { inflight: new Set<SessionID>(), scheduled: new Set<SessionID>(), removals: new Map() },
      10,
      10,
    )

    expect(dropped).toEqual({ queuedDropped: 290, sharedDropped: 290 })
    expect(queue.size).toBe(10)
    expect(shared.size).toBe(10)
    expect(queue.has(id("ses_299"))).toBe(true)
    expect(queue.has(id("ses_0"))).toBe(false)
    expect(shared.has(id("ses_299"))).toBe(true)
    expect(shared.has(id("ses_0"))).toBe(false)
  })

  test("skips sessions with in-flight work so a bound never tears down an active flush", () => {
    const queue = new Map<SessionID, Map<string, { type: string }>>()
    const shared = new Map<SessionID, ReturnType<typeof share>>()
    for (let index = 0; index < 20; index++) {
      queue.set(id(`ses_${index}`), new Map([["session", { type: "session" }]]))
      shared.set(id(`ses_${index}`), share(`shr_${index}`))
    }
    const scheduled = new Set([id("ses_0"), id("ses_1")])

    boundQueueMaps(queue, shared, { inflight: new Set(), scheduled, removals: new Map() }, 10, 10)

    expect(queue.size).toBe(10)
    expect(queue.has(id("ses_0"))).toBe(true)
    expect(queue.has(id("ses_1"))).toBe(true)
    expect(queue.has(id("ses_2"))).toBe(false)
  })
})

describe("ShareNext.rememberRemoval", () => {
  const id = (value: string) => value as SessionID
  const share = (value: string) => ({ id: value, url: value, secret: value })

  test("bounds the pending removals and reports the oldest evictions", () => {
    const removals = new Map<SessionID, ReturnType<typeof share>>()
    let evicted: SessionID[] = []
    for (let index = 0; index < 5; index++) {
      evicted = rememberRemoval(removals, id(`ses_${index}`), share(`shr_${index}`), 3)
    }

    expect([...removals.keys()].map(String)).toEqual(["ses_2", "ses_3", "ses_4"])
    expect(evicted.map(String)).toEqual(["ses_1"])
  })

  test("moves a re-remembered session to the newest position", () => {
    const removals = new Map<SessionID, ReturnType<typeof share>>()
    rememberRemoval(removals, id("ses_a"), share("shr_a"), 2)
    rememberRemoval(removals, id("ses_b"), share("shr_b"), 2)
    const evicted = rememberRemoval(removals, id("ses_a"), share("shr_a2"), 2)

    expect(evicted.map(String)).toEqual([])
    expect([...removals.keys()].map(String)).toEqual(["ses_b", "ses_a"])
  })

  test("warns with the dropped session names when the cap evicts", async () => {
    const messages: unknown[] = []
    await Effect.runPromise(
      reportRemovalEviction([id("ses_old")]).pipe(
        Effect.provide(
          Logger.layer([
            Logger.make<unknown, void>((options) => {
              messages.push(options.message)
            }),
          ]),
        ),
      ),
    )

    expect(messages).toEqual([
      ["share removal tombstones capped; oldest pending remote deletes dropped", { dropped: 1, sessionIDs: ["ses_old"] }],
    ])
  })

  test("stays silent when nothing is evicted", async () => {
    const messages: unknown[] = []
    await Effect.runPromise(
      reportRemovalEviction([]).pipe(
        Effect.provide(
          Logger.layer([
            Logger.make<unknown, void>((options) => {
              messages.push(options.message)
            }),
          ]),
        ),
      ),
    )

    expect(messages).toEqual([])
  })
})

describe("ShareNext.trimQueue", () => {
  test("caps the queue and drops the oldest part entries first", () => {
    const queue = new Map<string, { type: string }>()
    queue.set("session", { type: "session" })
    queue.set("session_diff", { type: "session_diff" })
    for (let index = 0; index < 2100; index++) queue.set(`part/message/p${index}`, { type: "part" })

    expect(trimQueue(queue)).toBe(102)
    expect(queue.size).toBe(2000)
    expect(queue.has("session")).toBe(true)
    expect(queue.has("session_diff")).toBe(true)
    expect(queue.has("part/message/p101")).toBe(false)
    expect(queue.has("part/message/p102")).toBe(true)
    expect(queue.has("part/message/p2099")).toBe(true)
  })

  test("leaves a queue at or below the cap untouched", () => {
    const queue = new Map<string, { type: string }>([["session", { type: "session" }]])
    expect(trimQueue(queue)).toBe(0)
    expect(queue.size).toBe(1)
  })

  test("drops the oldest message parts when full() inserts pages newest-first", () => {
    const queue = new Map<string, { type: string }>()
    queue.set("session", { type: "session" })
    // ShareNext.full() inserts the newest page first, so the oldest message ids land last.
    for (let message = 20; message >= 0; message--) {
      for (let part = 0; part < 100; part++) {
        queue.set(`part/msg_${String(message).padStart(4, "0")}/p${part}`, { type: "part" })
      }
    }

    expect(trimQueue(queue)).toBe(101)
    expect(queue.size).toBe(2000)
    expect(queue.has("session")).toBe(true)
    expect(queue.has("part/msg_0000/p0")).toBe(false)
    expect(queue.has("part/msg_0020/p99")).toBe(true)
  })
})

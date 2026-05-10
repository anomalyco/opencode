import { NodeFileSystem } from "@effect/platform-node"
import { beforeEach, describe, expect } from "bun:test"
import { Effect, Exit, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

import { AccessToken, AccountID, OrgID, RefreshToken } from "../../src/account/schema"
import { Account } from "../../src/account/account"
import { AccountRepo } from "../../src/account/repo"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import type { SessionID } from "../../src/session/schema"
import { ShareNext } from "@/share/share-next"
import { SessionShareTable } from "../../src/share/share.sql"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { provideTmpdirInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"

const env = Layer.mergeAll(
  Session.defaultLayer,
  AccountRepo.layer,
  NodeFileSystem.layer,
  CrossSpawnSpawner.defaultLayer,
)
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

function live(client: HttpClient.HttpClient) {
  const http = Layer.succeed(HttpClient.HttpClient, client)
  return ShareNext.layer.pipe(
    Layer.provide(Bus.layer),
    Layer.provide(Account.layer.pipe(Layer.provide(AccountRepo.layer), Layer.provide(http))),
    Layer.provide(Config.defaultLayer),
    Layer.provide(http),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Session.defaultLayer),
  )
}

function wired(client: HttpClient.HttpClient) {
  const http = Layer.succeed(HttpClient.HttpClient, client)
  return Layer.mergeAll(
    Bus.layer,
    ShareNext.layer,
    Session.defaultLayer,
    AccountRepo.layer,
    NodeFileSystem.layer,
    CrossSpawnSpawner.defaultLayer,
  ).pipe(
    Layer.provide(Bus.layer),
    Layer.provide(Account.layer.pipe(Layer.provide(AccountRepo.layer), Layer.provide(http))),
    Layer.provide(Config.defaultLayer),
    Layer.provide(http),
    Layer.provide(Provider.defaultLayer),
  )
}

const share = (id: SessionID) =>
  Database.use((db) => db.select().from(SessionShareTable).where(eq(SessionShareTable.session_id, id)).get())

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
        ).pipe(Effect.provide(live(none))),
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
      ).pipe(Effect.provide(live(none))),
    ),
  )

  it.live("request uses org share API with auth headers when account is active", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        yield* seed("https://control.example.com", "org-1")

        const req = yield* ShareNext.Service.use((svc) => svc.request()).pipe(Effect.provide(live(none)))

        expect(req.api.create).toBe("/api/shares")
        expect(req.api.sync("shr_123")).toBe("/api/shares/shr_123/sync")
        expect(req.api.remove("shr_123")).toBe("/api/shares/shr_123")
        expect(req.api.data("shr_123")).toBe("/api/shares/shr_123/data")
        expect(req.baseUrl).toBe("https://control.example.com")
        expect(req.headers).toEqual({
          authorization: "Bearer st_test_token",
          "x-org-id": "org-1",
        })
      }),
    ),
  )

  it.live("create posts share, persists it, and returns the result", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const session = yield* Session.Service.use((svc) => svc.create({ title: "test" }))
          const seen: HttpClientRequest.HttpClientRequest[] = []
          const client = HttpClient.make((req) => {
            seen.push(req)
            if (req.url.endsWith("/api/share")) {
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

          const result = yield* ShareNext.Service.use((svc) => svc.create(session.id)).pipe(
            Effect.provide(live(client)),
          )

          expect(result.id).toBe("shr_abc")
          expect(result.url).toBe("https://legacy-share.example.com/share/abc")
          expect(result.secret).toBe("sec_123")

          const row = share(session.id)
          expect(row?.id).toBe("shr_abc")
          expect(row?.url).toBe("https://legacy-share.example.com/share/abc")
          expect(row?.secret).toBe("sec_123")

          expect(seen).toHaveLength(1)
          expect(seen[0].method).toBe("POST")
          expect(seen[0].url).toBe("https://legacy-share.example.com/api/share")
        }),
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("remove deletes the persisted share and calls the delete endpoint", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const session = yield* Session.Service.use((svc) => svc.create({ title: "test" }))
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

          yield* Effect.gen(function* () {
            yield* ShareNext.Service.use((svc) => svc.create(session.id))
            yield* ShareNext.Service.use((svc) => svc.remove(session.id))
          }).pipe(Effect.provide(live(client)))

          expect(share(session.id)).toBeUndefined()
          expect(seen.map((req) => [req.method, req.url])).toEqual([
            ["POST", "https://legacy-share.example.com/api/share"],
            ["DELETE", "https://legacy-share.example.com/api/share/shr_abc"],
          ])
        }),
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("create fails on a non-ok response and does not persist a share", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const session = yield* Session.Service.use((svc) => svc.create({ title: "test" }))
        const client = HttpClient.make((req) => Effect.succeed(json(req, { error: "bad" }, 500)))

        const exit = yield* ShareNext.Service.use((svc) => Effect.exit(svc.create(session.id))).pipe(
          Effect.provide(live(client)),
        )

        expect(Exit.isFailure(exit)).toBe(true)
        expect(share(session.id)).toBeUndefined()
      }),
    ),
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
          const bus = yield* Bus.Service
          const share = yield* ShareNext.Service
          const session = yield* Session.Service

          const info = yield* session.create({ title: "first" })
          yield* share.init()
          yield* Effect.sleep(50)
          yield* Effect.sync(() =>
            Database.use((db) =>
              db
                .insert(SessionShareTable)
                .values({
                  session_id: info.id,
                  id: "shr_abc",
                  url: "https://legacy-share.example.com/share/abc",
                  secret: "sec_123",
                })
                .run(),
            ),
          )

          yield* bus.publish(Session.Event.Diff, {
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
          yield* bus.publish(Session.Event.Diff, {
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
          yield* Effect.sleep(1_250)

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
        }).pipe(Effect.provide(wired(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )
})

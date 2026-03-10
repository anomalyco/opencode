import { expect } from "bun:test"
import { Effect, Layer, Option, Ref, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

import { AccountRepo } from "../../src/account/repo"
import { AccountService } from "../../src/account/service"
import { AccountID, Login, Org, OrgID } from "../../src/account/schema"
import { Database } from "../../src/storage/db"
import { testEffect } from "../fixture/effect"

const truncate = Layer.effectDiscard(
  Effect.sync(() => {
    const db = Database.Client()
    db.run(/*sql*/ `DELETE FROM account_state`)
    db.run(/*sql*/ `DELETE FROM account`)
  }),
)

const it = testEffect(Layer.merge(AccountRepo.layer, truncate))

const live = (client: HttpClient.HttpClient) =>
  AccountService.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))

const json = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const encodeOrg = Schema.encodeSync(Org)

const org = (id: string, name: string) => encodeOrg(new Org({ id: OrgID.make(id), name }))

it.effect(
  "orgsByAccount groups orgs per account",
  Effect.gen(function* () {
    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id: AccountID.make("user-1"),
        email: "one@example.com",
        url: "https://one.example.com",
        accessToken: "at_1",
        refreshToken: "rt_1",
        expiry: Date.now() + 60_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id: AccountID.make("user-2"),
        email: "two@example.com",
        url: "https://two.example.com",
        accessToken: "at_2",
        refreshToken: "rt_2",
        expiry: Date.now() + 60_000,
        orgID: Option.none(),
      }),
    )

    const seen = yield* Ref.make<string[]>([])
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        yield* Ref.update(seen, (xs) => [...xs, `${req.method} ${req.url}`])

        if (req.url === "https://one.example.com/api/orgs") {
          return json(req, [org("org-1", "One")])
        }

        if (req.url === "https://two.example.com/api/orgs") {
          return json(req, [org("org-2", "Two A"), org("org-3", "Two B")])
        }

        return json(req, [], 404)
      }),
    )

    const rows = yield* AccountService.use((s) => s.orgsByAccount()).pipe(Effect.provide(live(client)))

    expect(rows.map((row) => [row.account.id, row.orgs.map((org) => org.id)]).map(([id, orgs]) => [id, orgs])).toEqual([
      [AccountID.make("user-1"), [OrgID.make("org-1")]],
      [AccountID.make("user-2"), [OrgID.make("org-2"), OrgID.make("org-3")]],
    ])
    expect(yield* Ref.get(seen)).toEqual([
      "GET https://one.example.com/api/orgs",
      "GET https://two.example.com/api/orgs",
    ])
  }),
)

it.effect(
  "token refresh persists the new token",
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id,
        email: "user@example.com",
        url: "https://one.example.com",
        accessToken: "at_old",
        refreshToken: "rt_old",
        expiry: Date.now() - 1_000,
        orgID: Option.none(),
      }),
    )

    const client = HttpClient.make((req) =>
      Effect.succeed(
        req.url === "https://one.example.com/oauth/token"
          ? json(req, {
              access_token: "at_new",
              refresh_token: "rt_new",
              expires_in: 60,
            })
          : json(req, {}, 404),
      ),
    )

    const token = yield* AccountService.use((s) => s.token(id)).pipe(Effect.provide(live(client)))

    expect(Option.getOrThrow(token)).toBeDefined()
    expect(String(Option.getOrThrow(token))).toBe("at_new")

    const row = yield* AccountRepo.use((r) => r.getRow(id))
    const value = Option.getOrThrow(row)
    expect(value.access_token).toBe("at_new")
    expect(value.refresh_token).toBe("rt_new")
    expect(value.token_expiry).toBeGreaterThan(Date.now())
  }),
)

it.effect(
  "config sends the selected org header",
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id,
        email: "user@example.com",
        url: "https://one.example.com",
        accessToken: "at_1",
        refreshToken: "rt_1",
        expiry: Date.now() + 60_000,
        orgID: Option.none(),
      }),
    )

    const seen = yield* Ref.make<{ auth?: string; org?: string }>({})
    const client = HttpClient.make((req) =>
      Effect.gen(function* () {
        yield* Ref.set(seen, {
          auth: req.headers.authorization,
          org: req.headers["x-org-id"],
        })

        if (req.url === "https://one.example.com/api/config") {
          return json(req, { config: { theme: "light", seats: 5 } })
        }

        return json(req, {}, 404)
      }),
    )

    const cfg = yield* AccountService.use((s) => s.config(id, OrgID.make("org-9"))).pipe(Effect.provide(live(client)))

    expect(Option.getOrThrow(cfg)).toEqual({ theme: "light", seats: 5 })
    expect(yield* Ref.get(seen)).toEqual({
      auth: "Bearer at_1",
      org: "org-9",
    })
  }),
)

it.effect(
  "poll stores the account and first org on success",
  Effect.gen(function* () {
    const login = new Login({
      code: "device-code",
      user: "user-code",
      url: "https://one.example.com/verify",
      server: "https://one.example.com",
      expiry: 600,
      interval: 5,
    })

    const client = HttpClient.make((req) =>
      Effect.succeed(
        req.url === "https://one.example.com/auth/device/token"
          ? json(req, {
              access_token: "at_1",
              refresh_token: "rt_1",
              expires_in: 60,
            })
          : req.url === "https://one.example.com/api/user"
            ? json(req, { id: "user-1", email: "user@example.com" })
            : req.url === "https://one.example.com/api/orgs"
              ? json(req, [org("org-1", "One")])
              : json(req, {}, 404),
      ),
    )

    const res = yield* AccountService.use((s) => s.poll(login)).pipe(Effect.provide(live(client)))

    expect(res._tag).toBe("PollSuccess")
    if (res._tag === "PollSuccess") {
      expect(res.email).toBe("user@example.com")
    }

    const active = yield* AccountRepo.use((r) => r.active())
    expect(Option.getOrThrow(active)).toEqual(
      expect.objectContaining({
        id: "user-1",
        email: "user@example.com",
        active_org_id: "org-1",
      }),
    )
  }),
)

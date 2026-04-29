import { expect } from "bun:test"
import { Effect, Layer, Option } from "effect"

import { AccountRepo } from "../../src/account/repo"
import { AccessToken, AccountID, OrgID, RefreshToken } from "../../src/account/schema"
import { Database } from "@/storage/db"
import { testEffect } from "../lib/effect"

const truncate = Layer.effectDiscard(
  Effect.sync(() => {
    const db = Database.Client()
    db.run(/*sql*/ `DELETE FROM account_state`)
    db.run(/*sql*/ `DELETE FROM account`)
  }),
)

const it = testEffect(Layer.merge(AccountRepo.layer, truncate))

it.live("list returns empty when no accounts exist", () =>
  Effect.gen(function* () {
    const accounts = yield* AccountRepo.Service.use((r) => r.list())
    expect(accounts).toEqual([])
  }),
)

it.live("active returns none when no accounts exist", () =>
  Effect.gen(function* () {
    const active = yield* AccountRepo.Service.use((r) => r.active())
    expect(Option.isNone(active)).toBe(true)
  }),
)

it.live("persistAccount inserts and getRow retrieves", () =>
  Effect.gen(function* () {
    const id = AccountID.make("user-1")
    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: AccessToken.make("at_123"),
        refreshToken: RefreshToken.make("rt_456"),
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    const row = yield* AccountRepo.Service.use((r) => r.getRow(id))
    expect(Option.isSome(row)).toBe(true)
    const value = Option.getOrThrow(row)
    expect(value.id).toBe(AccountID.make("user-1"))
    expect(value.email).toBe("test@example.com")

    const active = yield* AccountRepo.Service.use((r) => r.active())
    expect(Option.getOrThrow(active).active_org_id).toBe(OrgID.make("org-1"))
  }),
)

it.live("persistAccount normalizes trailing slashes in stored server URLs", () =>
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com/",
        accessToken: AccessToken.make("at_123"),
        refreshToken: RefreshToken.make("rt_456"),
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    const row = yield* AccountRepo.Service.use((r) => r.getRow(id))
    const active = yield* AccountRepo.Service.use((r) => r.active())
    const list = yield* AccountRepo.Service.use((r) => r.list())

    expect(Option.getOrThrow(row).url).toBe("https://control.example.com")
    expect(Option.getOrThrow(active).url).toBe("https://control.example.com")
    expect(list[0]?.url).toBe("https://control.example.com")
  }),
)

it.live("persistAccount sets the active account and org", () =>
  Effect.gen(function* () {
    const id1 = AccountID.make("user-1")
    const id2 = AccountID.make("user-2")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id: id1,
        email: "first@example.com",
        url: "https://control.example.com",
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id: id2,
        email: "second@example.com",
        url: "https://control.example.com",
        accessToken: AccessToken.make("at_2"),
        refreshToken: RefreshToken.make("rt_2"),
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-2")),
      }),
    )

    // Last persisted account is active with its org
    const active = yield* AccountRepo.Service.use((r) => r.active())
    expect(Option.isSome(active)).toBe(true)
    expect(Option.getOrThrow(active).id).toBe(AccountID.make("user-2"))
    expect(Option.getOrThrow(active).active_org_id).toBe(OrgID.make("org-2"))
  }),
)

it.live("list returns all accounts", () =>
  Effect.gen(function* () {
    const id1 = AccountID.make("user-1")
    const id2 = AccountID.make("user-2")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id: id1,
        email: "a@example.com",
        url: "https://control.example.com",
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id: id2,
        email: "b@example.com",
        url: "https://control.example.com",
        accessToken: AccessToken.make("at_2"),
        refreshToken: RefreshToken.make("rt_2"),
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    const accounts = yield* AccountRepo.Service.use((r) => r.list())
    expect(accounts.length).toBe(2)
    expect(accounts.map((a) => a.email).sort()).toEqual(["a@example.com", "b@example.com"])
  }),
)

it.live("remove deletes an account", () =>
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.Service.use((r) => r.remove(id))

    const row = yield* AccountRepo.Service.use((r) => r.getRow(id))
    expect(Option.isNone(row)).toBe(true)
  }),
)

it.live("use stores the selected org and marks the account active", () =>
  Effect.gen(function* () {
    const id1 = AccountID.make("user-1")
    const id2 = AccountID.make("user-2")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id: id1,
        email: "first@example.com",
        url: "https://control.example.com",
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id: id2,
        email: "second@example.com",
        url: "https://control.example.com",
        accessToken: AccessToken.make("at_2"),
        refreshToken: RefreshToken.make("rt_2"),
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.Service.use((r) => r.use(id1, Option.some(OrgID.make("org-99"))))
    const active1 = yield* AccountRepo.Service.use((r) => r.active())
    expect(Option.getOrThrow(active1).id).toBe(id1)
    expect(Option.getOrThrow(active1).active_org_id).toBe(OrgID.make("org-99"))

    yield* AccountRepo.Service.use((r) => r.use(id1, Option.none()))
    const active2 = yield* AccountRepo.Service.use((r) => r.active())
    expect(Option.getOrThrow(active2).active_org_id).toBeNull()
  }),
)

it.live("persistToken updates token fields", () =>
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: AccessToken.make("old_token"),
        refreshToken: RefreshToken.make("old_refresh"),
        expiry: 1000,
        orgID: Option.none(),
      }),
    )

    const expiry = Date.now() + 7200_000
    yield* AccountRepo.Service.use((r) =>
      r.persistToken({
        accountID: id,
        accessToken: AccessToken.make("new_token"),
        refreshToken: RefreshToken.make("new_refresh"),
        expiry: Option.some(expiry),
      }),
    )

    const row = yield* AccountRepo.Service.use((r) => r.getRow(id))
    const value = Option.getOrThrow(row)
    expect(value.access_token).toBe(AccessToken.make("new_token"))
    expect(value.refresh_token).toBe(RefreshToken.make("new_refresh"))
    expect(value.token_expiry).toBe(expiry)
  }),
)

it.live("persistToken with no expiry sets token_expiry to null", () =>
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: AccessToken.make("old_token"),
        refreshToken: RefreshToken.make("old_refresh"),
        expiry: 1000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistToken({
        accountID: id,
        accessToken: AccessToken.make("new_token"),
        refreshToken: RefreshToken.make("new_refresh"),
        expiry: Option.none(),
      }),
    )

    const row = yield* AccountRepo.Service.use((r) => r.getRow(id))
    expect(Option.getOrThrow(row).token_expiry).toBeNull()
  }),
)

it.live("persistAccount upserts on conflict", () =>
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: AccessToken.make("at_v1"),
        refreshToken: RefreshToken.make("rt_v1"),
        expiry: 1000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: AccessToken.make("at_v2"),
        refreshToken: RefreshToken.make("rt_v2"),
        expiry: 2000,
        orgID: Option.some(OrgID.make("org-2")),
      }),
    )

    const accounts = yield* AccountRepo.Service.use((r) => r.list())
    expect(accounts.length).toBe(1)

    const row = yield* AccountRepo.Service.use((r) => r.getRow(id))
    const value = Option.getOrThrow(row)
    expect(value.access_token).toBe(AccessToken.make("at_v2"))

    const active = yield* AccountRepo.Service.use((r) => r.active())
    expect(Option.getOrThrow(active).active_org_id).toBe(OrgID.make("org-2"))
  }),
)

it.live("remove clears active state when deleting the active account", () =>
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.Service.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: AccessToken.make("at_1"),
        refreshToken: RefreshToken.make("rt_1"),
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    yield* AccountRepo.Service.use((r) => r.remove(id))

    const active = yield* AccountRepo.Service.use((r) => r.active())
    expect(Option.isNone(active)).toBe(true)
  }),
)

it.live("getRow returns none for nonexistent account", () =>
  Effect.gen(function* () {
    const row = yield* AccountRepo.Service.use((r) => r.getRow(AccountID.make("nope")))
    expect(Option.isNone(row)).toBe(true)
  }),
)

import { expect } from "bun:test"
import { Effect, Layer, Option } from "effect"

import { AccountRepo } from "../../src/account/repo"
import { AccountID, OrgID } from "../../src/account/schema"
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

it.effect(
  "list returns empty when no accounts exist",
  Effect.gen(function* () {
    const accounts = yield* AccountRepo.use((r) => r.list())
    expect(accounts).toEqual([])
  }),
)

it.effect(
  "active returns none when no accounts exist",
  Effect.gen(function* () {
    const active = yield* AccountRepo.use((r) => r.active())
    expect(Option.isNone(active)).toBe(true)
  }),
)

it.effect(
  "persistAccount inserts and getRow retrieves",
  Effect.gen(function* () {
    const id = AccountID.make("user-1")
    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: "at_123",
        refreshToken: "rt_456",
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    const row = yield* AccountRepo.use((r) => r.getRow(id))
    expect(Option.isSome(row)).toBe(true)
    const value = Option.getOrThrow(row)
    expect(value.id).toBe("user-1")
    expect(value.email).toBe("test@example.com")

    const active = yield* AccountRepo.use((r) => r.active())
    expect(Option.getOrThrow(active).active_org_id).toBe(OrgID.make("org-1"))
  }),
)

it.effect(
  "persistAccount sets the active account and org",
  Effect.gen(function* () {
    const id1 = AccountID.make("user-1")
    const id2 = AccountID.make("user-2")

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id: id1,
        email: "first@example.com",
        url: "https://control.example.com",
        accessToken: "at_1",
        refreshToken: "rt_1",
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id: id2,
        email: "second@example.com",
        url: "https://control.example.com",
        accessToken: "at_2",
        refreshToken: "rt_2",
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-2")),
      }),
    )

    // Last persisted account is active with its org
    const active = yield* AccountRepo.use((r) => r.active())
    expect(Option.isSome(active)).toBe(true)
    expect(Option.getOrThrow(active).id).toBe(AccountID.make("user-2"))
    expect(Option.getOrThrow(active).active_org_id).toBe(OrgID.make("org-2"))
  }),
)

it.effect(
  "list returns all accounts",
  Effect.gen(function* () {
    const id1 = AccountID.make("user-1")
    const id2 = AccountID.make("user-2")

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id: id1,
        email: "a@example.com",
        url: "https://control.example.com",
        accessToken: "at_1",
        refreshToken: "rt_1",
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id: id2,
        email: "b@example.com",
        url: "https://control.example.com",
        accessToken: "at_2",
        refreshToken: "rt_2",
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    const accounts = yield* AccountRepo.use((r) => r.list())
    expect(accounts.length).toBe(2)
    expect(accounts.map((a) => a.email).sort()).toEqual(["a@example.com", "b@example.com"])
  }),
)

it.effect(
  "remove deletes an account",
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: "at_1",
        refreshToken: "rt_1",
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.use((r) => r.remove(id))

    const row = yield* AccountRepo.use((r) => r.getRow(id))
    expect(Option.isNone(row)).toBe(true)
  }),
)

it.effect(
  "use stores the selected org and marks the account active",
  Effect.gen(function* () {
    const id1 = AccountID.make("user-1")
    const id2 = AccountID.make("user-2")

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id: id1,
        email: "first@example.com",
        url: "https://control.example.com",
        accessToken: "at_1",
        refreshToken: "rt_1",
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id: id2,
        email: "second@example.com",
        url: "https://control.example.com",
        accessToken: "at_2",
        refreshToken: "rt_2",
        expiry: Date.now() + 3600_000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.use((r) => r.use(id1, Option.some(OrgID.make("org-99"))))
    const active1 = yield* AccountRepo.use((r) => r.active())
    expect(Option.getOrThrow(active1).id).toBe(id1)
    expect(Option.getOrThrow(active1).active_org_id).toBe(OrgID.make("org-99"))

    yield* AccountRepo.use((r) => r.use(id1, Option.none()))
    const active2 = yield* AccountRepo.use((r) => r.active())
    expect(Option.getOrThrow(active2).active_org_id).toBeNull()
  }),
)

it.effect(
  "persistToken updates token fields",
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: "old_token",
        refreshToken: "old_refresh",
        expiry: 1000,
        orgID: Option.none(),
      }),
    )

    const expiry = Date.now() + 7200_000
    yield* AccountRepo.use((r) =>
      r.persistToken({
        accountID: id,
        accessToken: "new_token",
        refreshToken: "new_refresh",
        expiry: Option.some(expiry),
      }),
    )

    const row = yield* AccountRepo.use((r) => r.getRow(id))
    const value = Option.getOrThrow(row)
    expect(value.access_token).toBe("new_token")
    expect(value.refresh_token).toBe("new_refresh")
    expect(value.token_expiry).toBe(expiry)
  }),
)

it.effect(
  "persistToken with no expiry sets token_expiry to null",
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: "old_token",
        refreshToken: "old_refresh",
        expiry: 1000,
        orgID: Option.none(),
      }),
    )

    yield* AccountRepo.use((r) =>
      r.persistToken({
        accountID: id,
        accessToken: "new_token",
        refreshToken: "new_refresh",
        expiry: Option.none(),
      }),
    )

    const row = yield* AccountRepo.use((r) => r.getRow(id))
    expect(Option.getOrThrow(row).token_expiry).toBeNull()
  }),
)

it.effect(
  "persistAccount upserts on conflict",
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: "at_v1",
        refreshToken: "rt_v1",
        expiry: 1000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: "at_v2",
        refreshToken: "rt_v2",
        expiry: 2000,
        orgID: Option.some(OrgID.make("org-2")),
      }),
    )

    const accounts = yield* AccountRepo.use((r) => r.list())
    expect(accounts.length).toBe(1)

    const row = yield* AccountRepo.use((r) => r.getRow(id))
    const value = Option.getOrThrow(row)
    expect(value.access_token).toBe("at_v2")

    const active = yield* AccountRepo.use((r) => r.active())
    expect(Option.getOrThrow(active).active_org_id).toBe(OrgID.make("org-2"))
  }),
)

it.effect(
  "remove clears active state when deleting the active account",
  Effect.gen(function* () {
    const id = AccountID.make("user-1")

    yield* AccountRepo.use((r) =>
      r.persistAccount({
        id,
        email: "test@example.com",
        url: "https://control.example.com",
        accessToken: "at_1",
        refreshToken: "rt_1",
        expiry: Date.now() + 3600_000,
        orgID: Option.some(OrgID.make("org-1")),
      }),
    )

    yield* AccountRepo.use((r) => r.remove(id))

    const active = yield* AccountRepo.use((r) => r.active())
    expect(Option.isNone(active)).toBe(true)
  }),
)

it.effect(
  "getRow returns none for nonexistent account",
  Effect.gen(function* () {
    const row = yield* AccountRepo.use((r) => r.getRow(AccountID.make("nope")))
    expect(Option.isNone(row)).toBe(true)
  }),
)

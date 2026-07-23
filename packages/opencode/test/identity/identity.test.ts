import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Auth } from "../../src/auth"
import { Identity } from "../../src/identity"
import { testEffect } from "../lib/effect"

// Mock Auth that returns undefined (no microsoft auth set).
const mockAuth = Layer.mock(Auth.Service)({
  all: () => Effect.succeed({}),
  get: () => Effect.succeed(undefined),
})

// Provide database + mock auth as dependencies for the identity layer.
const providerLayer = Layer.mergeAll(Database.layerFromPath(":memory:"), mockAuth)
const testLayer = Identity.layer.pipe(Layer.provide(providerLayer))

const it = testEffect(testLayer)

describe("Identity.Service", () => {
  it.live("first user upsertFromAuth creates admin user with token_balance", () =>
    Effect.gen(function* () {
      const identity = yield* Identity.Service
      process.env["OPENCODE_TOKEN_MGMT"] = "1"

      yield* identity.upsertFromAuth({
        id: "user-1",
        email: "alice@contoso.com",
        displayName: "Alice Smith",
        tenantId: "tenant-1",
      })

      const user = yield* identity.getByID("user-1")
      expect(user).not.toBeNull()
      expect(user!.email).toBe("alice@contoso.com")
      expect(user!.displayName).toBe("Alice Smith")
      expect(user!.tenantId).toBe("tenant-1")
      expect(user!.isAdmin).toBe(true)
    }),
  )

  it.live("second user upsertFromAuth is NOT admin", () =>
    Effect.gen(function* () {
      const identity = yield* Identity.Service
      process.env["OPENCODE_TOKEN_MGMT"] = "1"

      yield* identity.upsertFromAuth({ id: "admin-1", email: "admin@contoso.com" })
      yield* identity.upsertFromAuth({ id: "user-2", email: "bob@contoso.com" })

      const admin = yield* identity.getByID("admin-1")
      const user = yield* identity.getByID("user-2")
      expect(admin!.isAdmin).toBe(true)
      expect(user!.isAdmin).toBe(false)
    }),
  )

  it.live("getByID returns null for missing user", () =>
    Effect.gen(function* () {
      const identity = yield* Identity.Service
      const user = yield* identity.getByID("nonexistent")
      expect(user).toBeNull()
    }),
  )

  it.live("upsertFromAuth updates existing user fields on conflict", () =>
    Effect.gen(function* () {
      const identity = yield* Identity.Service
      process.env["OPENCODE_TOKEN_MGMT"] = "1"

      yield* identity.upsertFromAuth({
        id: "user-1",
        email: "old@contoso.com",
        displayName: "Old Name",
      })

      yield* identity.upsertFromAuth({
        id: "user-1",
        email: "new@contoso.com",
        displayName: "New Name",
      })

      const user = yield* identity.getByID("user-1")
      expect(user!.email).toBe("new@contoso.com")
      expect(user!.displayName).toBe("New Name")
    }),
  )

  it.live("listUsersWithBalances returns empty array when no users exist", () =>
    Effect.gen(function* () {
      const identity = yield* Identity.Service
      const users = yield* identity.listUsersWithBalances()
      expect(users).toEqual([])
    }),
  )

  it.live("listUsersWithBalances returns users with allowance after upsert", () =>
    Effect.gen(function* () {
      const identity = yield* Identity.Service
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      process.env["OPENCODE_MONTHLY_ALLOWANCE"] = "50000"

      yield* identity.upsertFromAuth({ id: "user-1", email: "alice@contoso.com" })

      const users = yield* identity.listUsersWithBalances()
      expect(users).toHaveLength(1)
      expect(users[0].id).toBe("user-1")
      expect(users[0].balance).toBe(50000) // Monthly allowance credited
      expect(users[0].lifetimeUsed).toBe(0)
      expect(users[0].isAdmin).toBe(true) // first user = admin
    }),
  )

  it.live("credit updates balance and returns transaction info", () =>
    Effect.gen(function* () {
      const identity = yield* Identity.Service
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      process.env["OPENCODE_MONTHLY_ALLOWANCE"] = "50000"

      // First upsert the user so tables exist.
      yield* identity.upsertFromAuth({ id: "user-1", email: "alice@contoso.com" })

      const result = yield* identity.credit({ userId: "user-1", amount: 100, description: "test credit" })
      expect(result.newBalance).toBe(50100) // 50000 allowance + 100 credit
      expect(result.transactionId).toBeGreaterThan(0)
    }),
  )

  it.live("upsertFromAuth is gated off when OPENCODE_TOKEN_MGMT is not set", () =>
    Effect.gen(function* () {
      const identity = yield* Identity.Service
      delete process.env["OPENCODE_TOKEN_MGMT"]

      yield* identity.upsertFromAuth({ id: "user-1", email: "alice@contoso.com" })
      const user = yield* identity.getByID("user-1")
      expect(user).toBeNull()
    }),
  )
})

describe("Identity auto-recharge", () => {
  it.live("credits monthly allowance on first upsertFromAuth call", () =>
    Effect.gen(function* () {
      const identity = yield* Identity.Service
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      process.env["OPENCODE_MONTHLY_ALLOWANCE"] = "50000"

      yield* identity.upsertFromAuth({
        id: "user-1",
        email: "alice@contoso.com",
      })

      // Verify allowance via listUsersWithBalances
      const users = yield* identity.listUsersWithBalances()
      const user = users.find((u) => u.id === "user-1")
      expect(user).not.toBeUndefined()
      expect(user!.balance).toBe(50000)
    }),
  )

  it.live("does NOT double-credit when upsertFromAuth called again same month", () =>
    Effect.gen(function* () {
      const identity = yield* Identity.Service
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      process.env["OPENCODE_MONTHLY_ALLOWANCE"] = "50000"

      yield* identity.upsertFromAuth({ id: "user-1", email: "alice@contoso.com" })
      yield* identity.upsertFromAuth({ id: "user-1", email: "alice@contoso.com" })

      const users = yield* identity.listUsersWithBalances()
      const user = users.find((u) => u.id === "user-1")
      expect(user!.balance).toBe(50000) // Only one allowance
    }),
  )

  it.live("credits allowance with custom OPENCODE_MONTHLY_ALLOWANCE", () =>
    Effect.gen(function* () {
      const identity = yield* Identity.Service
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      process.env["OPENCODE_MONTHLY_ALLOWANCE"] = "1000"

      yield* identity.upsertFromAuth({ id: "user-2", email: "bob@contoso.com" })

      const users = yield* identity.listUsersWithBalances()
      const user = users.find((u) => u.id === "user-2")
      expect(user!.balance).toBe(1000)
    }),
  )

  it.live("does not credit allowance when OPENCODE_TOKEN_MGMT is unset", () =>
    Effect.gen(function* () {
      const identity = yield* Identity.Service
      delete process.env["OPENCODE_TOKEN_MGMT"]

      yield* identity.upsertFromAuth({ id: "user-3", email: "carol@contoso.com" })

      const users = yield* identity.listUsersWithBalances()
      const user = users.find((u) => u.id === "user-3")
      // When gated, upsertFromAuth skips everything, so no user row exists.
      expect(user).toBeUndefined()
    }),
  )
})

import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Auth, Oauth } from "../../src/auth"
import { testEffect } from "../lib/effect"

const decodeOauth = Schema.decodeUnknownSync(Oauth)
const encodeOauth = Schema.encodeUnknownSync(Oauth)

const it = testEffect(Layer.mergeAll(Auth.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("Oauth schema widening", () => {
  test("decodes legacy payload without identity fields", () => {
    const legacy = {
      type: "oauth" as const,
      refresh: "refresh-token",
      access: "access-token",
      expires: 1234567890,
      accountId: "user-guid",
      enterpriseUrl: "https://example.com",
    }

    const decoded = decodeOauth(legacy)
    expect(decoded.type).toBe("oauth")
    expect(decoded.refresh).toBe("refresh-token")
    expect(decoded.access).toBe("access-token")
    expect(decoded.expires).toBe(1234567890)
    expect(decoded.accountId).toBe("user-guid")
    expect(decoded.enterpriseUrl).toBe("https://example.com")
    expect(decoded.email).toBeUndefined()
    expect(decoded.displayName).toBeUndefined()
    expect(decoded.tenantId).toBeUndefined()
  })

  test("decodes widened payload with all identity fields", () => {
    const widened = {
      type: "oauth" as const,
      refresh: "refresh-token",
      access: "access-token",
      expires: 1234567890,
      accountId: "user-guid",
      email: "alice@contoso.com",
      displayName: "Alice Smith",
      tenantId: "tenant-1",
    }

    const decoded = decodeOauth(widened)
    expect(decoded.email).toBe("alice@contoso.com")
    expect(decoded.displayName).toBe("Alice Smith")
    expect(decoded.tenantId).toBe("tenant-1")
  })

  test("decodes partial identity fields", () => {
    const partial = {
      type: "oauth" as const,
      refresh: "r",
      access: "a",
      expires: 1,
      email: "bob@contoso.com",
    }

    const decoded = decodeOauth(partial)
    expect(decoded.email).toBe("bob@contoso.com")
    expect(decoded.displayName).toBeUndefined()
    expect(decoded.tenantId).toBeUndefined()
  })

  test("encodes identity fields when present", () => {
    const encoded = encodeOauth(
      new Oauth({
        type: "oauth",
        refresh: "r",
        access: "a",
        expires: 1,
        email: "alice@contoso.com",
        displayName: "Alice",
        tenantId: "t1",
      }),
    )

    expect(encoded).toMatchObject({
      type: "oauth",
      email: "alice@contoso.com",
      displayName: "Alice",
      tenantId: "t1",
    })
  })

  test("omits identity fields when undefined on encode", () => {
    const encoded = encodeOauth(
      new Oauth({
        type: "oauth",
        refresh: "r",
        access: "a",
        expires: 1,
      }),
    )

    expect(encoded).not.toHaveProperty("email")
    expect(encoded).not.toHaveProperty("displayName")
    expect(encoded).not.toHaveProperty("tenantId")
  })

  it.instance("Auth.set / Auth.get round-trips widened Oauth with identity fields", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("microsoft", {
        type: "oauth",
        refresh: "r",
        access: "a",
        expires: 1,
        accountId: "user-guid",
        email: "alice@contoso.com",
        displayName: "Alice Smith",
        tenantId: "tenant-1",
      })

      const got = yield* auth.get("microsoft")
      expect(got?.type).toBe("oauth")
      if (got?.type !== "oauth") throw new Error("expected oauth")
      expect(got.email).toBe("alice@contoso.com")
      expect(got.displayName).toBe("Alice Smith")
      expect(got.tenantId).toBe("tenant-1")
    }),
  )

  it.instance("Auth.set / Auth.get round-trips a legacy Oauth without identity fields", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("microsoft", {
        type: "oauth",
        refresh: "r",
        access: "a",
        expires: 1,
        accountId: "user-guid",
      })

      const got = yield* auth.get("microsoft")
      expect(got?.type).toBe("oauth")
      if (got?.type !== "oauth") throw new Error("expected oauth")
      expect(got.email).toBeUndefined()
      expect(got.displayName).toBeUndefined()
      expect(got.tenantId).toBeUndefined()
    }),
  )
})

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  PaidPlanRequiredError,
  PLAN_PRICE_USD_MONTH,
  capabilities,
  requireFeature,
  resolvePlan,
  verifyJwt,
} from "../../src/billing/gate"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("billing.gate.capabilities", () => {
  it("free → manual sprint only", () => {
    const c = capabilities("free")
    expect(c.remoteModels).toBe(false)
    expect(c.unlimitedTokens).toBe(false)
    expect(c.autoSprintWatcher).toBe(false)
    expect(c.manualSprintRun).toBe(true)
  })

  it("plus → tokens + remote models, no auto-sprints", () => {
    const c = capabilities("plus")
    expect(c.remoteModels).toBe(true)
    expect(c.unlimitedTokens).toBe(true)
    expect(c.autoSprintWatcher).toBe(false)
    expect(c.manualSprintRun).toBe(true)
  })

  it("pro → everything", () => {
    const c = capabilities("pro")
    expect(c.remoteModels).toBe(true)
    expect(c.unlimitedTokens).toBe(true)
    expect(c.autoSprintWatcher).toBe(true)
    expect(c.manualSprintRun).toBe(true)
  })
})

describe("billing.gate price table", () => {
  it("matches the public pricing", () => {
    expect(PLAN_PRICE_USD_MONTH).toEqual({ free: 0, plus: 20, pro: 50 })
  })
})

describe("billing.gate.requireFeature", () => {
  it("free user blocked on unlimitedTokens → asks for plus", () => {
    try {
      requireFeature("free", "unlimitedTokens")
      throw new Error("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(PaidPlanRequiredError)
      expect((e as PaidPlanRequiredError).minPlan).toBe("plus")
      expect((e as Error).message).toContain("Plus (US$20/mo)")
    }
  })

  it("plus user blocked on autoSprintWatcher → asks for pro", () => {
    try {
      requireFeature("plus", "autoSprintWatcher")
      throw new Error("should have thrown")
    } catch (e) {
      expect((e as PaidPlanRequiredError).minPlan).toBe("pro")
      expect((e as Error).message).toContain("Pro (US$50/mo)")
    }
  })

  it("pro user passes every feature", () => {
    expect(() => requireFeature("pro", "autoSprintWatcher")).not.toThrow()
    expect(() => requireFeature("pro", "unlimitedTokens")).not.toThrow()
    expect(() => requireFeature("pro", "remoteModels")).not.toThrow()
  })
})

describe("billing.gate.verifyJwt", () => {
  const secret = "test-secret-do-not-use-in-prod"

  async function sign(payload: object): Promise<string> {
    const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const body = b64url(JSON.stringify(payload))
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`))
    return `${header}.${body}.${b64urlBytes(new Uint8Array(sig))}`
  }

  function b64url(s: string): string {
    return Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
  }
  function b64urlBytes(b: Uint8Array): string {
    return Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
  }

  it("accepts a valid token", async () => {
    const future = Math.floor(Date.now() / 1000) + 600
    const token = await sign({ sub: "cus_x", email: "a@b.co", plan: "plus", iat: 0, exp: future })
    const claims = await verifyJwt(token, secret)
    expect(claims?.plan).toBe("plus")
    expect(claims?.sub).toBe("cus_x")
  })

  it("rejects expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 10
    const token = await sign({ sub: "cus_x", email: "a@b.co", plan: "pro", iat: 0, exp: past })
    expect(await verifyJwt(token, secret)).toBeNull()
  })

  it("rejects wrong signature", async () => {
    const future = Math.floor(Date.now() / 1000) + 600
    const token = await sign({ sub: "cus_x", email: "a@b.co", plan: "pro", iat: 0, exp: future })
    expect(await verifyJwt(token, "different-secret")).toBeNull()
  })

  it("rejects malformed plan claim", async () => {
    const future = Math.floor(Date.now() / 1000) + 600
    const token = await sign({ sub: "cus_x", email: "a@b.co", plan: "ultra", iat: 0, exp: future })
    expect(await verifyJwt(token, secret)).toBeNull()
  })
})

describe("billing.gate.resolvePlan", () => {
  const secret = "test-secret"

  beforeEach(() => {
    delete process.env.SIMPLICIO_PLAN
    delete process.env.NODE_ENV
    delete process.env.SIMPLICIO_ENFORCE
  })

  it("falls back to free with no jwt and no override", async () => {
    expect(await resolvePlan()).toBe("free")
  })

  it("honors dev SIMPLICIO_PLAN override outside production", async () => {
    process.env.SIMPLICIO_PLAN = "pro"
    expect(await resolvePlan()).toBe("pro")
  })

  it("rejects SIMPLICIO_PLAN override in production with enforcement", async () => {
    process.env.SIMPLICIO_PLAN = "pro"
    process.env.NODE_ENV = "production"
    process.env.SIMPLICIO_ENFORCE = "1"
    expect(await resolvePlan()).toBe("free")
  })

  it("verifies JWT when supplied", async () => {
    const future = Math.floor(Date.now() / 1000) + 600
    const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const body = b64url(JSON.stringify({ sub: "cus_x", email: "a@b.co", plan: "plus", iat: 0, exp: future }))
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`))
    const token = `${header}.${body}.${Buffer.from(new Uint8Array(sig)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}`
    expect(await resolvePlan({ jwt: token, jwtSecret: secret })).toBe("plus")
  })

  function b64url(s: string): string {
    return Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
  }
})

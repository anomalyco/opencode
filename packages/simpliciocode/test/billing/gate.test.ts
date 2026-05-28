import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { ProRequiredError, capabilities, requirePro, resolvePlan } from "../../src/billing/gate"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("billing.gate.capabilities", () => {
  it("free plan disables every paid feature", () => {
    const caps = capabilities("free")
    expect(caps.remoteModels).toBe(false)
    expect(caps.autoSprintWatcher).toBe(false)
    expect(caps.unlimitedTokens).toBe(false)
  })

  it("pro plan enables every paid feature", () => {
    const caps = capabilities("pro")
    expect(caps.remoteModels).toBe(true)
    expect(caps.autoSprintWatcher).toBe(true)
    expect(caps.unlimitedTokens).toBe(true)
  })
})

describe("billing.gate.requirePro", () => {
  it("throws on free → autoSprintWatcher", () => {
    expect(() => requirePro("free", "autoSprintWatcher")).toThrow(ProRequiredError)
  })

  it("passes on pro → autoSprintWatcher", () => {
    expect(() => requirePro("pro", "autoSprintWatcher")).not.toThrow()
  })

  it("error message contains the upgrade URL", () => {
    try {
      requirePro("free", "unlimitedTokens")
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain("US$20/month")
      expect(msg).toContain("opencode.ai/pro")
    }
  })
})

describe("billing.gate.resolvePlan", () => {
  beforeEach(() => {
    delete process.env.SIMPLICIO_PLAN
  })

  it("honors SIMPLICIO_PLAN=pro override", async () => {
    process.env.SIMPLICIO_PLAN = "pro"
    expect(await resolvePlan()).toBe("pro")
  })

  it("honors SIMPLICIO_PLAN=free override", async () => {
    process.env.SIMPLICIO_PLAN = "free"
    expect(await resolvePlan()).toBe("free")
  })

  it("falls back to free when no lookup", async () => {
    expect(await resolvePlan()).toBe("free")
  })

  it("uses lookup result when active", async () => {
    const plan = await resolvePlan({ lookup: async () => "active" })
    expect(plan).toBe("pro")
  })

  it("uses lookup result when canceled → falls back to free", async () => {
    const plan = await resolvePlan({ lookup: async () => "canceled" })
    expect(plan).toBe("free")
  })
})

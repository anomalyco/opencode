import { describe, expect, test } from "bun:test"
import type { Provider } from "../../src/provider/provider"
import { SessionTier } from "../../src/session/tier"

function model(id: string, extra?: Partial<Provider.Model>) {
  return { providerID: "test", api: { id }, ...extra } as Provider.Model
}

describe("session.tier", () => {
  test("explicit config tier wins over the family ladder and heuristic", () => {
    expect(SessionTier.resolve(model("claude-sonnet-4-5", { tier: "minimal" }))).toBe("minimal")
    expect(SessionTier.resolve(model("qwen3.5-4b", { tier: "default" }))).toBe("default")
  })

  test("heuristic bands: ≤9B is minimal, 10–40B is default", () => {
    expect(SessionTier.resolve(model("qwen3.5-4b"))).toBe("minimal")
    expect(SessionTier.resolve(model("llama-3.1-8B-instruct"))).toBe("minimal")
    expect(SessionTier.resolve(model("qwen3.6-35b-a3b"))).toBe("default")
    expect(SessionTier.resolve(model("mixtral-22b"))).toBe("default")
    expect(SessionTier.resolve(model("llama-3.1-70b"))).toBe("default")
  })

  test("family ladder models resolve vendor", () => {
    expect(SessionTier.resolve(model("claude-sonnet-4-5"))).toBe("vendor")
    expect(SessionTier.resolve(model("gpt-5.2-codex"))).toBe("vendor")
    expect(SessionTier.resolve(model("gemini-3-pro"))).toBe("vendor")
    expect(SessionTier.resolve(model("kimi-k2-thinking"))).toBe("vendor")
    expect(SessionTier.resolve(model("k3", { providerID: "moonshotai" } as Partial<Provider.Model>))).toBe("vendor")
  })

  test("vendor family guard beats the size heuristic", () => {
    expect(SessionTier.resolve(model("gemini-2.5-flash-8b"))).toBe("vendor")
    expect(SessionTier.resolve(model("gpt-oss-20b"))).toBe("vendor")
  })

  test("unknown models without a size suffix resolve default", () => {
    expect(SessionTier.resolve(model("some-unknown-model"))).toBe("default")
    expect(SessionTier.resolve(model("glm-4.6"))).toBe("default")
  })

  test("band edge constants are exported", () => {
    expect(SessionTier.MINIMAL_MAX_PARAMS_B).toBe(9)
    expect(SessionTier.DEFAULT_MAX_PARAMS_B).toBe(40)
  })
})

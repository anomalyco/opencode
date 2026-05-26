import { describe, expect, test } from "bun:test"
import { CooldownManager, pickStart, FALLBACK_NOTICE_ID, FALLBACK_RESUME_ID, FALLBACK_USING_ID } from "../../src/session/fallback"

describe("CooldownManager", () => {
  test("isCooledDown returns false when no cooldown has been set", () => {
    const manager = new CooldownManager()
    expect(manager.isCooledDown("ollama", "glm-5.1")).toBe(false)
  })

  test("isCooledDown returns true after put and false after expiry", async () => {
    const manager = new CooldownManager()
    manager.put("ollama", "glm-5.1", 100)
    expect(manager.isCooledDown("ollama", "glm-5.1")).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(manager.isCooledDown("ollama", "glm-5.1")).toBe(false)
  })

  test("clear removes a cooldown entry", () => {
    const manager = new CooldownManager()
    manager.put("ollama", "glm-5.1", 60000)
    expect(manager.isCooledDown("ollama", "glm-5.1")).toBe(true)
    manager.clear("ollama", "glm-5.1")
    expect(manager.isCooledDown("ollama", "glm-5.1")).toBe(false)
  })

  test("put updates an existing cooldown with a new expiry", async () => {
    const manager = new CooldownManager()
    manager.put("ollama", "glm-5.1", 60000)
    manager.put("ollama", "glm-5.1", 100)
    expect(manager.isCooledDown("ollama", "glm-5.1")).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(manager.isCooledDown("ollama", "glm-5.1")).toBe(false)
  })

  test("isCooledDown returns false for unknown provider/model", () => {
    const manager = new CooldownManager()
    manager.put("ollama", "glm-5.1", 60000)
    expect(manager.isCooledDown("opencode", "unknown")).toBe(false)
  })
})

describe("fallback config validation", () => {
  test("agent config accepts fallbacks array", () => {
    const { ConfigParse } = require("../../src/config/parse")
    const { Info: AgentInfo } = require("../../src/config/agent")
    const parsed = ConfigParse.effectSchema(AgentInfo, {
      model: "ollama/glm-5.1",
      fallbacks: ["opencode/glm-5.1", "deepseek/deepseek-v4"],
    }, "test")
    expect(parsed.fallbacks).toEqual(["opencode/glm-5.1", "deepseek/deepseek-v4"])
  })

  test("agent config works without fallbacks", () => {
    const { ConfigParse } = require("../../src/config/parse")
    const { Info: AgentInfo } = require("../../src/config/agent")
    const parsed = ConfigParse.effectSchema(AgentInfo, {
      model: "ollama/glm-5.1",
    }, "test")
    expect(parsed.fallbacks).toBeUndefined()
  })

  test("top-level config accepts fallbacks and cooldown_seconds", () => {
    const { ConfigParse } = require("../../src/config/parse")
    const { Info: ConfigInfo } = require("../../src/config/config")
    const parsed = ConfigParse.effectSchema(ConfigInfo, {
      model: "ollama/glm-5.1",
      fallbacks: ["opencode/glm-5.1"],
      cooldown_seconds: 120,
    }, "test")
    expect(parsed.fallbacks).toEqual(["opencode/glm-5.1"])
    expect(parsed.cooldown_seconds).toBe(120)
  })

  test("top-level config works without fallback fields", () => {
    const { ConfigParse } = require("../../src/config/parse")
    const { Info: ConfigInfo } = require("../../src/config/config")
    const parsed = ConfigParse.effectSchema(ConfigInfo, {
      model: "ollama/glm-5.1",
    }, "test")
    expect(parsed.fallbacks).toBeUndefined()
  })
})

describe("CooldownManager.remaining", () => {
  test("returns undefined when no cooldown has been set", () => {
    const manager = new CooldownManager()
    expect(manager.remaining("ollama", "glm-5.1")).toBeUndefined()
  })

  test("returns remaining ms when cooldown is active", () => {
    const manager = new CooldownManager()
    manager.put("ollama", "glm-5.1", 60000)
    const remaining = manager.remaining("ollama", "glm-5.1")
    expect(remaining).toBeGreaterThan(59000)
    expect(remaining).toBeLessThanOrEqual(60000)
  })

  test("returns undefined after cooldown expires and cleans up", async () => {
    const manager = new CooldownManager()
    manager.put("ollama", "glm-5.1", 50)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(manager.remaining("ollama", "glm-5.1")).toBeUndefined()
    expect(manager.isCooledDown("ollama", "glm-5.1")).toBe(false)
  })
})

describe("pickStart", () => {
  test("returns primary when primary is not on cooldown", () => {
    const cm = new CooldownManager()
    const result = pickStart(
      { providerID: "anthropic", modelID: "claude-opus-4" },
      [{ providerID: "ollama", modelID: "glm-5.1" }],
      cm,
    )
    expect(result).toEqual({ kind: "primary" })
  })

  test("returns fallback when primary is on cooldown", () => {
    const cm = new CooldownManager()
    cm.put("anthropic", "claude-opus-4", 60000)
    const result = pickStart(
      { providerID: "anthropic", modelID: "claude-opus-4" },
      [{ providerID: "ollama", modelID: "glm-5.1" }],
      cm,
    )
    expect(result).toEqual({ kind: "fallback", index: 0 })
  })

  test("skips cooled-down fallback to find available one", () => {
    const cm = new CooldownManager()
    cm.put("anthropic", "claude-opus-4", 60000)
    cm.put("ollama", "glm-5.1", 60000)
    const result = pickStart(
      { providerID: "anthropic", modelID: "claude-opus-4" },
      [
        { providerID: "ollama", modelID: "glm-5.1" },
        { providerID: "deepseek", modelID: "deepseek-v4" },
      ],
      cm,
    )
    expect(result).toEqual({ kind: "fallback", index: 1 })
  })

  test("returns soonest when all models are on cooldown", () => {
    const cm = new CooldownManager()
    cm.put("anthropic", "claude-opus-4", 3600000)
    cm.put("ollama", "glm-5.1", 60000)
    const result = pickStart(
      { providerID: "anthropic", modelID: "claude-opus-4" },
      [{ providerID: "ollama", modelID: "glm-5.1" }],
      cm,
    )
    expect(result).toEqual({ kind: "soonest", index: 0 })
  })

  test("returns primary as soonest when primary expires before fallbacks", () => {
    const cm = new CooldownManager()
    cm.put("anthropic", "claude-opus-4", 5000)
    cm.put("ollama", "glm-5.1", 3600000)
    const result = pickStart(
      { providerID: "anthropic", modelID: "claude-opus-4" },
      [{ providerID: "ollama", modelID: "glm-5.1" }],
      cm,
    )
    expect(result).toEqual({ kind: "soonest", index: -1 })
  })

  test("returns primary when no fallbacks configured and primary not on cooldown", () => {
    const cm = new CooldownManager()
    const result = pickStart(
      { providerID: "anthropic", modelID: "claude-opus-4" },
      [],
      cm,
    )
    expect(result).toEqual({ kind: "primary" })
  })

  test("returns soonest with index -1 when no fallbacks and primary on cooldown", () => {
    const cm = new CooldownManager()
    cm.put("anthropic", "claude-opus-4", 60000)
    const result = pickStart(
      { providerID: "anthropic", modelID: "claude-opus-4" },
      [],
      cm,
    )
    expect(result).toEqual({ kind: "soonest", index: -1 })
  })
})

describe("fallback event IDs", () => {
  test("FALLBACK_NOTICE_ID is fallback-notice", () => {
    expect(FALLBACK_NOTICE_ID).toBe("fallback-notice")
  })
  test("FALLBACK_RESUME_ID is fallback-resume", () => {
    expect(FALLBACK_RESUME_ID).toBe("fallback-resume")
  })
  test("FALLBACK_USING_ID is fallback-using", () => {
    expect(FALLBACK_USING_ID).toBe("fallback-using")
  })
})

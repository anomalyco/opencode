import { describe, expect, test } from "bun:test"
import { Personality } from "../../src/personality"

const EXPECTED_BUILTINS = [
  "default",
  "concise",
  "technical",
  "creative",
  "teacher",
  "formal",
  "casual",
  "minimal",
  "friendly",
  "reviewer",
]

describe("Personality built-in presets", () => {
  test("all 10 built-in presets exist", () => {
    const presets = Personality.presets()
    for (const name of EXPECTED_BUILTINS) {
      expect(presets[name], `preset "${name}" should exist`).toBeDefined()
    }
  })

  test("each preset has a non-empty system_prompt", () => {
    const presets = Personality.presets()
    for (const [name, p] of Object.entries(presets)) {
      expect(p.system_prompt.trim().length, `preset "${name}" should have non-empty system_prompt`).toBeGreaterThan(0)
    }
  })

  test("resolve() returns a builtin preset by name", () => {
    const result = Personality.resolve("concise", {})
    expect(result).toBeDefined()
    expect(result?.system_prompt).toContain("concise")
  })

  test("resolve() returns undefined for unknown name", () => {
    const result = Personality.resolve("does-not-exist", {})
    expect(result).toBeUndefined()
  })

  test("resolve() returns custom personality before builtin when names match", () => {
    const config = {
      personality: {
        custom: {
          concise: { system_prompt: "My custom concise override." },
        },
      },
    }
    const result = Personality.resolve("concise", config)
    expect(result?.system_prompt).toBe("My custom concise override.")
  })

  test("list() returns all builtins with source=builtin", () => {
    const items = Personality.list({})
    const names = items.map((i) => i.name)
    for (const name of EXPECTED_BUILTINS) {
      expect(names).toContain(name)
    }
    const builtins = items.filter((i) => i.source === "builtin")
    expect(builtins.length).toBe(EXPECTED_BUILTINS.length)
  })

  test("list() includes custom personalities with source=custom", () => {
    const config = {
      personality: {
        custom: {
          mybot: { system_prompt: "My bot." },
        },
      },
    }
    const items = Personality.list(config)
    const mybot = items.find((i) => i.name === "mybot")
    expect(mybot).toBeDefined()
    expect(mybot?.source).toBe("custom")
  })

  test("list() is sorted alphabetically by name", () => {
    const items = Personality.list({})
    const names = items.map((i) => i.name)
    const sorted = [...names].sort()
    expect(names).toEqual(sorted)
  })
})

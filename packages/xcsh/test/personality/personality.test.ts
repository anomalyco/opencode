import { describe, expect, test } from "bun:test"
import { Personality } from "../../src/personality"

describe("Personality schema", () => {
  test("accepts a simple string spec", () => {
    const result = Personality.Spec.safeParse("You are a concise assistant.")
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe("You are a concise assistant.")
  })

  test("accepts a structured dict spec with system_prompt only", () => {
    const result = Personality.Spec.safeParse({ system_prompt: "You are technical." })
    expect(result.success).toBe(true)
  })

  test("accepts a full structured dict spec", () => {
    const result = Personality.Spec.safeParse({
      description: "A technical expert",
      system_prompt: "You are a deeply technical expert.",
      tone: "precise",
      style: "concise",
    })
    expect(result.success).toBe(true)
  })

  test("rejects a dict spec missing system_prompt", () => {
    const result = Personality.Spec.safeParse({ description: "Missing prompt" })
    expect(result.success).toBe(false)
  })

  test("resolves string spec to system_prompt string", () => {
    const prompt = Personality.resolvePrompt("You are brief.")
    expect(prompt).toBe("You are brief.")
  })

  test("resolves dict spec without tone/style to plain system_prompt", () => {
    const prompt = Personality.resolvePrompt({ system_prompt: "You are an expert." })
    expect(prompt).toBe("You are an expert.")
  })

  test("resolves dict spec appends tone/style guidance when present", () => {
    const prompt = Personality.resolvePrompt({
      system_prompt: "You are precise.",
      tone: "formal",
      style: "bullet-point",
    })
    expect(prompt).toContain("You are precise.")
    expect(prompt).toContain("formal")
    expect(prompt).toContain("bullet-point")
  })
})

describe("Personality config schema", () => {
  test("Config.Info accepts personality field with string personalities", async () => {
    const { Config } = await import("../../src/config/config")
    const result = Config.Info.safeParse({
      personality: {
        active: "concise",
        custom: {
          concise: "Be brief.",
        },
      },
    })
    expect(result.success).toBe(true)
  })

  test("Config.Info accepts personality field with dict personalities", async () => {
    const { Config } = await import("../../src/config/config")
    const result = Config.Info.safeParse({
      personality: {
        custom: {
          mybot: {
            description: "My custom bot",
            system_prompt: "You are my custom bot.",
            tone: "friendly",
          },
        },
      },
    })
    expect(result.success).toBe(true)
  })

  test("Config.Info is valid without personality field", async () => {
    const { Config } = await import("../../src/config/config")
    const result = Config.Info.safeParse({})
    expect(result.success).toBe(true)
  })
})

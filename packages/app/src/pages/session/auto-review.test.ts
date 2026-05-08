import { describe, expect, test } from "bun:test"
import { reviewDone, reviewPick, reviewPrompt, reviewPromptCheck, reviewPromptFor, reviewPromptKind } from "./auto-review"

const model = (providerID: string, modelID: string, variant = false) => ({
  id: modelID,
  provider: { id: providerID },
  variants: variant ? { xhigh: true } : undefined,
})

describe("reviewPrompt", () => {
  test("includes required supervisor checks and completion token", () => {
    const text = reviewPrompt("openai/gpt-5")
    expect(text).toContain("1/ Verify task completion against the requested scope.")
    expect(text).toContain("2/ If ./.agents/review.md exists, verify it was followed.")
    expect(text).toContain("3/ Ensure a PR exists when applicable, and merge status is correct when done.")
    expect(text).toContain("4/ Ensure local tests were run.")
    expect(text).toContain("5/ Ensure tests cover touched functionality end-to-end.")
    expect(text).toContain("6/ Ensure CI workflows passed.")
    expect(text).toContain("7/ If gaps remain, provide concrete next actions and continue.")
    expect(text).toContain('8/ If and only if everything is done, print exactly: "Task completed."')
  })

  test("supports cross-review prompt kind", () => {
    const text = reviewPromptFor("openai/gpt-5", "cross-review")
    expect(text).toContain("Codex, run cross-review")
  })
})

describe("reviewPrompt parsing", () => {
  test("matches prompt kind by prefix", () => {
    expect(reviewPromptCheck(reviewPrompt("openai/gpt-5"))).toBe(true)
    expect(reviewPromptKind(reviewPrompt("openai/gpt-5"))).toBe("supervisor")
    expect(reviewPromptKind(reviewPromptFor("openai/gpt-5", "cross-review"))).toBe("cross-review")
    expect(reviewPromptKind("Codex, run auto-review for openai/gpt-5 work.")).toBe("supervisor")
    expect(reviewPromptCheck("hello")).toBe(false)
    expect(reviewPromptKind("hello")).toBeUndefined()
  })
})

describe("reviewDone", () => {
  test("requires exact completion output", () => {
    expect(reviewDone("Task completed.")).toBe(true)
    expect(reviewDone(" Task completed. ")).toBe(true)
    expect(reviewDone("\nTask completed.\n")).toBe(true)
    expect(reviewDone("Task completed.\nMore")).toBe(false)
    expect(reviewDone("task completed.")).toBe(false)
  })
})

describe("reviewPick", () => {
  test("uses review model when it differs from the reviewed model", () => {
    const picked = reviewPick({
      list: [model("openai", "gpt-5"), model("anthropic", "claude-sonnet-4")],
      used: { providerID: "openai", modelID: "gpt-5" },
      review: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })

    expect(picked).toMatchObject({
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })
  })

  test("falls back to default model when review model matches the reviewed model", () => {
    const picked = reviewPick({
      list: [model("openai", "gpt-5"), model("anthropic", "claude-sonnet-4", true)],
      used: { providerID: "openai", modelID: "gpt-5" },
      review: { providerID: "openai", modelID: "gpt-5" },
      base: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })

    expect(picked).toMatchObject({
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      variant: "xhigh",
    })
  })

  test("picks a different visible model when configured models are unavailable", () => {
    const picked = reviewPick({
      list: [model("openai", "gpt-5"), model("anthropic", "claude-sonnet-4")],
      used: { providerID: "openai", modelID: "gpt-5" },
      review: { providerID: "foo", modelID: "bar" },
      base: { providerID: "baz", modelID: "qux" },
    })

    expect(picked).toMatchObject({
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })
  })

  test("returns undefined when only the same model is available", () => {
    const picked = reviewPick({
      list: [model("openai", "gpt-5")],
      used: { providerID: "openai", modelID: "gpt-5" },
      review: { providerID: "openai", modelID: "gpt-5" },
      base: { providerID: "openai", modelID: "gpt-5" },
      now: { providerID: "openai", modelID: "gpt-5" },
    })

    expect(picked).toBeUndefined()
  })

  test("avoids excluded models when alternatives exist", () => {
    const picked = reviewPick({
      list: [model("openai", "gpt-5"), model("anthropic", "claude-sonnet-4"), model("google", "gemini-2.5-pro")],
      used: { providerID: "openai", modelID: "gpt-5" },
      exclude: [{ providerID: "anthropic", modelID: "claude-sonnet-4" }],
    })

    expect(picked).toMatchObject({
      model: { providerID: "google", modelID: "gemini-2.5-pro" },
    })
  })

  test("returns undefined when all alternatives are excluded", () => {
    const picked = reviewPick({
      list: [model("openai", "gpt-5"), model("anthropic", "claude-sonnet-4")],
      used: { providerID: "openai", modelID: "gpt-5" },
      exclude: [{ providerID: "anthropic", modelID: "claude-sonnet-4" }],
    })

    expect(picked).toBeUndefined()
  })
})

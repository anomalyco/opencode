import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AntigravityCatalog } from "@opencode/core/plugin/provider/antigravity/antigravity/catalog"
import { AntigravityLanguageModel } from "@opencode/core/plugin/provider/antigravity/language-model/antigravity-language-model"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

// The list the Antigravity CLI reports for a signed-in account.
const models = [
  { slug: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
  { slug: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
  { slug: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
  { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
  { slug: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
  { slug: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
]

describe("AntigravityCatalog", () => {
  it.effect("groups the effort levels of one model into a single model", () =>
    Effect.gen(function* () {
      const groups = yield* Effect.sync(() => AntigravityCatalog.group(models))
      expect(groups.length).toBe(4)
      const flash = groups.find((group) => group.id === "gemini-3.8-flash")
      expect(flash?.variants.map((variant) => variant.id)).toEqual(["high", "medium", "low"])
      expect(flash?.variants.map((variant) => variant.slug)).toEqual([
        "gemini-3.8-flash-high",
        "gemini-3.8-flash-medium",
        "gemini-3.8-flash-low",
      ])
      const model = yield* Effect.sync(() => AntigravityCatalog.toModel(flash!))
      expect(String(model.id)).toBe("gemini-3.8-flash")
      expect(model.name).toBe("Gemini 3.8 Flash")
      expect(model.variants.map((variant) => String(variant.id))).toEqual(["high", "medium", "low"])
      expect(model.variants.map((variant) => variant.settings?.effort)).toEqual(["high", "medium", "low"])
    }),
  )

  it.effect("keeps a model with one effort level as one model without variants", () =>
    Effect.gen(function* () {
      const groups = yield* Effect.sync(() => AntigravityCatalog.group(models))
      const sonnet = groups.find((group) => group.id === "claude-sonnet-4-6")
      expect(sonnet?.variants.length).toBe(1)
      const model = yield* Effect.sync(() => AntigravityCatalog.toModel(sonnet!))
      expect(String(model.id)).toBe("claude-sonnet-4-6")
      expect(model.name).toBe("Claude Sonnet 4.6 (Thinking)")
      expect(model.variants).toEqual([])
    }),
  )

  it.effect("drops the effort suffix only when the model id ends with it", () =>
    Effect.gen(function* () {
      const groups = yield* Effect.sync(() => AntigravityCatalog.group(models))
      expect(groups.map((group) => group.id)).toEqual([
        "gemini-3.8-flash",
        "claude-sonnet-4-6",
        "claude-opus-4-6",
        "gpt-oss-120b",
      ])
    }),
  )

  it.effect("resolves the id the CLI accepts for a model and an effort", () =>
    Effect.gen(function* () {
      const groups = yield* Effect.sync(() => AntigravityCatalog.group(models))
      expect(AntigravityCatalog.resolveSlug(groups, "gemini-3.8-flash", "low")).toBe("gemini-3.8-flash-low")
      expect(AntigravityCatalog.resolveSlug(groups, "gemini-3.8-flash", "high")).toBe("gemini-3.8-flash-high")
      // The CLI's own default is the highest effort it offers.
      expect(AntigravityCatalog.resolveSlug(groups, "gemini-3.8-flash")).toBe("gemini-3.8-flash-high")
      // A model with one effort level has nothing to choose between.
      expect(AntigravityCatalog.resolveSlug(groups, "claude-opus-4-6")).toBe("claude-opus-4-6-thinking")
      expect(AntigravityCatalog.resolveSlug(groups, "gpt-oss-120b")).toBe("gpt-oss-120b-medium")
      expect(AntigravityCatalog.resolveSlug(groups, "not-a-model")).toBeUndefined()
    }),
  )
  it.effect("renders the agent's answer as text", () =>
    Effect.sync(() => {
      const parts = AntigravityLanguageModel.render({ kind: "message", text: "hello" })
      expect(parts).toEqual([{ type: "text-delta", id: "text", delta: "hello" }])
    }),
  )

  it.effect("renders a tool the agent ran itself, with its result", () =>
    Effect.sync(() => {
      const parts = AntigravityLanguageModel.render({
        kind: "tool-call",
        call: {
          toolCallId: "call-1",
          toolName: "read_file",
          args: { Path: "/tmp/x" },
          status: "completed",
          title: "read /tmp/x",
        },
      })
      expect(parts.length).toBe(2)
      expect(parts[0]).toMatchObject({ type: "tool-call", toolCallId: "call-1", providerExecuted: true })
      expect(parts[1]).toMatchObject({ type: "tool-result", toolCallId: "call-1", isError: false })
    }),
  )

  it.effect("marks a failed tool as an error", () =>
    Effect.sync(() => {
      const parts = AntigravityLanguageModel.render({
        kind: "tool-call-update",
        call: { toolCallId: "call-2", toolName: "write_file", args: {}, status: "failed" },
      })
      expect(parts[1]).toMatchObject({ type: "tool-result", isError: true })
    }),
  )

  it.effect("reads the user's text out of the prompt", () =>
    Effect.sync(() => {
      const text = AntigravityLanguageModel.readPrompt({
        prompt: [
          { role: "system", content: "you are an agent" },
          { role: "user", content: [{ type: "text", text: "say hi" }] },
        ],
      })
      expect(text).toBe("say hi")
    }),
  )
})

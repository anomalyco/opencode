import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { Skill } from "@opencode-ai/schema/skill"
import { Schema, Option } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { createMemoryComposerState, DEFAULT_PROMPT } from "./state"
import { ComposerStore } from "./schema"

describe("prompt state initialization", () => {
  test("initializes prompt text, cursor, and model together", () => {
    createRoot((dispose) => {
      const model = { providerID: "anthropic", modelID: "claude", variant: "high" }
      const prompt = createMemoryComposerState({ prompt: "hello", model })

      expect(prompt.current()).toEqual([{ type: "text", content: "hello", start: 0, end: 5 }])
      expect(prompt.cursor()).toBe(5)
      expect(prompt.model.current()).toEqual(model)
      expect(prompt.model.current()).not.toBe(model)
      dispose()
    })
  })

  test("uses the default prompt without initial values", () => {
    createRoot((dispose) => {
      const prompt = createMemoryComposerState()

      expect(prompt.current()).toEqual(DEFAULT_PROMPT)
      expect(prompt.cursor()).toBeUndefined()
      expect(prompt.model.current()).toBeUndefined()
      dispose()
    })
  })

  test("parses persisted state into one trusted current shape", () => {
    const parsed = Schema.decodeUnknownSync(
      Persistence.withInitial(ComposerStore, { prompt: DEFAULT_PROMPT, context: { items: [] } }),
    )({
      prompt: [
        { type: "text", content: "hello", start: 0, end: 5 },
        { type: "skill", id: "effect", name: "Effect", content: "@effect", start: 5, end: 12 },
        { type: "image", id: "broken", filename: "broken.png", mime: "image/png", blob: { id: 42 } },
        {
          type: "image",
          id: "missing-blob",
          filename: "missing.png",
          mime: "image/png",
          blob: { id: "content-hash-without-a-url" },
        },
        {
          type: "image",
          id: "invalid-url",
          filename: "invalid.png",
          mime: "image/png",
          blob: { id: "hash", url: "relative-url" },
        },
        {
          type: "image",
          id: "legacy",
          filename: "legacy.png",
          mime: "image/png",
          dataUrl: "data:image/png;base64,AAA",
        },
      ],
      cursor: -2,
      model: { providerID: "anthropic", modelID: "claude", variant: "high" },
      retry: { id: "invalid", agent: "build", providerID: "anthropic", modelID: "claude" },
      context: {
        items: [
          {
            type: "file",
            path: "src/app.ts",
            selection: { startLine: 1, startChar: 0, endLine: 2, endChar: 3 },
            comment: "Check this",
            key: "untrusted",
          },
          { type: "file", path: 42 },
        ],
      },
    })
    expect(parsed).toEqual({
      prompt: [
        { type: "text", content: "hello", start: 0, end: 5 },
        {
          type: "skill",
          id: Skill.ID.make("effect"),
          name: Skill.Name.make("Effect"),
          content: "@effect",
          start: 5,
          end: 12,
        },
        {
          type: "image",
          id: "legacy",
          filename: "legacy.png",
          mime: "image/png",
          blob: { id: "data:image/png;base64,AAA", url: "data:image/png;base64,AAA" },
        },
      ],
      cursor: 0,
      model: { providerID: "anthropic", modelID: "claude", variant: "high" },
      context: {
        items: [
          {
            type: "file",
            path: "src/app.ts",
            selection: { startLine: 1, startChar: 0, endLine: 2, endChar: 3 },
            comment: "Check this",
            key: expect.stringMatching(/^file:src\/app\.ts:1:2:c=/),
          },
        ],
      },
    })
    expect(Option.isNone(Schema.decodeUnknownOption(ComposerStore)("not an object"))).toBe(true)
  })
})

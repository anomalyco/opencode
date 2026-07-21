import { describe, expect, test } from "bun:test"
import {
  fallbackFor,
  modelKey,
  parseAttachmentFallbackState,
} from "../../src/session/model-state"

describe("ModelState.parseAttachmentFallbackState", () => {
  test("defaults missing or malformed root", () => {
    expect(parseAttachmentFallbackState(undefined)).toEqual({
      attachmentFallback: null,
      modelAttachmentFallback: {},
    })
    expect(parseAttachmentFallbackState("x")).toEqual({
      attachmentFallback: null,
      modelAttachmentFallback: {},
    })
  })

  test("accepts global target and ignores malformed global", () => {
    expect(
      parseAttachmentFallbackState({
        attachmentFallback: { providerID: "ollama-cloud", modelID: "gemma4:31b" },
      }),
    ).toEqual({
      attachmentFallback: { providerID: "ollama-cloud", modelID: "gemma4:31b" },
      modelAttachmentFallback: {},
    })
    expect(parseAttachmentFallbackState({ attachmentFallback: { providerID: 1 } })).toEqual({
      attachmentFallback: null,
      modelAttachmentFallback: {},
    })
  })

  test("parses per-model map including null opt-out and drops bad entries", () => {
    const state = parseAttachmentFallbackState({
      attachmentFallback: { providerID: "a", modelID: "global" },
      modelAttachmentFallback: {
        "p/m": { providerID: "ollama-cloud", modelID: "gemma4:31b" },
        "p/opt": null,
        "p/bad": { providerID: "x" },
        "p/num": 3,
      },
    })
    expect(state.attachmentFallback).toEqual({ providerID: "a", modelID: "global" })
    expect(state.modelAttachmentFallback).toEqual({
      "p/m": { providerID: "ollama-cloud", modelID: "gemma4:31b" },
      "p/opt": null,
    })
  })
})

describe("ModelState.fallbackFor", () => {
  const global = { providerID: "ollama-cloud", modelID: "gemma4:31b" }
  const override = { providerID: "ollama-cloud", modelID: "other" }
  const primary = { providerID: "ollama-cloud", modelID: "deepseek-v4-flash" }

  test("per-model override wins over global", () => {
    expect(
      fallbackFor(
        {
          attachmentFallback: global,
          modelAttachmentFallback: { [modelKey(primary)]: override },
        },
        primary,
      ),
    ).toEqual(override)
  })

  test("uses global when no per-model entry", () => {
    expect(
      fallbackFor({ attachmentFallback: global, modelAttachmentFallback: {} }, primary),
    ).toEqual(global)
  })

  test("explicit null opt-out disables global", () => {
    expect(
      fallbackFor(
        {
          attachmentFallback: global,
          modelAttachmentFallback: { [modelKey(primary)]: null },
        },
        primary,
      ),
    ).toBeUndefined()
  })

  test("unset means no fallback", () => {
    expect(fallbackFor({ attachmentFallback: null, modelAttachmentFallback: {} }, primary)).toBeUndefined()
  })
})

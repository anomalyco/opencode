import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import {
  fallbackFor,
  formatFallbackTarget,
  modelKey,
  parseAttachmentFallbackState,
  withModelAttachmentFallback,
  type ModelRef,
} from "../../src/util/attachment-fallback"

const global = { providerID: "ollama-cloud", modelID: "gemma4:31b" }
const override = { providerID: "ollama-cloud", modelID: "other" }
const primary = { providerID: "ollama-cloud", modelID: "deepseek-v4-flash" }

describe("util.attachment-fallback parse", () => {
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

  test("preserves explicit null global", () => {
    expect(parseAttachmentFallbackState({ attachmentFallback: null })).toEqual({
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
        "provider/family/model": { providerID: "p", modelID: "family/model" },
      },
    })
    expect(state.attachmentFallback).toEqual({ providerID: "a", modelID: "global" })
    expect(state.modelAttachmentFallback).toEqual({
      "p/m": { providerID: "ollama-cloud", modelID: "gemma4:31b" },
      "p/opt": null,
      "provider/family/model": { providerID: "p", modelID: "family/model" },
    })
  })
})

describe("util.attachment-fallback fallbackFor", () => {
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
    expect(fallbackFor({ attachmentFallback: global, modelAttachmentFallback: {} }, primary)).toEqual(global)
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

describe("util.attachment-fallback formatFallbackTarget", () => {
  test("formats target, none for opt-out, empty for missing", () => {
    expect(formatFallbackTarget(global)).toBe("ollama-cloud/gemma4:31b")
    expect(formatFallbackTarget(null)).toBe("(none)")
    expect(formatFallbackTarget(undefined)).toBe("")
  })
})

describe("util.attachment-fallback solid store clear", () => {
  test("path delete removes per-model entry; shallow spread does not", () => {
    const [store, setStore] = createStore({
      modelAttachmentFallback: {
        [modelKey(primary)]: override,
        "other/m": global,
      } as Record<string, ModelRef | null>,
    })

    const key = modelKey(primary)
    const without = { ...store.modelAttachmentFallback }
    delete without[key]
    // Regression: Solid shallow-merges object replacements and keeps deleted keys.
    setStore("modelAttachmentFallback", without)
    expect(key in store.modelAttachmentFallback).toBe(true)

    setStore("modelAttachmentFallback", key, undefined!)
    expect(key in store.modelAttachmentFallback).toBe(false)
    expect(store.modelAttachmentFallback["other/m"]).toEqual(global)
  })

  test("set and null opt-out round-trip via withModelAttachmentFallback", () => {
    const [store, setStore] = createStore({
      modelAttachmentFallback: {} as Record<string, ModelRef | null>,
      attachmentFallback: global as ModelRef | null,
    })

    setStore(
      "modelAttachmentFallback",
      withModelAttachmentFallback(store.modelAttachmentFallback, primary, override),
    )
    expect(fallbackFor(store, primary)).toEqual(override)

    setStore(
      "modelAttachmentFallback",
      withModelAttachmentFallback(store.modelAttachmentFallback, primary, null),
    )
    expect(store.modelAttachmentFallback[modelKey(primary)]).toBeNull()
    expect(fallbackFor(store, primary)).toBeUndefined()

    setStore("modelAttachmentFallback", modelKey(primary), undefined!)
    expect(fallbackFor(store, primary)).toEqual(global)
  })
})

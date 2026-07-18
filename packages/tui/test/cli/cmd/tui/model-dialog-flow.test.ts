import { describe, expect, test } from "bun:test"
import {
  boostCurrentProviderMatches,
  isSameRightMode,
  resolveModelSelect,
  resolveSelectionCurrent,
  resolveVariantApply,
  rightPaneContentKey,
} from "../../../../src/component/dialog-model-flow"
import { listModelVariants } from "../../../../src/component/dialog-variant"
import { sortModelOptions } from "../../../../src/component/dialog-model"

describe("model dialog user flow", () => {
  describe("resolveSelectionCurrent", () => {
    test("session picker falls back to the live session model", () => {
      expect(
        resolveSelectionCurrent({
          configPicker: false,
          sessionCurrent: { providerID: "openai", modelID: "gpt-4o" },
        }),
      ).toEqual({ providerID: "openai", modelID: "gpt-4o" })
    })

    test("config picker does not fall back to the session model when unset", () => {
      expect(
        resolveSelectionCurrent({
          configPicker: true,
          sessionCurrent: { providerID: "openai", modelID: "gpt-4o" },
        }),
      ).toBeUndefined()
    })

    test("explicit current wins for both picker modes", () => {
      const current = { providerID: "anthropic", modelID: "claude" }
      expect(
        resolveSelectionCurrent({
          configPicker: true,
          current,
          sessionCurrent: { providerID: "openai", modelID: "gpt-4o" },
        }),
      ).toEqual(current)
      expect(
        resolveSelectionCurrent({
          configPicker: false,
          current,
          sessionCurrent: { providerID: "openai", modelID: "gpt-4o" },
        }),
      ).toEqual(current)
    })
  })

  describe("resolveModelSelect", () => {
    test("config picker always callbacks and never opens variants or sets the session model", () => {
      expect(
        resolveModelSelect({
          providerID: "openai",
          modelID: "gpt-4o",
          configPicker: true,
          hasVariants: true,
        }),
      ).toEqual({ type: "callback", providerID: "openai", modelID: "gpt-4o" })
    })

    test("session picker opens variants when the model has them", () => {
      expect(
        resolveModelSelect({
          providerID: "openai",
          modelID: "gpt-5",
          configPicker: false,
          hasVariants: true,
        }),
      ).toEqual({
        type: "open-variants",
        model: { providerID: "openai", modelID: "gpt-5" },
      })
    })

    test("session picker sets the model when there are no variants", () => {
      expect(
        resolveModelSelect({
          providerID: "anthropic",
          modelID: "claude-sonnet",
          configPicker: false,
          hasVariants: false,
        }),
      ).toEqual({
        type: "set-model",
        model: { providerID: "anthropic", modelID: "claude-sonnet" },
      })
    })
  })

  describe("resolveVariantApply", () => {
    test("config picker reports the model without mutating the session", () => {
      expect(
        resolveVariantApply({
          model: { providerID: "openai", modelID: "gpt-5" },
          configPicker: true,
          variant: "high",
        }),
      ).toEqual({
        type: "config-callback",
        model: { providerID: "openai", modelID: "gpt-5" },
      })
    })

    test("session picker from the model dialog sets model then variant", () => {
      expect(
        resolveVariantApply({
          model: { providerID: "openai", modelID: "gpt-5" },
          configPicker: false,
          variant: "high",
        }),
      ).toEqual({
        type: "set-model-and-variant",
        model: { providerID: "openai", modelID: "gpt-5" },
        variant: "high",
      })
    })

    test("standalone variant dialog only updates the active variant", () => {
      expect(
        resolveVariantApply({
          configPicker: false,
          variant: undefined,
        }),
      ).toEqual({ type: "set-variant", variant: undefined })
    })
  })

  describe("boostCurrentProviderMatches", () => {
    const matches = [
      { title: "Claude", value: { providerID: "anthropic", modelID: "claude" } },
      { title: "GPT better", value: { providerID: "openai", modelID: "gpt-better" } },
      { title: "GPT worse", value: { providerID: "openai", modelID: "gpt-worse" } },
      { title: "Gemini", value: { providerID: "google", modelID: "gemini" } },
    ]

    test("keeps fuzzysort order when there is no current provider", () => {
      expect(boostCurrentProviderMatches(matches, undefined).map((m) => m.title)).toEqual([
        "Claude",
        "GPT better",
        "GPT worse",
        "Gemini",
      ])
    })

    test("boosts the current provider while preserving score order within each group", () => {
      expect(boostCurrentProviderMatches(matches, "openai").map((m) => m.title)).toEqual([
        "GPT better",
        "GPT worse",
        "Claude",
        "Gemini",
      ])
    })

    test("must not be followed by free/date sort or relevance ranking is lost", () => {
      // Documents the narrow-dialog regression: sortModelOptions after boost
      // reorders by Free → release date and discards fuzzysort score order.
      const scored = [
        { title: "Exact hit", value: { providerID: "b", modelID: "1" }, releaseDate: "2024-01-01", footer: undefined },
        {
          title: "Loose hit free",
          value: { providerID: "a", modelID: "2" },
          releaseDate: "2026-01-01",
          footer: "Free",
        },
      ]
      const boosted = boostCurrentProviderMatches(scored, "b")
      expect(boosted.map((m) => m.title)).toEqual(["Exact hit", "Loose hit free"])

      const wronglyResorted = sortModelOptions(boosted, false)
      expect(wronglyResorted.map((m) => m.title)).toEqual(["Loose hit free", "Exact hit"])
    })
  })

  describe("listModelVariants", () => {
    test("returns variant keys for the matched model", () => {
      expect(
        listModelVariants(
          [
            {
              id: "openai",
              models: {
                "gpt-5": { variants: { high: {}, low: {} } },
              },
            },
          ],
          { providerID: "openai", modelID: "gpt-5" },
        ),
      ).toEqual(["high", "low"])
    })

    test("returns empty when the model has no variants", () => {
      expect(
        listModelVariants([{ id: "openai", models: { "gpt-4o": {} } }], {
          providerID: "openai",
          modelID: "gpt-4o",
        }),
      ).toEqual([])
    })
  })

  describe("provider/model hover pane switching", () => {
    test("same provider hover is a no-op so a long list is not rebuilt", () => {
      const openrouter = { kind: "provider" as const, providerID: "openrouter" }
      expect(isSameRightMode(openrouter, openrouter)).toBe(true)
      expect(isSameRightMode(openrouter, { kind: "provider", providerID: "openrouter" })).toBe(true)
      expect(isSameRightMode(openrouter, { kind: "provider", providerID: "anthropic" })).toBe(false)
      expect(isSameRightMode(openrouter, { kind: "favorites" })).toBe(false)
    })

    test("content key changes when hovering to another provider or into search", () => {
      expect(
        rightPaneContentKey({
          mode: { kind: "provider", providerID: "openrouter" },
          searching: false,
          query: "",
        }),
      ).toBe("provider:openrouter")
      expect(
        rightPaneContentKey({
          mode: { kind: "provider", providerID: "anthropic" },
          searching: false,
          query: "",
        }),
      ).toBe("provider:anthropic")
      expect(
        rightPaneContentKey({
          mode: { kind: "provider", providerID: "openrouter" },
          searching: true,
          query: " gpt ",
        }),
      ).toBe("search:gpt")
    })

    test("content key change is the signal to reset selection and scroll to top", () => {
      // Documents the long-list hover bug: scrolling deep in OpenRouter then
      // hovering another provider must not leave scroll offset while selection
      // resets to index 0 (highlight off-screen / empty viewport).
      const before = rightPaneContentKey({
        mode: { kind: "provider", providerID: "openrouter" },
        searching: false,
        query: "",
      })
      const after = rightPaneContentKey({
        mode: { kind: "provider", providerID: "anthropic" },
        searching: false,
        query: "",
      })
      expect(before === after).toBe(false)
    })
  })
})

import { describe, expect, test } from "bun:test"
import { DateTime } from "luxon"
import { computeFamilyHeads, isModelVisible } from "./model-visibility"

describe("computeFamilyHeads", () => {
  test("returns model as head of unique family", () => {
    const models = [
      {
        providerID: "opencode",
        modelID: "big-pickle",
        id: "big-pickle",
        provider: { id: "opencode" },
        family: "big-pickle",
        release_date: "2025-10-17",
      },
    ]

    const heads = computeFamilyHeads(models)
    expect(heads.has("opencode:big-pickle")).toBe(true)
  })

  test("returns only the most recent model per family", () => {
    const models = [
      {
        providerID: "opencode",
        modelID: "nemotron-3-ultra-free",
        id: "nemotron-3-ultra-free",
        provider: { id: "opencode" },
        family: "nemotron-free",
        release_date: "2026-06-04",
      },
      {
        providerID: "opencode",
        modelID: "nemotron-3.5-lightning-free",
        id: "nemotron-3.5-lightning-free",
        provider: { id: "opencode" },
        family: "nemotron-free",
        release_date: "2026-08-11",
      },
    ]

    const heads = computeFamilyHeads(models)
    expect(heads.has("opencode:nemotron-3.5-lightning-free")).toBe(true)
    expect(heads.has("opencode:nemotron-3-ultra-free")).toBe(false)
  })

  test("handles multiple independent families", () => {
    const models = [
      {
        providerID: "opencode",
        modelID: "big-pickle",
        id: "big-pickle",
        provider: { id: "opencode" },
        family: "big-pickle",
        release_date: "2025-10-17",
      },
      {
        providerID: "opencode",
        modelID: "hy3-free",
        id: "hy3-free",
        provider: { id: "opencode" },
        family: "hy3-free",
        release_date: "2026-07-06",
      },
    ]

    const heads = computeFamilyHeads(models)
    expect(heads.has("opencode:big-pickle")).toBe(true)
    expect(heads.has("opencode:hy3-free")).toBe(true)
  })
})

describe("isModelVisible", () => {
  const emptyMap = new Map<string, "show" | "hide">()
  const showMap = new Map<string, "show" | "hide">([["opencode:big-pickle", "show"]])
  const hideMap = new Map<string, "show" | "hide">([["opencode:big-pickle", "hide"]])

  test("hide visibility always returns false", () => {
    const input = {
      key: "opencode:big-pickle",
      visibility: hideMap,
      release: new Map<string, DateTime>(),
      familyHeads: new Set(["opencode:big-pickle"]),
    }
    expect(isModelVisible(input)).toBe(false)
  })

  test("show visibility always returns true", () => {
    const input = {
      key: "opencode:big-pickle",
      visibility: showMap,
      release: new Map<string, DateTime>(),
      familyHeads: new Set<string>(),
    }
    expect(isModelVisible(input)).toBe(true)
  })

  test("model with no release date is visible", () => {
    const input = {
      key: "opencode:some-model",
      visibility: emptyMap,
      release: new Map<string, DateTime>(),
      familyHeads: new Set<string>(),
    }
    expect(isModelVisible(input)).toBe(true)
  })

  test("big-pickle (only model in family, old date) is visible", () => {
    const release = new Map([["opencode:big-pickle", DateTime.fromISO("2025-10-17")]])
    const input = {
      key: "opencode:big-pickle",
      visibility: emptyMap,
      release,
      familyHeads: new Set(["opencode:big-pickle"]),
    }
    expect(isModelVisible(input)).toBe(true)
  })

  test("nemotron-3-ultra (superseded by 3.5) is hidden", () => {
    const release = new Map([
      ["opencode:nemotron-3-ultra-free", DateTime.fromISO("2026-06-04")],
      ["opencode:nemotron-3.5-lightning-free", DateTime.fromISO("2026-08-11")],
    ])
    const heads = computeFamilyHeads([
      {
        providerID: "opencode",
        modelID: "nemotron-3-ultra-free",
        id: "nemotron-3-ultra-free",
        provider: { id: "opencode" },
        family: "nemotron-free",
        release_date: "2026-06-04",
      },
      {
        providerID: "opencode",
        modelID: "nemotron-3.5-lightning-free",
        id: "nemotron-3.5-lightning-free",
        provider: { id: "opencode" },
        family: "nemotron-free",
        release_date: "2026-08-11",
      },
    ])

    const input = {
      key: "opencode:nemotron-3-ultra-free",
      visibility: emptyMap,
      release,
      familyHeads: heads,
    }
    expect(isModelVisible(input)).toBe(false)
  })

  test("nemotron-3.5 (family head) is visible", () => {
    const release = new Map([
      ["opencode:nemotron-3-ultra-free", DateTime.fromISO("2026-06-04")],
      ["opencode:nemotron-3.5-lightning-free", DateTime.fromISO("2026-08-11")],
    ])
    const heads = computeFamilyHeads([
      {
        providerID: "opencode",
        modelID: "nemotron-3-ultra-free",
        id: "nemotron-3-ultra-free",
        provider: { id: "opencode" },
        family: "nemotron-free",
        release_date: "2026-06-04",
      },
      {
        providerID: "opencode",
        modelID: "nemotron-3.5-lightning-free",
        id: "nemotron-3.5-lightning-free",
        provider: { id: "opencode" },
        family: "nemotron-free",
        release_date: "2026-08-11",
      },
    ])

    const input = {
      key: "opencode:nemotron-3.5-lightning-free",
      visibility: emptyMap,
      release,
      familyHeads: heads,
    }
    expect(isModelVisible(input)).toBe(true)
  })

  test("hy3-free, mimo, muse (unique families) are visible", () => {
    const release = new Map([
      ["opencode:hy3-free", DateTime.fromISO("2026-07-06")],
      ["opencode:mimo-v2.5-free", DateTime.fromISO("2026-04-24")],
      ["opencode:muse-spark-1.2-contributor-free", DateTime.fromISO("2026-08-05")],
    ])
    const input = {
      key: "opencode:hy3-free",
      visibility: emptyMap,
      release,
      familyHeads: new Set(["opencode:hy3-free", "opencode:mimo-v2.5-free", "opencode:muse-spark-1.2-contributor-free"]),
    }
    expect(isModelVisible(input)).toBe(true)
  })

  test("model with invalid date is visible even if not family head", () => {
    const release = new Map([["opencode:bad-date", DateTime.invalid("test")]])
    const input = {
      key: "opencode:bad-date",
      visibility: emptyMap,
      release,
      familyHeads: new Set<string>(),
    }
    expect(isModelVisible(input)).toBe(true)
  })
})

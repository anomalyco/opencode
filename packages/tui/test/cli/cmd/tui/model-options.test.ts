import { describe, expect, test } from "bun:test"
import {
  isModelCatalogLoading,
  modelCatalogAttentionHandler,
  sortModelOptions,
} from "../../../../src/component/dialog-model"

describe("sortModelOptions", () => {
  test("orders provider-scoped model choices by newest release first", () => {
    const sorted = sortModelOptions(
      [
        { title: "GPT 5.2", releaseDate: "2025-12-11" },
        { title: "GPT 5.4", releaseDate: "2026-03-05" },
        { title: "GPT 5.1", releaseDate: "2025-11-13" },
      ],
      true,
    )

    expect(sorted.map((model) => model.title)).toEqual(["GPT 5.4", "GPT 5.2", "GPT 5.1"])
  })

  test("orders regular model choices free-first and then newest-first", () => {
    const sorted = sortModelOptions(
      [
        { title: "GLM 5", releaseDate: "2025-07-28" },
        { title: "GLM 5.1", releaseDate: "2025-12-09" },
        { title: "GLM 5.2", releaseDate: "2026-02-16" },
        { title: "Free old", releaseDate: "2024-01-01", footer: "Free" },
        { title: "Free new", releaseDate: "2025-01-01", footer: "Free" },
      ],
      false,
    )

    expect(sorted.map((model) => model.title)).toEqual(["Free new", "Free old", "GLM 5.2", "GLM 5.1", "GLM 5"])
  })
})

describe("isModelCatalogLoading", () => {
  test("loading is an unsettled model catalog", () => {
    expect(isModelCatalogLoading("loading")).toBe(true)
  })

  test("partial has a settled model catalog", () => {
    expect(isModelCatalogLoading("partial")).toBe(false)
  })

  test("complete has a settled model catalog", () => {
    expect(isModelCatalogLoading("complete")).toBe(false)
  })

  test("deferred agents keep the model catalog unavailable", () => {
    expect(isModelCatalogLoading("partial", "loading")).toBe(true)
    expect(isModelCatalogLoading("complete", "loading")).toBe(true)
  })
})

describe("modelCatalogAttentionHandler", () => {
  test("returns the trigger while the catalog is loading", () => {
    const trigger = () => {}
    expect(modelCatalogAttentionHandler("loading", trigger)).toBe(trigger)
  })

  test("is absent for settled catalog states", () => {
    const trigger = () => {}
    expect(modelCatalogAttentionHandler("partial", trigger)).toBeUndefined()
    expect(modelCatalogAttentionHandler("complete", trigger)).toBeUndefined()
  })

  test("returns the trigger while agents are loading", () => {
    const trigger = () => {}
    expect(modelCatalogAttentionHandler("partial", trigger, "loading")).toBe(trigger)
  })
})

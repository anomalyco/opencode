import { describe, expect, mock, test } from "bun:test"

mock.module("@solidjs/router", () => ({ query: (load: () => unknown) => load }))

const { buildModelCatalog, findModelCatalogEntry, isKnownCatalogLab, modelPagePath } = await import("./model-catalog")

describe("model catalog pricing", () => {
  test("prefers OpenCode Go pricing over a zero-cost coding plan with the same model id", () => {
    const catalog = buildModelCatalog(
      {
        models: {
          "zhipuai/glm-5.3": {
            id: "zhipuai/glm-5.3",
            name: "GLM-5.3",
          },
        },
      },
      {
        "opencode-go": {
          id: "opencode-go",
          models: {
            "glm-5.3": {
              id: "glm-5.3",
              cost: { input: 1.4, output: 4.4, cache_read: 0.26 },
            },
          },
        },
        "zhipuai-coding-plan": {
          id: "zhipuai-coding-plan",
          models: {
            "glm-5.3": {
              id: "glm-5.3",
              cost: { input: 0, output: 0, cache_read: 0 },
            },
          },
        },
      },
    )

    expect(findModelCatalogEntry(catalog, "glm-5.3")?.cost).toEqual({
      input: 1.4,
      output: 4.4,
      cacheRead: 0.26,
      cacheWrite: undefined,
    })
  })
})

describe("known catalog labs", () => {
  test("resolves stats author aliases to their catalog lab", () => {
    expect(isKnownCatalogLab("qwen", ["alibaba"])).toBe(true)
    expect(isKnownCatalogLab("zhipu", ["zhipuai"])).toBe(true)
    expect(isKnownCatalogLab("meta", ["alibaba"])).toBe(false)
  })
})

describe("revealed model pages", () => {
  test("resolves Beam usage names to the Beam 1.0 501B A23B catalog page", () => {
    const catalog = buildModelCatalog({
      models: {
        "reflection/beam-1.0-501b-a23b": {
          id: "reflection/beam-1.0-501b-a23b",
          name: "Beam 1.0 501B A23B",
        },
      },
    })

    ;["beam", "beam-free", "cat-jam", "beam-1.0-501b-a23b", "beam-1-0-501b-a23b"].forEach((model) => {
      expect(findModelCatalogEntry(catalog, model, "reflection")?.name).toBe("Beam 1.0 501B A23B")
      expect(modelPagePath(catalog, "reflection", model)).toBe("/data/reflection/beam-1-0-501b-a23b")
    })
  })
})

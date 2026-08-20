import { describe, expect, mock, test } from "bun:test"

mock.module("@solidjs/router", () => ({ query: (load: () => unknown) => load }))

const { buildModelCatalog, findModelCatalogEntry } = await import("./model-catalog")

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

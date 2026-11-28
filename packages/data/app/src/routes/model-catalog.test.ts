import { describe, expect, test } from "bun:test"
import {
  buildModelCatalog,
  catalogLabPath,
  findModelCatalogEntry,
  findModelCatalogLab,
  formatCatalogLabName,
  isKnownCatalogLab,
  modelPagePath,
} from "./model-catalog"
import { formerModelName } from "../lib/model-name"
import { providerIconId } from "../lib/provider-icon"

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

  test("sends the Crouton Alpha page to Muse Ember 1.0", () => {
    const catalog = buildModelCatalog({
      models: { "meta/muse-ember-1.0": { id: "meta/muse-ember-1.0", name: "Muse Ember" } },
    })

    expect(findModelCatalogEntry(catalog, "crouton-alpha", "unknown")?.id).toBe("meta/muse-ember-1.0")
    expect(modelPagePath(catalog, "unknown", "crouton-alpha")).toBe("/data/meta/muse-ember-1-0")
  })

  test("handles Object.prototype property names in lab and model lookups without throwing", () => {
    const catalog = buildModelCatalog({
      models: { "alibaba/qwen-3": { id: "alibaba/qwen-3", name: "Qwen 3" } },
    })

    const cases = [
      { key: "__proto__", name: "  Proto  ", path: "/data/proto", icon: "proto" },
      { key: "constructor", name: "Constructor", path: "/data/constructor", icon: "constructor" },
      { key: "toString", name: "ToString", path: "/data/tostring", icon: "tostring" },
      { key: "valueOf", name: "ValueOf", path: "/data/valueof", icon: "valueof" },
      { key: "hasOwnProperty", name: "HasOwnProperty", path: "/data/hasownproperty", icon: "hasownproperty" },
    ] as const

    cases.forEach((entry) => {
      expect(findModelCatalogEntry(catalog, entry.key, "alibaba")).toBeUndefined()
      expect(findModelCatalogEntry(catalog, entry.key, entry.key)).toBeUndefined()
      expect(findModelCatalogLab(catalog, entry.key)).toBeUndefined()
      expect(formatCatalogLabName(entry.key)).toBe(entry.name)
      expect(catalogLabPath(entry.key)).toBe(entry.path)
      expect(formerModelName(entry.key)).toBeUndefined()
      expect(providerIconId(entry.key)).toBe(entry.icon)
    })
  })
})

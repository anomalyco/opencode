import { describe, expect, mock, test } from "bun:test"

// The catalog module defines a router query at import time, which throws outside a Solid server runtime.
mock.module("@solidjs/router", () => ({ query: (fn: unknown) => fn }))
const { buildModelCatalog } = await import("../src/routes/model-catalog")

const listing = (overrides: Record<string, unknown> = {}) => ({
  id: "exo-free",
  name: "Exo Free",
  release_date: "2026-09-23",
  modalities: { input: ["text", "image", "video"], output: ["text"] },
  limit: { context: 1048576, input: 524288, output: 524288 },
  cost: { input: 0, output: 0 },
  ...overrides,
})

describe("stealth model specs", () => {
  test("reads public specs for stealth models from OpenCode provider listings", () => {
    const catalog = buildModelCatalog([], {
      opencode: {
        id: "opencode",
        models: { "exo-free": listing(), "gpt-5-nano": listing({ id: "gpt-5-nano" }) },
      },
      "nano-gpt": { id: "nano-gpt", models: { "stealth/exo-alpha": listing({ limit: { context: 1 } }) } },
    })

    expect(catalog.stealthSpecs).toEqual({
      "exo": {
        knowledge: undefined,
        releaseDate: "2026-09-23",
        limit: { context: 1048576, output: 524288 },
        modalities: { input: ["text", "image", "video"], output: ["text"] },
      },
    })
  })

  test("prefers the opencode listing over opencode-go", () => {
    const catalog = buildModelCatalog([], {
      opencode: { models: { "exo-free": listing() } },
      "opencode-go": { models: { "exo-free": listing({ release_date: "2026-01-01" }) } },
    })

    expect(catalog.stealthSpecs["exo"]?.releaseDate).toBe("2026-09-23")
  })

  test("leaves stealth models out of the lab catalog", () => {
    const catalog = buildModelCatalog([], { opencode: { models: { "exo-free": listing() } } })

    expect(catalog.models).toEqual([])
    expect(catalog.labs).toEqual([])
  })
})

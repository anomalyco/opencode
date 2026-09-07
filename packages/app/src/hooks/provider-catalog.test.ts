import { expect, test } from "bun:test"
import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import { resolveDefaultModel, selectProviderCatalog } from "./provider-catalog"

const catalog = (id: string): NormalizedProviderListResponse => ({
  all: new Map([[id, { id, name: id, source: "api", env: [], options: {}, models: {} }]]),
  connected: [id],
  default: { [id]: `${id}-model` },
})

test("selects the ready catalog for an explicit directory", () => {
  const directory = catalog("directory")

  expect(
    selectProviderCatalog({
      explicit: true,
      directory: "/repo",
      catalog: { ready: true, providers: directory },
    }),
  ).toBe(directory)
})

test("returns an empty catalog while an explicit directory is unresolved", () => {
  expect(selectProviderCatalog({ explicit: true })).toEqual({ all: new Map(), connected: [], default: {} })
  expect(
    selectProviderCatalog({
      explicit: true,
      directory: "/repo",
      catalog: { ready: false, providers: catalog("directory") },
    }),
  ).toEqual({ all: new Map(), connected: [], default: {} })
})

test("uses the route catalog when it is ready", () => {
  const directory = catalog("directory")

  expect(
    selectProviderCatalog({
      explicit: false,
      directory: "/repo",
      catalog: { ready: true, providers: directory },
      global: catalog("global"),
    }),
  ).toBe(directory)
})

test("falls back to the global catalog for route consumers", () => {
  const global = catalog("global")

  expect(selectProviderCatalog({ explicit: false, global })).toBe(global)
  expect(
    selectProviderCatalog({
      explicit: false,
      directory: "/repo",
      catalog: { ready: false, providers: catalog("directory") },
      global,
    }),
  ).toBe(global)
})

test("uses the current server default model", () => {
  expect(resolveDefaultModel({ providerID: "openai", modelID: "gpt-5" }, "anthropic/claude")).toEqual({
    providerID: "openai",
    modelID: "gpt-5",
  })
})

test("does not use legacy config when the current server has no default", () => {
  expect(resolveDefaultModel(null, "anthropic/claude")).toBeUndefined()
})

test("uses config for legacy servers", () => {
  expect(resolveDefaultModel(undefined, "anthropic/claude")).toEqual({
    providerID: "anthropic",
    modelID: "claude",
  })
})

test("preserves slashes in model IDs for legacy servers", () => {
  expect(resolveDefaultModel(undefined, "openrouter/openrouter/free")).toEqual({
    providerID: "openrouter",
    modelID: "openrouter/free",
  })
  expect(resolveDefaultModel(undefined, "openrouter/anthropic/claude-sonnet-4.6")).toEqual({
    providerID: "openrouter",
    modelID: "anthropic/claude-sonnet-4.6",
  })
})

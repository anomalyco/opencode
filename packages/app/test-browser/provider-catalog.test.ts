import { expect, test } from "bun:test"
import { createMemo, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { normalizeProviderList } from "@/runtime/server/global-sync/utils"

test("preserves an already normalized reactive catalog", () => {
  const [store] = createStore({ catalog: { all: new Map<string, never>(), connected: [], default: {} } })
  expect(normalizeProviderList(store.catalog)).toBe(store.catalog)
})

test("shares catalog snapshots and reacts to replacement lists", () => {
  createRoot((dispose) => {
    const provider = { id: "openai", name: "OpenAI", package: "@ai-sdk/openai", activation: "enabled" as const }
    const model = {
      id: "gpt-5",
      modelID: "gpt-5",
      providerID: "openai",
      name: "GPT-5",
      settings: {},
      headers: {},
      capabilities: { tools: true, input: ["text" as const], output: ["text" as const] },
      variants: [],
      time: { released: 1 },
      cost: [],
      status: "active" as const,
      enabled: true,
      limit: { context: 128_000, output: 8192 },
    }
    const [store, setStore] = createStore({ providers: [provider], models: [model] })
    const first = createMemo(() => normalizeProviderList(store.providers, store.models))
    const second = createMemo(() => normalizeProviderList(store.providers, store.models))
    expect(first()).toBe(second())
    const initial = first()
    setStore("models", [{ ...model, name: "Renamed", limit: { context: 256_000, output: 16384 } }])
    expect(first()).not.toBe(initial)
    expect(first()).toBe(second())
    expect(first().all.get("openai")?.models[model.id]).toMatchObject({
      name: "Renamed",
      limit: { context: 256_000, output: 16384 },
    })
    const renamed = first()
    setStore("providers", [{ ...provider, name: "Custom OpenAI" }])
    expect(first()).not.toBe(renamed)
    expect(first()).toBe(second())
    expect(first().all.get("openai")?.name).toBe("Custom OpenAI")
    expect(normalizeProviderList(store.providers).all.get("openai")?.models).toEqual({})
    setStore("models", [])
    expect(first().all.get("openai")?.models).toEqual({})
    expect(first().default).toEqual({})
    dispose()
  })
})

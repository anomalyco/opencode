import { expect, test } from "bun:test"
import { createPluginContext, type Registry, type usePluginHost } from "../src/plugin/api"
import { model, renderLocal } from "./fixture/local"

// Eagerly read host services need a shape; model access goes through the real LocalProvider.
function pluginModel(local: ReturnType<typeof usePluginHost>["local"]) {
  const host = {
    app: {},
    client: {},
    keymap: {},
    shortcuts: {},
    keymapState: {},
    sessionTabs: {},
    local,
  } as unknown as ReturnType<typeof usePluginHost>
  const registry: Registry = { has: () => false, set() {}, remove() {}, active: () => true }
  return createPluginContext({ host, id: "test", options: undefined, owned: [], registry }).ui.model
}

test("plugins read and select variants of the selected model", async () => {
  await using setup = await renderLocal({ models: [model("first", ["low", "high"])] })
  const selected = pluginModel(setup.local)

  expect(selected.current()).toEqual({ providerID: "provider", modelID: "first", variant: undefined })
  expect(selected.variant.list()).toEqual(["low", "high"])

  expect(selected.variant.set("high")).toBe(true)
  expect(selected.current()?.variant).toBe("high")
  expect(setup.local.model.variant.current()).toBe("high")

  expect(selected.variant.set(undefined)).toBe(true)
  expect(selected.current()?.variant).toBeUndefined()
})

test("plugins cannot select unavailable variants or variants without a model", async () => {
  await using setup = await renderLocal({ models: [model("first", ["low", "high"])] })
  const selected = pluginModel(setup.local)
  expect(selected.variant.set("max")).toBe(false)
  expect(selected.current()?.variant).toBeUndefined()

  await using empty = await renderLocal({ models: [] })
  const none = pluginModel(empty.local)
  expect(none.current()).toBeUndefined()
  expect(none.variant.list()).toEqual([])
  expect(none.variant.set(undefined)).toBe(false)
})

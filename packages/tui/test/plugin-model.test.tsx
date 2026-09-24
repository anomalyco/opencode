import { expect, test } from "bun:test"
import { createPluginContext, type Registry, type usePluginHost } from "../src/plugin/api"

type Host = ReturnType<typeof usePluginHost>
type Selection = { providerID: string; modelID: string; variant?: string }

function setup(selection: Selection | undefined, variants: string[]) {
  const selected: (string | undefined)[] = []
  const host = {
    app: { version: "test", channel: "test" },
    client: { api: {} },
    keymap: {},
    shortcuts: {},
    keymapState: {},
    sessionTabs: {},
    local: {
      model: {
        selection: () => selection,
        variant: {
          list: () => (selection ? variants : []),
          set: (variant: string | undefined) => selected.push(variant),
        },
      },
    },
  } as unknown as Host
  const registry: Registry = { has: () => false, set() {}, remove() {}, active: () => true }
  const context = createPluginContext({ host, id: "test", options: undefined, owned: [], registry })
  return { selected, model: context.ui.model }
}

test("reads the selected model and its variants", () => {
  const harness = setup({ providerID: "openai", modelID: "gpt-5.5", variant: "high" }, ["low", "high"])
  expect(harness.model.current()).toEqual({ providerID: "openai", modelID: "gpt-5.5", variant: "high" })
  expect(harness.model.variant.list()).toEqual(["low", "high"])
})

test("selects listed variants or the model default", () => {
  const harness = setup({ providerID: "openai", modelID: "gpt-5.5" }, ["low", "high"])
  expect(harness.model.variant.set("high")).toBe(true)
  expect(harness.model.variant.set(undefined)).toBe(true)
  expect(harness.selected).toEqual(["high", undefined])
})

test("rejects unavailable variants and missing selections", () => {
  const harness = setup({ providerID: "openai", modelID: "gpt-5.5" }, ["low", "high"])
  expect(harness.model.variant.set("max")).toBe(false)

  const empty = setup(undefined, [])
  expect(empty.model.current()).toBeUndefined()
  expect(empty.model.variant.set(undefined)).toBe(false)
  expect([...harness.selected, ...empty.selected]).toEqual([])
})

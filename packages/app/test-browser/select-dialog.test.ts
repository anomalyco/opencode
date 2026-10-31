import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createModelSelectorController } from "@/providers/models/select-dialog"
import type { ModelSelection } from "@/providers/models/selection"
import type { ModelItem } from "@/providers/catalog/providers"

const mockModel = (id: string, providerID = "provider"): ModelItem => ({
  id,
  name: `Model ${id}`,
  provider: { id: providerID, name: `Provider ${providerID}` },
  capabilities: {
    temperature: false,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
})

test("createModelSelectorController excludes hidden models from recent and favorites", () => {
  createRoot((dispose) => {
    const alpha = mockModel("alpha")
    const beta = mockModel("beta")
    const gamma = mockModel("gamma")

    const [visible, setVisible] = createSignal<Record<string, boolean>>({
      "provider:alpha": true,
      "provider:beta": true,
      "provider:gamma": true,
    })

    const selection: ModelSelection = {
      ready: Object.assign(() => true, { promise: undefined }),
      key: () => ({ providerID: alpha.provider.id, modelID: alpha.id }),
      current: () => alpha,
      recent: () => [alpha, beta],
      favorite: {
        list: () => [beta, gamma],
        toggle() {},
      },
      list: () => [alpha, beta, gamma],
      cycle() {},
      set() {},
      visible: (key) => visible()[`${key.providerID}:${key.modelID}`] ?? true,
      setVisibility() {},
      variant: {
        configured: () => undefined,
        selected: () => undefined,
        current: () => undefined,
        list: () => [],
        set() {},
        cycle() {},
      },
    }

    const controller = createModelSelectorController({
      model: selection,
      provider: () => undefined,
      onSelect() {},
    })

    // Initially all models are visible
    expect(controller.recent().map((m) => m.id)).toEqual(["alpha", "beta"])
    expect(controller.favorites().map((m) => m.id)).toEqual(["beta", "gamma"])

    // Hide beta
    setVisible((prev) => ({ ...prev, "provider:beta": false }))

    // beta must be excluded from both recent and favorites
    expect(controller.recent().map((m) => m.id)).toEqual(["alpha"])
    expect(controller.favorites().map((m) => m.id)).toEqual(["gamma"])

    // Hide alpha (in recent) and gamma (in favorites)
    setVisible((prev) => ({ ...prev, "provider:alpha": false, "provider:gamma": false }))
    expect(controller.recent()).toEqual([])
    expect(controller.favorites()).toEqual([])

    // Unhide beta
    setVisible((prev) => ({ ...prev, "provider:beta": true }))
    expect(controller.recent().map((m) => m.id)).toEqual(["beta"])
    expect(controller.favorites().map((m) => m.id)).toEqual(["beta"])

    dispose()
  })
})

test("createModelSelectorController filters recent and favorites by provider and visibility together", () => {
  createRoot((dispose) => {
    const m1 = mockModel("m1", "p1")
    const m2 = mockModel("m2", "p2")

    const [visible, setVisible] = createSignal<Record<string, boolean>>({
      "p1:m1": true,
      "p2:m2": true,
    })

    const selection: ModelSelection = {
      ready: Object.assign(() => true, { promise: undefined }),
      key: () => ({ providerID: m1.provider.id, modelID: m1.id }),
      current: () => m1,
      recent: () => [m1, m2],
      favorite: {
        list: () => [m1, m2],
        toggle() {},
      },
      list: () => [m1, m2],
      cycle() {},
      set() {},
      visible: (key) => visible()[`${key.providerID}:${key.modelID}`] ?? true,
      setVisibility() {},
      variant: {
        configured: () => undefined,
        selected: () => undefined,
        current: () => undefined,
        list: () => [],
        set() {},
        cycle() {},
      },
    }

    const controller = createModelSelectorController({
      model: selection,
      provider: () => "p1",
      onSelect() {},
    })

    expect(controller.recent().map((m) => m.id)).toEqual(["m1"])
    expect(controller.favorites().map((m) => m.id)).toEqual(["m1"])

    // Hide m1
    setVisible((prev) => ({ ...prev, "p1:m1": false }))
    expect(controller.recent()).toEqual([])
    expect(controller.favorites()).toEqual([])

    dispose()
  })
})

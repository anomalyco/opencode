import { expect, test } from "bun:test"
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

test("createModelSelectorController filters recent and favorites by visibility and provider", () => {
  const visibleRecent = mockModel("visible-recent", "p1")
  const hiddenRecent = mockModel("hidden-recent", "p1")
  const visibleFavorite = mockModel("visible-fav", "p1")
  const hiddenFavorite = mockModel("hidden-fav", "p1")
  const otherProvider = mockModel("other", "p2")

  const hidden = new Set(["p1:hidden-recent", "p1:hidden-fav"])

  const model: ModelSelection = {
    ready: Object.assign(() => true, { promise: undefined }),
    key: () => ({ providerID: visibleRecent.provider.id, modelID: visibleRecent.id }),
    current: () => visibleRecent,
    recent: () => [visibleRecent, hiddenRecent, otherProvider],
    favorite: {
      list: () => [visibleFavorite, hiddenFavorite, otherProvider],
      toggle() {},
    },
    list: () => [visibleRecent, hiddenRecent, visibleFavorite, hiddenFavorite, otherProvider],
    cycle() {},
    set() {},
    visible: (key) => !hidden.has(`${key.providerID}:${key.modelID}`),
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

  // Without provider scope: hidden models are excluded, others remain
  const all = createModelSelectorController({ model, provider: () => undefined, onSelect() {} })
  expect(all.recent().map((m) => m.id)).toEqual(["visible-recent", "other"])
  expect(all.favorites().map((m) => m.id)).toEqual(["visible-fav", "other"])

  // With provider scope: only matching visible models remain
  const scoped = createModelSelectorController({ model, provider: () => "p1", onSelect() {} })
  expect(scoped.recent().map((m) => m.id)).toEqual(["visible-recent"])
  expect(scoped.favorites().map((m) => m.id)).toEqual(["visible-fav"])
})

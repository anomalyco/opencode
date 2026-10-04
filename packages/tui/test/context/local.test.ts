import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { expect, test } from "bun:test"
import { recentModels } from "../../src/model-preference"

test("moves a model to the front, deduplicates, and limits recents", () => {
  const recent = Array.from({ length: 12 }, (_, index) => ({
    providerID: Provider.ID.make("provider", { disableChecks: true }),
    modelID: Model.ID.make(`model-${index}`, { disableChecks: true }),
  }))

  expect(
    recentModels(
      {
        providerID: Provider.ID.make("provider", { disableChecks: true }),
        modelID: Model.ID.make("model-5", { disableChecks: true }),
      },
      recent,
    ),
  ).toEqual([
    {
      providerID: Provider.ID.make("provider", { disableChecks: true }),
      modelID: Model.ID.make("model-5", { disableChecks: true }),
    },
    ...recent.slice(0, 5),
    ...recent.slice(6, 10),
  ])
})

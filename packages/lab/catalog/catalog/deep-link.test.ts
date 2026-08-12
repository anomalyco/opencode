import { describe, expect, test } from "bun:test"
import { catalogBrowseUrl, readCatalogLocation } from "../src/deep-link"

describe("catalog deep links", () => {
  test("round-trips filters and removes an open viewer", () => {
    const url = catalogBrowseUrl(
      {
        variantId: "baseline",
        mode: "ui-elements",
        query: "session",
        screenLabels: [],
        uiElements: ["dialog", "tabs"],
        surfaces: ["modal"],
        patterns: [],
        features: ["session"],
        states: ["default", "running"],
      },
      new URL("https://catalog.example/?screen=session-picker&flow=sessions"),
    )

    expect(url).toBe(
      "https://catalog.example/?set=baseline&mode=ui-elements&q=session&ui-element=dialog&ui-element=tabs&surface=modal&feature=session&state=default&state=running",
    )
    expect(readCatalogLocation(new URL(url))).toMatchObject({
      variantId: "baseline",
      mode: "ui-elements",
      query: "session",
      uiElements: ["dialog", "tabs"],
      surfaces: ["modal"],
      features: ["session"],
      states: ["default", "running"],
    })
  })
})

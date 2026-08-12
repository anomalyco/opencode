import { describe, expect, test } from "bun:test"
import { assetPath } from "../worker"

describe("catalog worker", () => {
  test("serves the app shell for catalog routes", () => {
    expect(assetPath("/lab/catalog")).toBe("/index.html")
    expect(assetPath("/lab/catalog/")).toBe("/index.html")
    expect(assetPath("/lab/catalog/deep-link")).toBe("/index.html")
  })

  test("strips the catalog prefix from assets", () => {
    expect(assetPath("/lab/catalog/catalog.json")).toBe("/catalog.json")
    expect(assetPath("/lab/catalog/captures/opencode/home.frame.json")).toBe(
      "/captures/opencode/home.frame.json",
    )
  })
})

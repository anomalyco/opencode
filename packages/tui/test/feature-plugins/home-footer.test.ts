import { describe, expect, test } from "bun:test"
import { homeFooterHeight, homeFooterVisibility } from "../../src/ui/layout"

describe("home footer visibility", () => {
  test("keeps failure labels readable at the minimum supported width", () => {
    expect(homeFooterVisibility(44)).toEqual({ mcpCommand: false, pluginCommand: false, version: false })
  })

  test("adds secondary hints as space becomes available", () => {
    expect(homeFooterVisibility(64)).toEqual({ mcpCommand: true, pluginCommand: false, version: true })
    expect(homeFooterVisibility(80)).toEqual({ mcpCommand: true, pluginCommand: true, version: true })
  })
})

test("home footer height matches its responsive visibility and padding", () => {
  expect(homeFooterHeight(43, 30)).toBe(0)
  expect(homeFooterHeight(44, 11)).toBe(0)
  expect(homeFooterHeight(44, 12)).toBe(1)
  expect(homeFooterHeight(44, 15)).toBe(1)
  expect(homeFooterHeight(44, 16)).toBe(3)
})

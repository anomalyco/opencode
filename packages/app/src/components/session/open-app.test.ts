import { describe, expect, test } from "bun:test"
import { getOpenPlan } from "./open-app"

describe("open app plan", () => {
  test("routes wezterm through editor integration when available", () => {
    expect(getOpenPlan("wezterm", [{ id: "wezterm", openWith: "WezTerm" }], true)).toEqual({
      kind: "editor",
      editor: "WezTerm",
    })
  })

  test("falls back to openPath when editor integration is unavailable", () => {
    expect(getOpenPlan("wezterm", [{ id: "wezterm", openWith: "WezTerm" }], false)).toEqual({
      kind: "path",
      app: "WezTerm",
    })
  })

  test("keeps other apps on openPath", () => {
    expect(getOpenPlan("ghostty", [{ id: "ghostty", openWith: "Ghostty" }], true)).toEqual({
      kind: "path",
      app: "Ghostty",
    })
  })
})

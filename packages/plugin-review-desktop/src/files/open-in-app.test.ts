import { describe, expect, test } from "bun:test"
import { OPEN_APPS, openAppPreference } from "./open-in-app"

describe("open app preferences", () => {
  test.each([...OPEN_APPS])("preserves the %s preference", (app) => {
    expect(openAppPreference(app)).toBe(app)
  })
  test.each([undefined, null, 42, "unknown", {}])("defaults invalid selection %p", (app) => {
    expect(openAppPreference(app)).toBe("finder")
  })
})

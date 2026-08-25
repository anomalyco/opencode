import { describe, expect, test } from "bun:test"
import { migrateSettings } from "./model"

describe("settings migration", () => {
  test("keeps steer for existing users without a follow-up preference", () => {
    expect(migrateSettings({ general: { autoSave: true } })).toEqual({
      general: { autoSave: true, followUpBehavior: "steer" },
    })
  })

  test("preserves an explicit follow-up preference", () => {
    const settings = { general: { followUpBehavior: "queue" } }
    expect(migrateSettings(settings)).toBe(settings)
  })
})

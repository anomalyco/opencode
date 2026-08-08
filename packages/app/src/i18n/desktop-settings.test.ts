import { describe, expect, test } from "bun:test"
import { DESKTOP_NATIVE_LOCALES } from "./desktop-native"
import { KEEP_AWAKE_COPY, desktopSettingsDict } from "./desktop-settings"

describe("desktop settings translations", () => {
  test("keep-awake copy covers every supported locale", () => {
    expect(Object.keys(KEEP_AWAKE_COPY).sort()).toEqual([...DESKTOP_NATIVE_LOCALES].sort())
  })

  test("every keep-awake translation has a title and description", () => {
    for (const locale of DESKTOP_NATIVE_LOCALES) {
      const dict = desktopSettingsDict(locale)
      expect(dict["settings.general.row.keepAwake.title"].trim().length).toBeGreaterThan(0)
      expect(dict["settings.general.row.keepAwake.description"].trim().length).toBeGreaterThan(0)
    }
  })
})

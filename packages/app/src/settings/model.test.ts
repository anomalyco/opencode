import { describe, expect, test } from "bun:test"
import { migrateSettings, monoDefault, monoFontFamily, sansDefault, sansFontFamily, terminalFontFamily } from "./model"

describe("settings reasoning mode migration", () => {
  test.each([
    [true, "full"],
    [false, "compact"],
  ])("maps persisted reasoning summaries %s to %s", (showReasoningSummaries, reasoningMode) => {
    const value = { general: { showReasoningSummaries, showTerminal: true }, appearance: { fontSize: 16 } }
    expect(migrateSettings(value)).toEqual({
      ...value,
      general: { ...value.general, reasoningMode },
    })
    expect(value.general).not.toHaveProperty("reasoningMode")
  })

  test.each(["hidden", "compact", "full"])(
    "preserves an explicit %s mode over either legacy value",
    (reasoningMode) => {
      ;[true, false].forEach((showReasoningSummaries) => {
        const value = { general: { reasoningMode, showReasoningSummaries } }
        expect(migrateSettings(value)).toBe(value)
      })
    },
  )

  test.each([undefined, null, {}, { general: {} }])("leaves missing legacy settings to the defaults: %j", (value) => {
    expect(migrateSettings(value)).toBe(value)
  })
})

describe("settings font families", () => {
  test("defaults normal text to Inter", () => {
    expect(sansDefault).toBe("Inter")
    expect(sansFontFamily(undefined)).toStartWith('"Inter", ')
    expect(sansFontFamily("")).toStartWith('"Inter", ')
    expect(sansFontFamily("   ")).toStartWith('"Inter", ')
  })

  test("keeps custom normal fonts ahead of the default", () => {
    expect(sansFontFamily("Custom Sans")).toStartWith('"Custom Sans", "Inter", ')
  })

  test("defaults monospace text to IBM Plex Mono", () => {
    expect(monoDefault).toBe("IBM Plex Mono")
    expect(monoFontFamily(undefined)).toStartWith('"IBM Plex Mono", ')
    expect(monoFontFamily("")).toStartWith('"IBM Plex Mono", ')
    expect(monoFontFamily("   ")).toStartWith('"IBM Plex Mono", ')
  })

  test("keeps custom monospace fonts ahead of the default", () => {
    expect(monoFontFamily("Custom Mono")).toStartWith('"Custom Mono", "IBM Plex Mono", ')
  })

  test("preserves the separate terminal font default", () => {
    expect(terminalFontFamily(undefined)).toStartWith('"JetBrainsMono Nerd Font Mono", ')
  })
})

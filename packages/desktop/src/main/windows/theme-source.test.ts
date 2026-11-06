import { describe, expect, test } from "bun:test"
import { isColorSchemeSignal, nextRetry, parsePortalColorScheme, resolveThemeSource } from "./theme-source"

describe("theme source", () => {
  const resolution = [
    ["system", "dark", "dark"],
    ["system", "light", "light"],
    ["system", null, "system"],
    [undefined, "dark", "dark"],
    [undefined, null, "system"],
    ["light", "dark", "light"],
    ["dark", "light", "dark"],
  ] as const

  test.each(resolution)("resolveThemeSource(%p, %p) = %p", (scheme, portal, expected) => {
    expect(resolveThemeSource(scheme, portal)).toBe(expected)
  })

  const parsing = [
    ["(<uint32 0>,)\n", null],
    ["(<uint32 1>,)\n", "dark"],
    ["(<uint32 2>,)\n", "light"],
    ["garbage", null],
  ] as const

  test.each(parsing)("parsePortalColorScheme(%p) = %p", (input, expected) => {
    expect(parsePortalColorScheme(input)).toBe(expected)
  })

  const signals = [
    [
      "/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged ('org.freedesktop.appearance', 'color-scheme', <uint32 1>)",
      true,
    ],
    [
      "/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged ('org.gnome.desktop.interface', 'color-scheme', <'default'>)",
      false,
    ],
    [
      "/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged ('org.gnome.desktop.interface', 'gtk-theme', <'Breeze'>)",
      false,
    ],
  ] as const

  test.each(signals)("isColorSchemeSignal(%p) = %p", (line, expected) => {
    expect(isColorSchemeSignal(line)).toBe(expected)
  })

  const retries = [
    [0, 1000, { quickExits: 1, delayMs: 10_000 }],
    [1, 1000, { quickExits: 2, delayMs: 20_000 }],
    [2, 1000, { quickExits: 3, delayMs: null }],
    [2, 15_000, { quickExits: 0, delayMs: 0 }],
  ] as const

  test.each(retries)("nextRetry(quickExits=%p, lived=%p) = %p", (quickExits, livedMs, expected) => {
    expect(nextRetry(quickExits, livedMs)).toEqual(expected)
  })
})

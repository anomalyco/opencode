import { describe, expect, test } from "bun:test"
import { parseSiteSettings, siteSettingsDefaults } from "../src/component/site/settings"
import { parseTransfer, transferJson } from "../src/component/site/transfer"

describe("settings export", () => {
  const settings = {
    ...structuredClone(siteSettingsDefaults),
    heroSize: 120,
    carouselPreset: "custom" as const,
    carousel: { xl: 3, lg: 3, md: 2, sm: 1, xs: 1 },
    logoTuning: {
      ...siteSettingsDefaults.logoTuning,
      flip: { ...siteSettingsDefaults.logoTuning.flip, duration: 500 },
    },
    arcade3d: { bloom: 0.4 },
  }
  const designCopy = { choice: { "home.logos.label": 2 }, custom: { "home.logos.label": ["Hi"] } }

  test("round-trips every setting, the copy and the theme", () => {
    const text = transferJson({ settings, designCopy, theme: "dark" })
    const data = parseTransfer(text)
    expect(data?.theme).toBe("dark")
    expect(data?.designCopy).toEqual(designCopy)
    expect(parseSiteSettings(data?.settings)).toEqual(settings)
    expect(transferJson({ settings: parseSiteSettings(data?.settings), designCopy, theme: "dark" })).toBe(text)
  })

  test("falls back per key", () => {
    const data = parseTransfer(transferJson({ settings: { heroSize: 120, nav: "nope" }, designCopy, theme: "dark" }))
    const parsed = parseSiteSettings(data?.settings)
    expect(parsed?.heroSize).toBe(120)
    expect(parsed?.nav).toBe(siteSettingsDefaults.nav)
  })

  test("accepts a bare settings object", () => {
    expect(parseSiteSettings(parseTransfer(JSON.stringify({ heroSize: 80 }))?.settings)?.heroSize).toBe(80)
  })

  test("rejects text that is not an export", () => {
    expect(parseTransfer("not json")).toBeUndefined()
    expect(parseTransfer("[1]")).toBeUndefined()
    expect(parseTransfer(JSON.stringify({ version: 2, settings: {} }))).toBeUndefined()
    expect(parseSiteSettings(parseTransfer(JSON.stringify({ foo: 1 }))?.settings)).toBeUndefined()
  })
})

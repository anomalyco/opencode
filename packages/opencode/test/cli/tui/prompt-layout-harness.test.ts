import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  promptBarAnimationEnabled,
  promptBarBackground,
  promptBarBottomLeft,
  promptBarLayoutHeight,
  promptBarLayoutSpec,
  promptBarPluginEnabled,
  promptBarResetEnabled,
  promptBarSurface,
  promptBarUseLegacyLayoutForTheme,
  promptBarUseLegacyLayout,
} from "../../../src/cli/cmd/tui/util/prompt-bar-layout-policy"

describe("prompt bar layout policy", () => {
  test("enables animation from config or runtime override", () => {
    expect(promptBarAnimationEnabled(undefined, false)).toBe(false)
    expect(promptBarAnimationEnabled(false, false)).toBe(false)
    expect(promptBarAnimationEnabled(true, false)).toBe(true)
    expect(promptBarAnimationEnabled(undefined, true)).toBe(true)
    expect(promptBarAnimationEnabled(false, true)).toBe(true)
  })

  test("uses legacy layout for disabled or state-static mode", () => {
    expect(promptBarUseLegacyLayout(false, "legacy-cycle")).toBe(true)
    expect(promptBarUseLegacyLayout(true, "state-static")).toBe(true)
    expect(promptBarUseLegacyLayout(true, "legacy-cycle")).toBe(false)
    expect(promptBarUseLegacyLayout(true, "theme-wave")).toBe(false)
  })

  test("forces legacy layout in unthemed mode even when plugin is enabled", () => {
    const transparent = RGBA.fromInts(10, 20, 30, 0)
    const opaque = RGBA.fromInts(10, 20, 30, 255)

    expect(promptBarUseLegacyLayoutForTheme(true, "legacy-cycle", transparent)).toBe(true)
    expect(promptBarUseLegacyLayoutForTheme(true, "theme-wave", transparent)).toBe(true)
    expect(promptBarUseLegacyLayoutForTheme(true, "legacy-cycle", opaque)).toBe(false)
  })

  test("unthemed mode ignores plugin overlay and keeps legacy surface", () => {
    const transparent = RGBA.fromInts(10, 20, 30, 0)
    const overlay = RGBA.fromInts(200, 10, 10, 255)
    const useLegacyLayout = promptBarUseLegacyLayoutForTheme(true, "theme-wave", transparent)
    const background = promptBarBackground({
      useLegacyLayout,
      overlay,
      background: transparent,
    })
    const surface = promptBarSurface({
      useLegacyLayout,
      background,
      chromeVisible: false,
    })

    expect(surface.shellBackground).toBeUndefined()
    expect(surface.contentBackground).toEqual(transparent)
    expect(surface.separatorBackground).toBeUndefined()
    expect(surface.separatorBorderColor).toEqual(transparent)
    expect(surface.separatorVertical).toBe(" ")
    expect(surface.separatorHorizontal).toBe(" ")
  })

  test("enables plugin effects only for non-legacy layout", () => {
    expect(promptBarPluginEnabled(true)).toBe(false)
    expect(promptBarPluginEnabled(false)).toBe(true)
  })

  test("falls back to base background when overlay is unavailable", () => {
    const base = RGBA.fromInts(10, 20, 30, 255)
    const overlay = RGBA.fromInts(40, 50, 60, 255)

    expect(
      promptBarBackground({
        useLegacyLayout: true,
        overlay,
        background: base,
      }),
    ).toEqual(base)

    expect(
      promptBarBackground({
        useLegacyLayout: false,
        overlay: undefined,
        background: base,
      }),
    ).toEqual(base)

    expect(
      promptBarBackground({
        useLegacyLayout: false,
        overlay,
        background: base,
      }),
    ).toEqual(overlay)
  })

  test("keeps reset command available while runtime override is active", () => {
    expect(promptBarResetEnabled("legacy-cycle", "legacy-cycle", false)).toBe(false)
    expect(promptBarResetEnabled("legacy-cycle", "legacy-cycle", true)).toBe(true)
    expect(promptBarResetEnabled("theme-wave", "legacy-cycle", false)).toBe(true)
  })

  test("uses one shared background color for content and bottom separator", () => {
    const base = RGBA.fromInts(10, 20, 30, 255)
    const overlay = RGBA.fromInts(40, 50, 60, 255)
    const background = promptBarBackground({
      useLegacyLayout: false,
      overlay,
      background: base,
    })
    const surface = promptBarSurface({
      useLegacyLayout: false,
      background,
      chromeVisible: true,
    })

    expect(surface.shellBackground).toEqual(overlay)
    expect(surface.contentBackground).toEqual(overlay)
    expect(surface.separatorBackground).toEqual(overlay)
    expect(surface.separatorBorderColor).toEqual(overlay)
  })

  test("matches legacy separator surface behavior from v1.2.18", () => {
    const base = RGBA.fromInts(10, 20, 30, 255)
    const legacy = promptBarSurface({
      useLegacyLayout: true,
      background: base,
      chromeVisible: true,
    })

    expect(legacy.shellBackground).toBeUndefined()
    expect(legacy.contentBackground).toEqual(base)
    expect(legacy.separatorBackground).toBeUndefined()
    expect(legacy.separatorBorderColor).toEqual(base)
    expect(legacy.separatorVertical).toBe("╹")
    expect(legacy.separatorHorizontal).toBe("▀")
  })

  test("keeps separator glyph visibility tied to theme chrome visibility", () => {
    const base = RGBA.fromInts(10, 20, 30, 255)
    const visible = promptBarSurface({
      useLegacyLayout: false,
      background: base,
      chromeVisible: true,
    })
    const hidden = promptBarSurface({
      useLegacyLayout: false,
      background: base,
      chromeVisible: false,
    })
    const legacyHidden = promptBarSurface({
      useLegacyLayout: true,
      background: base,
      chromeVisible: false,
    })

    expect(visible.separatorVertical).toBe("╹")
    expect(visible.separatorHorizontal).toBe("▀")
    expect(hidden.separatorVertical).toBe(" ")
    expect(hidden.separatorHorizontal).toBe(" ")
    expect(legacyHidden.separatorVertical).toBe(" ")
    expect(legacyHidden.separatorHorizontal).toBe(" ")
  })

  test("keeps bottom-left corner glyph in all modes", () => {
    expect(promptBarBottomLeft(true)).toBe("╹")
    expect(promptBarBottomLeft(false)).toBe("╹")
  })

  test("encodes v1.2.18 prompt geometry constants", () => {
    const layout = promptBarLayoutSpec()
    expect(layout.content_padding_left).toBe(2)
    expect(layout.content_padding_right).toBe(2)
    expect(layout.content_padding_top).toBe(1)
    expect(layout.textarea_min_height).toBe(1)
    expect(layout.textarea_max_height).toBe(6)
    expect(layout.footer_padding_top).toBe(1)
    expect(layout.footer_row_height).toBe(1)
    expect(layout.separator_height).toBe(1)
    expect(layout.status_row_height).toBe(1)
    expect(promptBarLayoutHeight(layout)).toEqual({ min: 6, max: 11 })
  })

  test("prompt component wires prompt layout through shared spec", async () => {
    const source = await Bun.file(
      new URL("../../../src/cli/cmd/tui/component/prompt/index.tsx", import.meta.url),
    ).text()
    expect(source.includes("promptBarLayoutSpec")).toBe(true)
    expect(source.includes("promptBarUseLegacyLayoutForTheme")).toBe(true)
    expect(source.includes("chromeVisible: theme.backgroundElement.a !== 0")).toBe(true)
  })
})

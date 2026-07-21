import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { RGBA } from "@opentui/core"
import { createComponentTheme } from "../../../src/theme/v2/component"
import { DEFAULT_THEME } from "../../../src/theme/v2/defaults"
import { resolveTheme } from "../../../src/theme/v2/resolve"
import { selectTheme } from "../../../src/theme/v2/select"
import type { ContextKey } from "../../../src/theme/v2"

test("provides reactive properties, states, contexts, and color operations", () => {
  const [resolved, setResolved] = createSignal(resolveTheme(selectTheme(DEFAULT_THEME, "light")))
  const [mode, setMode] = createSignal<"light" | "dark">("light")
  const [context, setContext] = createSignal<ContextKey>()
  const theme = createComponentTheme(() => {
    const key = context()
    return key ? (resolved().contexts[key] ?? resolved()) : resolved()
  }, mode)

  expect(theme.text.default).toBe(resolved().text.default)
  expect(theme.hue.accent[500]).toBe(resolved().hue.accent[500])
  expect(theme.hue.interactive[500]).toBe(resolved().hue.interactive[500])
  expect(theme.hue.gray[200]).toBe(resolved().hue.gray[200])
  expect(theme.categorical.map((scale) => scale[500])).toEqual(resolved().categorical.map((scale) => scale[500]))
  expect(theme.increase(theme.background.surface.offset, 1)).toBe(resolved().hue.neutral[400])
  expect(theme.raise(theme.background.surface.offset)).toBe(resolved().hue.neutral[400])
  expect(theme.decrease(theme.hue.red[300], 2)).toBe(resolved().hue.red[100])
  expect(theme.increase(theme.hue.red[900], 3)).toBe(resolved().hue.red[900])
  expect(theme.decrease(theme.hue.red[100], 3)).toBe(resolved().hue.red[100])
  expect(theme.source(theme.background.surface.offset)).toEqual({ hue: "neutral", step: 300 })
  const equivalent = RGBA.fromInts(...resolved().hue.green[500].toInts())
  expect(theme.source(equivalent)).toBeUndefined()
  expect(theme.increase(equivalent, 1)).toBe(equivalent)
  const unmatched = RGBA.fromInts(1, 2, 3)
  expect(theme.increase(unmatched, 1)).toBe(unmatched)
  expect(theme.text.subdued).toBe(resolved().text.subdued)
  expect(theme.text.action.primary.default).toBe(resolved().text.action.primary.default)
  expect(theme.text.action.primary.hovered).toBe(resolved().text.action.primary.hovered)
  expect(theme.text.action.primary.pressed).toBe(resolved().text.action.primary.pressed)
  expect(theme.text.action.primary.selected).toBe(resolved().text.action.primary.selected)
  expect(theme.background.action.primary.selected).toBe(resolved().background.action.primary.selected)
  expect(theme.background.action.primary.hovered).toBe(resolved().background.action.primary.hovered)
  expect(theme.background.action.primary.focused).toBe(resolved().background.action.primary.focused)
  expect(theme.background.action.primary.pressed).toBe(resolved().background.action.primary.pressed)
  expect(theme.background.action.primary.disabled).toBe(resolved().background.action.primary.disabled)
  expect(theme.background.action.primary.default).toBe(resolved().background.action.primary.default)
  expect(theme.background.action.destructive.disabled).toBe(resolved().background.action.destructive.disabled)
  expect(theme.background.formfield.hovered).toBe(resolved().background.formfield.hovered)
  expect(theme.background.formfield.selected).toBe(resolved().background.formfield.selected)
  expect(theme.background.formfield.focused).toBe(resolved().background.formfield.focused)
  expect(theme.background.formfield.disabled).toBe(resolved().background.formfield.disabled)
  expect(theme.background.surface.offset).toBe(resolved().background.surface.offset)
  expect(theme.background.surface.overlay).toBe(resolved().background.surface.overlay)
  expect(theme.scrollbar.default).toBe(resolved().scrollbar.default)
  expect(theme.diff.text.added).toBe(resolved().diff.text.added)

  setContext("@context:elevated")
  expect(theme.categorical.map((scale) => scale[500])).toEqual(resolved().categorical.map((scale) => scale[500]))
  expect(theme.text.default).toBe(resolved().contexts["@context:elevated"]!.text.default)
  expect(theme.background.action.primary.focused).toBe(
    resolved().contexts["@context:elevated"]!.background.action.primary.focused,
  )
  expect(theme.background.action.primary.hovered).toBe(resolved().background.surface.overlay)
  expect(theme.background.formfield.selected).toBe(
    resolved().contexts["@context:elevated"]!.background.formfield.selected,
  )

  setResolved(resolveTheme(selectTheme(DEFAULT_THEME, "dark")))
  setMode("dark")
  expect(theme.text.default).toBe(resolved().contexts["@context:elevated"]!.text.default)
  expect(theme.decrease(theme.background.surface.offset, 1)).toBe(resolved().hue.neutral[600])
  expect(theme.raise(theme.background.surface.offset)).toBe(resolved().hue.neutral[600])
})

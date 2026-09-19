import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { RGBA } from "@opentui/core"
import { resolveTheme, selectTheme } from "@opencode/theme/tui"
import { createComponentTheme } from "../../../src/theme/component"
import { getOpenCodeTheme } from "../../../src/theme"

test("provides reactive properties, states, surfaces, and color operations", () => {
  const [resolved, setResolved] = createSignal(resolveTheme(selectTheme(getOpenCodeTheme(), "light")))
  const theme = createComponentTheme(resolved)
  const current = theme.surface("dialog")

  expect(theme.text.base).toBe(resolved().text.base)
  expect(theme.hue.accent[500]).toBe(resolved().hue.accent[500])
  expect(theme.hue.interactive[500]).toBe(resolved().hue.interactive[500])
  expect(theme.hue.gray[200]).toBe(resolved().hue.gray[200])
  expect(theme.categorical.map((scale) => scale[500])).toEqual(resolved().categorical.map((scale) => scale[500]))
  expect(theme.increase(theme.background.raised.base, 1)).toBe(resolved().hue.neutral[800])
  expect(theme.decrease(theme.background.raised.base)).toBe(resolved().hue.neutral[600])
  expect(theme.decrease(theme.hue.red[300], 2)).toBe(resolved().hue.red[100])
  expect(theme.increase(theme.hue.red[900], 3)).toBe(resolved().hue.red[900])
  expect(theme.decrease(theme.hue.red[100], 3)).toBe(resolved().hue.red[100])
  expect(theme.source(theme.background.raised.base)).toEqual({ hue: "neutral", step: 700 })
  const equivalent = RGBA.fromInts(...resolved().hue.green[500].toInts())
  expect(theme.source(equivalent)).toBeUndefined()
  expect(theme.increase(equivalent, 1)).toBe(equivalent)
  const unmatched = RGBA.fromInts(1, 2, 3)
  expect(theme.increase(unmatched, 1)).toBe(unmatched)
  expect(theme.text.muted).toBe(resolved().text.muted)
  expect(theme.text.action.primary.base).toBe(resolved().text.action.primary.base)
  expect(theme.text.action.primary.hovered).toBe(resolved().text.action.primary.hovered)
  expect(theme.text.action.primary.pressed).toBe(resolved().text.action.primary.pressed)
  expect(theme.text.action.primary.selected).toBe(resolved().text.action.primary.selected)
  expect(theme.background.action.primary.selected).toBe(resolved().background.action.primary.selected)
  expect(theme.background.action.primary.hovered).toBe(resolved().background.action.primary.hovered)
  expect(theme.background.action.primary.focused).toBe(resolved().background.action.primary.focused)
  expect(theme.background.action.primary.pressed).toBe(resolved().background.action.primary.pressed)
  expect(theme.background.action.primary.disabled).toBe(resolved().background.action.primary.disabled)
  expect(theme.background.action.primary.base).toBe(resolved().background.action.primary.base)
  expect(
    theme.background.action.primary.state({
      disabled: true,
      pressed: true,
      focused: true,
      selected: true,
      hovered: true,
    }),
  ).toBe(theme.background.action.primary.disabled)
  expect(theme.background.action.primary.state({ pressed: true, focused: true, selected: true, hovered: true })).toBe(
    theme.background.action.primary.pressed,
  )
  expect(theme.background.action.primary.state({ focused: true, selected: true, hovered: true })).toBe(
    theme.background.action.primary.focused,
  )
  expect(theme.background.action.primary.state({ selected: true, hovered: true })).toBe(
    theme.background.action.primary.selected,
  )
  expect(theme.background.action.primary.state({ hovered: true })).toBe(theme.background.action.primary.hovered)
  expect(theme.background.action.primary.state({ disabled: false, hovered: false })).toBe(
    theme.background.action.primary.base,
  )
  expect(theme.text.formfield.state({ focused: true, selected: true })).toBe(theme.text.formfield.focused)
  expect(theme.background.action.destructive.disabled).toBe(resolved().background.action.destructive.disabled)
  expect(theme.background.formfield.hovered).toBe(resolved().background.formfield.hovered)
  expect(theme.background.formfield.selected).toBe(resolved().background.formfield.selected)
  expect(theme.background.formfield.focused).toBe(resolved().background.formfield.focused)
  expect(theme.background.formfield.disabled).toBe(resolved().background.formfield.disabled)
  expect(theme.background.raised.base).toBe(resolved().background.raised.base)
  expect(theme.background.raised.high).toBe(resolved().background.raised.high)
  expect(theme.scrollbar.base).toBe(resolved().scrollbar.base)
  expect(theme.diff.text.added).toBe(resolved().diff.text.added)

  expect(theme.surface("dialog")).toBe(current)
  expect(current.surface("dialog")).toBe(current)
  expect(current.categorical.map((scale) => scale[500])).toEqual(resolved().categorical.map((scale) => scale[500]))
  expect(current.text.base).toBe(resolved().surface("dialog").text.base)
  expect(current.background.base).toBe(resolved().background.raised.base)
  expect(current.background.action.primary.focused).toBe(resolved().surface("dialog").background.action.primary.focused)
  expect(current.background.action.primary.hovered).toBe(resolved().background.raised.high)
  expect(current.background.formfield.selected).toBe(resolved().surface("dialog").background.formfield.selected)

  setResolved(resolveTheme(selectTheme(getOpenCodeTheme(), "dark")))
  expect(current.text.base).toBe(resolved().surface("dialog").text.base)
  expect(current.background.base).toBe(resolved().background.raised.base)
  expect(current.decrease(current.background.raised.base, 1)).toBe(resolved().hue.neutral[600])
  expect(current.decrease(current.background.raised.base)).toBe(resolved().hue.neutral[600])
})

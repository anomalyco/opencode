import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { createComponentTheme } from "../../../src/theme/v2/component"
import { DEFAULT_THEME } from "../../../src/theme/v2/defaults"
import { resolveTheme } from "../../../src/theme/v2/resolve"
import { selectTheme } from "../../../src/theme/v2/select"
import type { ContextKey } from "../../../src/theme/v2"

test("provides reactive property, variant, state, and context accessors", () => {
  const [resolved, setResolved] = createSignal(resolveTheme(selectTheme(DEFAULT_THEME, "light")))
  const [context, setContext] = createSignal<ContextKey>()
  const theme = createComponentTheme(() => {
    const key = context()
    return key ? resolved().contexts[key] ?? resolved() : resolved()
  })

  expect(theme.text()).toBe(resolved().text.default)
  expect(theme.hue.accent(500)).toBe(resolved().hue.accent[500])
  expect(theme.hue.gray(200)).toBe(resolved().hue.gray[200])
  expect(theme.text.subdued()).toBe(resolved().text.subdued)
  expect(theme.text.action()).toBe(resolved().text.action.primary.default)
  expect(theme.text.action.primary("pressed")).toBe(resolved().text.action.primary.pressed)
  expect(theme.background.action.secondary("disabled")).toBe(
    resolved().background.action.secondary.disabled,
  )
  expect(theme.background.surface.offset()).toBe(resolved().background.surface.offset)
  expect(theme.background.surface.overlay()).toBe(resolved().background.surface.overlay)
  expect(theme.scrollbar()).toBe(resolved().scrollbar.default)
  expect(theme.diff.text.added()).toBe(resolved().diff.text.added)

  setContext("@context:elevated")
  expect(theme.text()).toBe(resolved().contexts["@context:elevated"]!.text.default)
  expect(theme.background.action.primary("focused")).toBe(
    resolved().contexts["@context:elevated"]!.background.action.primary.focused,
  )
  expect(theme.background.formfield("selected")).toBe(
    resolved().contexts["@context:elevated"]!.background.formfield.selected,
  )

  setResolved(resolveTheme(selectTheme(DEFAULT_THEME, "dark")))
  expect(theme.text()).toBe(resolved().contexts["@context:elevated"]!.text.default)
})

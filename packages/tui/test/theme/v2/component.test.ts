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

  expect(theme.color.text()).toBe(resolved().color.text.default)
  expect(theme.color.text.subdued()).toBe(resolved().color.text.subdued)
  expect(theme.color.text.action()).toBe(resolved().color.text.action.primary.default)
  expect(theme.color.text.action.primary("pressed")).toBe(resolved().color.text.action.primary.pressed)
  expect(theme.color.background.action.secondary("disabled")).toBe(
    resolved().color.background.action.secondary.disabled,
  )
  expect(theme.color.scrollbar()).toBe(resolved().color.scrollbar.default)
  expect(theme.color.diff.text.added()).toBe(resolved().color.diff.text.added)

  setContext("@context:elevated")
  expect(theme.color.text()).toBe(resolved().contexts["@context:elevated"]!.color.text.default)
  expect(theme.color.background.action.primary("selected")).toBe(
    resolved().contexts["@context:elevated"]!.color.background.action.primary.selected,
  )

  setResolved(resolveTheme(selectTheme(DEFAULT_THEME, "dark")))
  expect(theme.color.text()).toBe(resolved().contexts["@context:elevated"]!.color.text.default)
})

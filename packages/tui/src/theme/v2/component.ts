import type { RGBA } from "@opentui/core"
import type { Accessor } from "solid-js"
import type { Mode, ResolvedThemeView } from "./index"

export function createComponentTheme(current: Accessor<ResolvedThemeView>, mode: Accessor<Mode>) {
  return {
    get hue() {
      return current().hue
    },
    get categorical() {
      return current().categorical
    },
    get text() {
      return current().text
    },
    get background() {
      return current().background
    },
    get border() {
      return current().border
    },
    get scrollbar() {
      return current().scrollbar
    },
    get diff() {
      return current().diff
    },
    get syntax() {
      return current().syntax
    },
    get markdown() {
      return current().markdown
    },
    source: (color: RGBA) => current().source(color),
    increase: (color: RGBA, amount = 1) => current().increase(color, amount),
    decrease: (color: RGBA, amount = 1) => current().decrease(color, amount),
    raise: (color: RGBA) => (mode() === "light" ? current().increase(color) : current().decrease(color)),
  }
}

export type ComponentTheme = ReturnType<typeof createComponentTheme>

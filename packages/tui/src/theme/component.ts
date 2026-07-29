import type { RGBA } from "@opentui/core"
import type { Accessor } from "solid-js"
import type { Mode, ResolvedTheme, ResolvedThemeTokens } from "@opencode-ai/theme/tui"

export function createComponentTheme(current: Accessor<ResolvedTheme>, mode: Accessor<Mode>) {
  const create = (view: Accessor<ResolvedThemeTokens>) => ({
    get hue() {
      return view().hue
    },
    get categorical() {
      return view().categorical
    },
    get text() {
      return view().text
    },
    get background() {
      return view().background
    },
    get border() {
      return view().border
    },
    get scrollbar() {
      return view().scrollbar
    },
    get diff() {
      return view().diff
    },
    get syntax() {
      return view().syntax
    },
    get markdown() {
      return view().markdown
    },
    source: (color: RGBA) => view().source(color),
    increase: (color: RGBA, amount = 1) => view().increase(color, amount),
    decrease: (color: RGBA, amount = 1) => view().decrease(color, amount),
    raise: (color: RGBA) => (mode() === "light" ? view().increase(color) : view().decrease(color)),
  })

  return Object.assign(create(current), {
    contextual: {
      elevated: create(() => current().contextual.elevated),
      overlay: create(() => current().contextual.overlay),
    },
  })
}

export type ComponentTheme = ReturnType<typeof createComponentTheme>

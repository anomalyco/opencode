import type { RGBA } from "@opentui/core"
import type { Accessor } from "solid-js"
import type { ResolvedTheme, SurfaceName } from "@opencode/theme/tui"

export function createComponentTheme(
  view: Accessor<ResolvedTheme>,
  // Shared across a theme's surface views so `surface()` stays absolute at the wrapper level too.
  surfaces = new Map<SurfaceName, ComponentTheme>(),
): ComponentTheme {
  return {
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
    surface(name: SurfaceName) {
      const cached = surfaces.get(name)
      if (cached) return cached
      const created = createComponentTheme(() => view().surface(name), surfaces)
      surfaces.set(name, created)
      return created
    },
  }
}

export type ComponentTheme = ResolvedTheme

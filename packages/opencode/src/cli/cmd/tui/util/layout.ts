import type { BaseRenderable, BoxRenderable } from "@opentui/core"

export function setPreLayoutSiblingMargin(el: BoxRenderable, margin: (previous?: BaseRenderable) => number) {
  // Run before Yoga layout so scroll geometry matches the rendered frame.
  el.onLifecyclePass = () => {
    const parent = el.parent
    if (!parent) return
    const children = parent.getChildren()
    const value = margin(children[children.indexOf(el) - 1])
    if (el.marginTop !== value) el.marginTop = value
  }
}

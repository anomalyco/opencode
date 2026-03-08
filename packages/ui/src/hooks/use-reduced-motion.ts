import { isHydrated } from "@solid-primitives/lifecycle"
import { createMediaQuery } from "@solid-primitives/media"
import { createHydratableSingletonRoot } from "@solid-primitives/rootless"
import { createEffect, createSignal, onCleanup } from "solid-js"

const query = "(prefers-reduced-motion: reduce)"
const attr = "data-reduced-motion"

function read() {
  if (typeof document !== "object") return false
  return document.documentElement.getAttribute(attr) === "true"
}

export const useReducedMotion = createHydratableSingletonRoot(() => {
  const value = createMediaQuery(query)
  const [flag, setFlag] = createSignal(read())

  createEffect(() => {
    if (typeof document !== "object") return
    if (typeof MutationObserver !== "function") return
    setFlag(read())
    const observer = new MutationObserver(() => setFlag(read()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [attr],
    })
    onCleanup(() => observer.disconnect())
  })

  return () => !isHydrated() || value() || flag()
})

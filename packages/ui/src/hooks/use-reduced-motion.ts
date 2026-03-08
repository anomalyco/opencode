import { isHydrated } from "@solid-primitives/lifecycle"
import { createMediaQuery } from "@solid-primitives/media"
import { createHydratableSingletonRoot } from "@solid-primitives/rootless"

const query = "(prefers-reduced-motion: reduce)"

export const useReducedMotion = createHydratableSingletonRoot(() => {
  const value = createMediaQuery(query)
  return () => !isHydrated() || value()
})

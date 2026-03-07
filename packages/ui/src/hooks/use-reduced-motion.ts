import { createSignal } from "solid-js"

export const prefersReducedMotion = /* @__PURE__ */ (() => {
  if (typeof window === "undefined") return () => false
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)")
  const [reduced, setReduced] = createSignal(mql.matches)
  mql.addEventListener("change", () => setReduced(mql.matches))
  return reduced
})()

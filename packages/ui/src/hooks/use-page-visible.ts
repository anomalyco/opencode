import { createSignal } from "solid-js"

export const pageVisible = /* @__PURE__ */ (() => {
  const [visible, setVisible] = createSignal(true)
  if (typeof document !== "undefined") {
    const sync = () => setVisible(document.visibilityState !== "hidden")
    sync()
    document.addEventListener("visibilitychange", sync)
  }
  return visible
})()

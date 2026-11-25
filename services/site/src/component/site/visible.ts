import { createSignal, onCleanup, onMount } from "solid-js"

/**
 * True while `element` is near the viewport and the tab is showing, so loops, timers and scroll
 * work can stop off screen and in background tabs.
 */
export function useVisible(element: () => Element | undefined, margin = "200px 0px") {
  const [near, setNear] = createSignal(false)
  const [shown, setShown] = createSignal(true)
  onMount(() => {
    const target = element()
    if (!target) return
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: margin })
    observer.observe(target)
    const sync = () => setShown(!document.hidden)
    sync()
    document.addEventListener("visibilitychange", sync)
    onCleanup(() => {
      observer.disconnect()
      document.removeEventListener("visibilitychange", sync)
    })
  })
  return () => near() && shown()
}

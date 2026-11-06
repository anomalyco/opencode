import { onCleanup, onMount, type Accessor } from "solid-js"

/**
 * Runs `advance` on every animation frame while `playing` is true and the element is on screen. The callback gets
 * the elapsed milliseconds since the last frame, capped so a background tab does not jump the simulation.
 */
export function createTicker(playing: Accessor<boolean>, advance: (delta: number) => void, element?: Accessor<HTMLElement | undefined>) {
  let frame = 0
  let previous = 0
  let onScreen = true
  let documentVisible = true

  const canRun = () => playing() && onScreen && documentVisible && !reducedMotion()

  const loop = (time: number) => {
    if (!canRun()) {
      frame = 0

      return
    }

    const delta = previous === 0 ? 16 : Math.min(48, time - previous)
    previous = time
    advance(delta)
    frame = requestAnimationFrame(loop)
  }

  const start = () => {
    if (frame !== 0 || !canRun()) return
    previous = 0
    frame = requestAnimationFrame(loop)
  }

  const stop = () => {
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
  }

  const sync = () => {
    if (canRun()) start()
    else stop()
  }

  onMount(() => {
    const target = element?.()

    const observer =
      target && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            onScreen = entries.some((entry) => entry.isIntersecting)
            sync()
          })
        : undefined

    observer?.observe(target ?? document.body)

    const onVisibility = () => {
      documentVisible = document.visibilityState === "visible"
      sync()
    }

    document.addEventListener("visibilitychange", onVisibility)

    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)")
    const onMotion = () => sync()
    motion?.addEventListener("change", onMotion)

    const motionAttribute = new MutationObserver(sync)
    motionAttribute.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] })

    sync()

    onCleanup(() => {
      observer?.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      motion?.removeEventListener("change", onMotion)
      motionAttribute.disconnect()
      stop()
    })
  })

  onCleanup(stop)

  return { sync }
}

/** Whether the app or the operating system asks for reduced motion. */
export function reducedMotion(): boolean {
  if (typeof document === "undefined") return false

  if (document.documentElement.dataset.motion === "reduce") return true

  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

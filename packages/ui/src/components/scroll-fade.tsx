import { type JSX, createEffect, createSignal, onCleanup, onMount, splitProps } from "solid-js"

export interface ScrollFadeProps extends JSX.HTMLAttributes<HTMLDivElement> {
  direction?: "horizontal" | "vertical"
  fadeStartSize?: number
  fadeEndSize?: number
  trackTransformSelector?: string
  ref?: (el: HTMLDivElement) => void
}

export function ScrollFade(props: ScrollFadeProps) {
  const [local, others] = splitProps(props, [
    "children",
    "direction",
    "fadeStartSize",
    "fadeEndSize",
    "trackTransformSelector",
    "class",
    "style",
    "ref",
  ])

  const direction = () => local.direction ?? "vertical"
  const fadeStartSize = () => local.fadeStartSize ?? 20
  const fadeEndSize = () => local.fadeEndSize ?? 20

  const getTransformOffset = (element: Element): number => {
    const style = getComputedStyle(element)
    const transform = style.transform
    if (!transform || transform === "none") return 0

    const match = transform.match(/matrix(?:3d)?\(([^)]+)\)/)
    if (!match) return 0

    const values = match[1].split(",").map((v) => parseFloat(v.trim()))
    const isHorizontal = direction() === "horizontal"

    if (transform.startsWith("matrix3d")) {
      return isHorizontal ? -(values[12] || 0) : -(values[13] || 0)
    } else {
      return isHorizontal ? -(values[4] || 0) : -(values[5] || 0)
    }
  }

  let containerRef: HTMLDivElement | undefined

  const [fadeStart, setFadeStart] = createSignal(0)
  const [fadeEnd, setFadeEnd] = createSignal(0)
  const [isScrollable, setIsScrollable] = createSignal(false)

  let lastScrollPos = 0
  let lastTransformPos = 0
  let lastScrollSize = 0
  let lastClientSize = 0

  const updateFade = () => {
    if (!containerRef) return

    const isHorizontal = direction() === "horizontal"
    const scrollPos = isHorizontal ? containerRef.scrollLeft : containerRef.scrollTop
    const scrollSize = isHorizontal ? containerRef.scrollWidth : containerRef.scrollHeight
    const clientSize = isHorizontal ? containerRef.clientWidth : containerRef.clientHeight

    let transformPos = 0
    if (local.trackTransformSelector) {
      const transformElement = containerRef.querySelector(local.trackTransformSelector)
      if (transformElement) {
        transformPos = getTransformOffset(transformElement)
      }
    }

    const effectiveScrollPos = Math.max(scrollPos, transformPos)

    if (
      effectiveScrollPos === lastScrollPos &&
      transformPos === lastTransformPos &&
      scrollSize === lastScrollSize &&
      clientSize === lastClientSize
    ) {
      return
    }

    lastScrollPos = effectiveScrollPos
    lastTransformPos = transformPos
    lastScrollSize = scrollSize
    lastClientSize = clientSize

    const maxScroll = scrollSize - clientSize
    const canScroll = maxScroll > 1

    setIsScrollable(canScroll)

    if (!canScroll) {
      setFadeStart(0)
      setFadeEnd(0)
      return
    }

    const progress = maxScroll > 0 ? effectiveScrollPos / maxScroll : 0

    const startProgress = Math.min(progress / 0.1, 1)
    setFadeStart(startProgress * fadeStartSize())

    const endProgress = progress > 0.9 ? (1 - progress) / 0.1 : 1
    setFadeEnd(Math.max(0, endProgress) * fadeEndSize())
  }

  onMount(() => {
    if (!containerRef) return

    updateFade()

    let rafId: number | undefined
    let isPolling = false
    let pollTimeout: ReturnType<typeof setTimeout> | undefined

    const startPolling = () => {
      if (isPolling) return
      isPolling = true

      const pollScroll = () => {
        updateFade()
        rafId = requestAnimationFrame(pollScroll)
      }
      rafId = requestAnimationFrame(pollScroll)
    }

    const stopPolling = () => {
      if (!isPolling) return
      isPolling = false
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId)
        rafId = undefined
      }
    }

    const schedulePollingStop = () => {
      if (pollTimeout !== undefined) clearTimeout(pollTimeout)
      pollTimeout = setTimeout(stopPolling, 1000)
    }

    const onActivity = () => {
      updateFade()
      if (local.trackTransformSelector) {
        startPolling()
        schedulePollingStop()
      }
    }

    containerRef.addEventListener("scroll", onActivity, { passive: true })

    const resizeObserver = new ResizeObserver(() => {
      lastScrollSize = 0
      lastClientSize = 0
      onActivity()
    })
    resizeObserver.observe(containerRef)

    const mutationObserver = new MutationObserver(() => {
      lastScrollSize = 0
      lastClientSize = 0
      requestAnimationFrame(onActivity)
    })
    mutationObserver.observe(containerRef, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    onCleanup(() => {
      containerRef?.removeEventListener("scroll", onActivity)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      stopPolling()
      if (pollTimeout !== undefined) clearTimeout(pollTimeout)
    })
  })

  createEffect(() => {
    local.children
    requestAnimationFrame(updateFade)
  })

  return (
    <div
      ref={(el) => {
        containerRef = el
        local.ref?.(el)
      }}
      data-component="scroll-fade"
      data-direction={direction()}
      data-scrollable={isScrollable() || undefined}
      data-fade-start={fadeStart() > 0 || undefined}
      data-fade-end={fadeEnd() > 0 || undefined}
      class={local.class}
      style={{
        ...(typeof local.style === "object" ? local.style : {}),
        "--scroll-fade-start": `${fadeStart()}px`,
        "--scroll-fade-end": `${fadeEnd()}px`,
      }}
      {...others}
    >
      {local.children}
    </div>
  )
}

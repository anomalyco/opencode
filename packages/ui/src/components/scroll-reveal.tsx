import { type JSX, onCleanup, splitProps } from "solid-js"
import { ScrollFade, type ScrollFadeProps } from './scroll-fade'

const SCROLL_SPEED = 60
const PAUSE_DURATION = 800

type ScrollAnimationState = {
  rafId: number | null
  startTime: number
  running: boolean
}

const startScrollAnimation = (containerEl: HTMLElement): ScrollAnimationState | null => {
  containerEl.offsetHeight

  const extraWidth = containerEl.scrollWidth - containerEl.clientWidth

  if (extraWidth <= 0) {
    return null
  }

  const scrollDuration = (extraWidth / SCROLL_SPEED) * 1000
  const totalDuration = PAUSE_DURATION + scrollDuration + PAUSE_DURATION + scrollDuration + PAUSE_DURATION

  const state: ScrollAnimationState = {
    rafId: null,
    startTime: performance.now(),
    running: true,
  }

  const animate = (currentTime: number) => {
    if (!state.running) return

    const elapsed = currentTime - state.startTime
    const progress = (elapsed % totalDuration) / totalDuration

    const pausePercent = PAUSE_DURATION / totalDuration
    const scrollPercent = scrollDuration / totalDuration

    const pauseEnd1 = pausePercent
    const scrollEnd1 = pauseEnd1 + scrollPercent
    const pauseEnd2 = scrollEnd1 + pausePercent
    const scrollEnd2 = pauseEnd2 + scrollPercent

    let scrollPos = 0

    if (progress < pauseEnd1) {
      scrollPos = 0
    } else if (progress < scrollEnd1) {
      const scrollProgress = (progress - pauseEnd1) / scrollPercent
      scrollPos = scrollProgress * extraWidth
    } else if (progress < pauseEnd2) {
      scrollPos = extraWidth
    } else if (progress < scrollEnd2) {
      const scrollProgress = (progress - pauseEnd2) / scrollPercent
      scrollPos = extraWidth * (1 - scrollProgress)
    } else {
      scrollPos = 0
    }

    containerEl.scrollLeft = scrollPos
    state.rafId = requestAnimationFrame(animate)
  }

  state.rafId = requestAnimationFrame(animate)
  return state
}

const stopScrollAnimation = (state: ScrollAnimationState | null, containerEl?: HTMLElement) => {
  if (state) {
    state.running = false
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId)
    }
  }
  if (containerEl) {
    containerEl.scrollLeft = 0
  }
}

export interface ScrollRevealProps extends Omit<ScrollFadeProps, "direction"> {
  hoverDelay?: number
}

export function ScrollReveal(props: ScrollRevealProps) {
  const [local, others] = splitProps(props, ["children", "hoverDelay", "ref"])

  const hoverDelay = () => local.hoverDelay ?? 300

  let containerRef: HTMLDivElement | undefined
  let hoverTimeout: ReturnType<typeof setTimeout> | undefined
  let scrollAnimationState: ScrollAnimationState | null = null

  const handleMouseEnter: JSX.EventHandler<HTMLDivElement, MouseEvent> = () => {
    hoverTimeout = setTimeout(() => {
      if (!containerRef) return

      containerRef.offsetHeight

      const isScrollable = containerRef.scrollWidth > containerRef.clientWidth + 1

      if (isScrollable) {
        stopScrollAnimation(scrollAnimationState, containerRef)
        scrollAnimationState = startScrollAnimation(containerRef)
      }
    }, hoverDelay())
  }

  const handleMouseLeave: JSX.EventHandler<HTMLDivElement, MouseEvent> = () => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout)
      hoverTimeout = undefined
    }
    stopScrollAnimation(scrollAnimationState, containerRef)
    scrollAnimationState = null
  }

  onCleanup(() => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout)
    }
    stopScrollAnimation(scrollAnimationState, containerRef)
  })

  return (
    <ScrollFade
      ref={(el) => {
        containerRef = el
        local.ref?.(el)
      }}
      fadeStartSize={8}
      fadeEndSize={8}
      direction="horizontal"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...others}
    >
      {local.children}
    </ScrollFade>
  )
}

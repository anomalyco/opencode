import { type JSX, onMount, onCleanup } from "solid-js"
import { animate, springValue, type AnimationPlaybackControls, FADE_SPRING, HEIGHT_SPRING } from "./motion"

export interface GrowBoxProps {
  children: JSX.Element
  /** Enable animation. When false, content shows immediately at full height. */
  animate?: boolean
  /** Animate height from 0 to content height. Default: true. */
  grow?: boolean
  /** Keep watching body size and animate subsequent height changes. Default: false. */
  watch?: boolean
  /** Fade in body content (opacity + blur). Default: true. */
  fade?: boolean
  /** Top padding in px on the body wrapper. Default: 0. */
  gap?: number
  /** Reset to height:auto after grow completes, or stay at fixed px. Default: true. */
  autoHeight?: boolean
  /** data-slot attribute on the root div. */
  slot?: string
  /** CSS class on the root div. */
  class?: string
}

/**
 * Wraps children in a container that animates from zero height on mount.
 *
 * Includes a ResizeObserver so content changes after mount are also spring-animated.
 * Used for timeline turns, assistant part groups, and user messages.
 */
export function GrowBox(props: GrowBoxProps) {
  let root: HTMLDivElement | undefined
  let body: HTMLDivElement | undefined
  let fadeAnim: AnimationPlaybackControls | undefined
  let mountFrame: number | undefined
  let resizeFrame: number | undefined
  let observer: ResizeObserver | undefined
  let springTarget = -1
  const height = springValue<number>(0, HEIGHT_SPRING)

  const gap = () => Math.max(0, props.gap ?? 0)
  const grow = () => props.grow !== false
  const watch = () => props.watch === true

  const currentHeight = () => {
    if (!root) return 0
    const v = root.style.height
    if (v && v !== "auto") {
      const n = Number.parseFloat(v)
      if (!Number.isNaN(n)) return n
    }
    return Math.max(0, root.getBoundingClientRect().height)
  }

  const targetHeight = () => Math.max(0, Math.ceil(body?.getBoundingClientRect().height ?? 0))

  const setHeight = () => {
    if (!root) return
    const next = targetHeight()
    if (next === springTarget) return
    const prev = currentHeight()
    if (Math.abs(next - prev) < 1) {
      springTarget = next
      if (props.autoHeight === false || watch()) {
        root.style.height = `${next}px`
        root.style.overflow = next > 0 ? "visible" : "hidden"
      }
      return
    }
    root.style.overflow = "hidden"
    springTarget = next
    height.set(next)
  }

  onMount(() => {
    if (!root || !body) return

    const offChange = height.on("change", (next) => {
      if (!root) return
      root.style.height = `${Math.max(0, next)}px`
    })
    const offStart = height.on("animationStart", () => {
      if (!root) return
      root.style.overflow = "hidden"
      root.style.willChange = "height"
      root.style.contain = "layout style"
    })
    const offComplete = height.on("animationComplete", () => {
      if (!root) return
      root.style.willChange = ""
      root.style.contain = ""
      const next = targetHeight()
      springTarget = next
      if (props.autoHeight === false || watch()) {
        root.style.height = `${next}px`
        root.style.overflow = next > 0 ? "visible" : "hidden"
        return
      }
      root.style.height = "auto"
      root.style.overflow = "visible"
    })

    onCleanup(() => {
      offComplete()
      offStart()
      offChange()
    })

    if (!props.animate) {
      root.style.height = ""
      root.style.overflow = ""
      body.style.opacity = ""
      body.style.filter = ""
      return
    }

    if (grow()) {
      root.style.height = "0px"
      root.style.overflow = "hidden"
    } else {
      root.style.height = "auto"
      root.style.overflow = "visible"
    }

    if (props.fade !== false) {
      body.style.opacity = "0"
      body.style.filter = "blur(2px)"
    }

    mountFrame = requestAnimationFrame(() => {
      mountFrame = undefined
      if (props.fade !== false && body) {
        fadeAnim?.stop()
        fadeAnim = animate(body, { opacity: 1, filter: "blur(0px)" }, FADE_SPRING)
        fadeAnim.finished.then(() => {
          if (!body) return
          body.style.opacity = ""
          body.style.filter = ""
        })
      }
      if (grow()) setHeight()
    })
    if (watch()) {
      observer = new ResizeObserver(() => {
        if (resizeFrame !== undefined) return
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = undefined
          setHeight()
        })
      })
      observer.observe(body)
    }
  })

  onCleanup(() => {
    if (mountFrame !== undefined) cancelAnimationFrame(mountFrame)
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    observer?.disconnect()
    height.destroy()
    fadeAnim?.stop()
  })

  return (
    <div ref={root} data-slot={props.slot} class={props.class}>
      <div ref={body} style={{ "padding-top": gap() > 0 ? `${gap()}px` : undefined }}>
        {props.children}
      </div>
    </div>
  )
}

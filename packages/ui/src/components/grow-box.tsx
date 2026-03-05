import { createEffect, on, type JSX, onMount, onCleanup } from "solid-js"
import { animate, tunableSpringValue, type AnimationPlaybackControls, GROW_SPRING, type SpringConfig } from "./motion"
import { prefersReducedMotion } from "../hooks/use-reduced-motion"

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
  /** Controlled visibility for animating open/close without unmounting children. */
  open?: boolean
  /** Animate controlled open/close changes after mount. Default: true. */
  animateToggle?: boolean
  /** data-slot attribute on the root div. */
  slot?: string
  /** CSS class on the root div. */
  class?: string
  /** Override mount and resize spring config. Default: GROW_SPRING. */
  spring?: SpringConfig
  /** Override controlled open/close spring config. Default: spring. */
  toggleSpring?: SpringConfig
  /** Show a temporary bottom edge fade while height animation is running. */
  edge?: boolean
  /** Edge fade height in px. Default: 20. */
  edgeHeight?: number
  /** Edge fade opacity (0-1). Default: 1. */
  edgeOpacity?: number
  /** Delay before edge fades out after height settles. Default: 320. */
  edgeIdle?: number
  /** Edge fade-out duration in seconds. Default: 0.24. */
  edgeFade?: number
  /** Edge fade-in duration in seconds. Default: 0.2. */
  edgeRise?: number
}

/**
 * Wraps children in a container that animates from zero height on mount.
 *
 * Includes a ResizeObserver so content changes after mount are also spring-animated.
 * Used for timeline turns, assistant part groups, and user messages.
 */
export function GrowBox(props: GrowBoxProps) {
  const reduce = prefersReducedMotion
  const spring = () => props.spring ?? GROW_SPRING
  const toggleSpring = () => props.toggleSpring ?? spring()
  let mode: "mount" | "toggle" = "mount"
  let root: HTMLDivElement | undefined
  let body: HTMLDivElement | undefined
  let fadeAnim: AnimationPlaybackControls | undefined
  let edgeRef: HTMLDivElement | undefined
  let edgeAnim: AnimationPlaybackControls | undefined
  let edgeTimer: ReturnType<typeof setTimeout> | undefined
  let edgeOn = false
  let mountFrame: number | undefined
  let resizeFrame: number | undefined
  let observer: ResizeObserver | undefined
  let springTarget = -1
  const height = tunableSpringValue<number>(0, {
    type: "spring",
    get visualDuration() {
      return (mode === "toggle" ? toggleSpring() : spring()).visualDuration
    },
    get bounce() {
      return (mode === "toggle" ? toggleSpring() : spring()).bounce
    },
  })

  const gap = () => Math.max(0, props.gap ?? 0)
  const grow = () => props.grow !== false
  const watch = () => props.watch === true
  const open = () => props.open !== false
  const animateToggle = () => props.animateToggle !== false
  const edge = () => props.edge === true
  const edgeHeight = () => Math.max(0, props.edgeHeight ?? 20)
  const edgeOpacity = () => Math.min(1, Math.max(0, props.edgeOpacity ?? 1))
  const edgeIdle = () => Math.max(0, props.edgeIdle ?? 320)
  const edgeFade = () => Math.max(0.05, props.edgeFade ?? 0.24)
  const edgeRise = () => Math.max(0.05, props.edgeRise ?? 0.2)
  const animated = () => props.animate !== false && !reduce()
  const edgeReady = () => animated() && open() && edge() && edgeHeight() > 0

  const stopEdgeTimer = () => {
    if (edgeTimer === undefined) return
    clearTimeout(edgeTimer)
    edgeTimer = undefined
  }

  const hideEdge = (instant = false) => {
    stopEdgeTimer()
    if (!edgeRef) {
      edgeOn = false
      return
    }
    edgeAnim?.stop()
    edgeAnim = undefined
    if (instant || reduce()) {
      edgeRef.style.opacity = "0"
      edgeOn = false
      return
    }
    if (!edgeOn) {
      edgeRef.style.opacity = "0"
      return
    }
    const current = animate(edgeRef, { opacity: 0 }, { type: "spring", visualDuration: edgeFade(), bounce: 0 })
    edgeAnim = current
    current.finished
      .catch(() => {})
      .finally(() => {
        if (edgeAnim !== current) return
        edgeAnim = undefined
        if (!edgeRef) return
        edgeRef.style.opacity = "0"
        edgeOn = false
      })
  }

  const showEdge = () => {
    stopEdgeTimer()
    if (!edgeRef) return
    if (reduce()) {
      edgeRef.style.opacity = `${edgeOpacity()}`
      edgeOn = true
      return
    }
    if (edgeOn && edgeAnim === undefined) {
      edgeRef.style.opacity = `${edgeOpacity()}`
      return
    }
    edgeAnim?.stop()
    edgeAnim = undefined
    if (!edgeOn) edgeRef.style.opacity = "0"
    const current = animate(
      edgeRef,
      { opacity: edgeOpacity() },
      { type: "spring", visualDuration: edgeRise(), bounce: 0 },
    )
    edgeAnim = current
    edgeOn = true
    current.finished
      .catch(() => {})
      .finally(() => {
        if (edgeAnim !== current) return
        edgeAnim = undefined
        if (!edgeRef) return
        edgeRef.style.opacity = `${edgeOpacity()}`
      })
  }

  const queueEdgeHide = () => {
    stopEdgeTimer()
    if (!edgeOn) return
    if (edgeIdle() <= 0) {
      hideEdge()
      return
    }
    edgeTimer = setTimeout(() => {
      edgeTimer = undefined
      hideEdge()
    }, edgeIdle())
  }

  const hideBody = () => {
    if (!body) return
    body.style.opacity = "0"
    body.style.filter = "blur(2px)"
  }

  const clearBody = () => {
    if (!body) return
    body.style.opacity = ""
    body.style.filter = ""
  }

  const fadeBodyIn = (nextMode: "mount" | "toggle" = "mount") => {
    if (props.fade === false || !body) return
    if (reduce()) {
      clearBody()
      return
    }
    hideBody()
    fadeAnim?.stop()
    fadeAnim = animate(body, { opacity: 1, filter: "blur(0px)" }, nextMode === "toggle" ? toggleSpring() : spring())
    fadeAnim.finished.then(() => {
      if (!body || !open()) return
      clearBody()
    })
  }

  const setInstant = (visible: boolean) => {
    const next = visible ? targetHeight() : 0
    springTarget = next
    height.jump(next)
    root!.style.height = visible ? "" : "0px"
    root!.style.overflow = visible ? "" : "clip"
    hideEdge(true)
    if (visible || props.fade === false) clearBody()
    else hideBody()
  }

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

  const setHeight = (nextMode: "mount" | "toggle" = "mount") => {
    if (!root || !open()) return
    const next = targetHeight()
    if (reduce()) {
      springTarget = next
      height.jump(next)
      if (props.autoHeight === false || watch()) {
        root.style.height = `${next}px`
        root.style.overflow = next > 0 ? "visible" : "clip"
        return
      }
      root.style.height = "auto"
      root.style.overflow = next > 0 ? "visible" : "clip"
      return
    }
    if (next === springTarget) return
    const prev = currentHeight()
    if (Math.abs(next - prev) < 1) {
      springTarget = next
      if (props.autoHeight === false || watch()) {
        root.style.height = `${next}px`
        root.style.overflow = next > 0 ? "visible" : "clip"
      }
      return
    }
    root.style.overflow = "clip"
    springTarget = next
    mode = nextMode
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
      root.style.overflow = "clip"
      root.style.willChange = "height"
      root.style.contain = "layout style"
      if (edgeReady()) showEdge()
    })
    const offComplete = height.on("animationComplete", () => {
      if (!root) return
      root.style.willChange = ""
      root.style.contain = ""
      if (!open()) {
        springTarget = 0
        root.style.height = "0px"
        root.style.overflow = "clip"
        return
      }
      const next = targetHeight()
      springTarget = next
      if (props.autoHeight === false || watch()) {
        root.style.height = `${next}px`
        root.style.overflow = next > 0 ? "visible" : "clip"
        if (edgeReady()) queueEdgeHide()
        return
      }
      root.style.height = "auto"
      root.style.overflow = "visible"
      if (edgeReady()) queueEdgeHide()
    })

    onCleanup(() => {
      offComplete()
      offStart()
      offChange()
    })

    if (!animated()) {
      setInstant(open())
      return
    }

    if (props.fade !== false) hideBody()
    hideEdge(true)

    if (!open()) {
      root.style.height = "0px"
      root.style.overflow = "clip"
    } else {
      if (grow()) {
        root.style.height = "0px"
        root.style.overflow = "clip"
      } else {
        root.style.height = "auto"
        root.style.overflow = "visible"
      }
      mountFrame = requestAnimationFrame(() => {
        mountFrame = undefined
        fadeBodyIn("mount")
        if (grow()) setHeight("mount")
      })
    }
    if (watch()) {
      observer = new ResizeObserver(() => {
        if (!open()) return
        if (resizeFrame !== undefined) return
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = undefined
          setHeight("mount")
        })
      })
      observer.observe(body)
    }
  })

  createEffect(
    on(
      () => props.open,
      (value) => {
        if (value === undefined) return
        if (!root || !body) return
        if (!animateToggle() || reduce()) {
          setInstant(value)
          return
        }
        fadeAnim?.stop()
        if (!value) hideEdge(true)
        if (!value) {
          const next = currentHeight()
          if (Math.abs(next - height.get()) >= 1) {
            springTarget = next
            height.jump(next)
            root.style.height = `${next}px`
          }
          if (props.fade !== false) {
            fadeAnim = animate(body, { opacity: 0, filter: "blur(2px)" }, toggleSpring())
          }
          root.style.overflow = "clip"
          springTarget = 0
          mode = "toggle"
          height.set(0)
          return
        }
        fadeBodyIn("toggle")
        setHeight("toggle")
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!edgeRef) return
    edgeRef.style.height = `${edgeHeight()}px`
    if (!animated() || !open() || edgeHeight() <= 0) {
      hideEdge(true)
      return
    }
    if (edge()) return
    hideEdge()
  })

  createEffect(() => {
    if (!root || !body) return
    if (!reduce()) return
    fadeAnim?.stop()
    edgeAnim?.stop()
    setInstant(open())
  })

  onCleanup(() => {
    stopEdgeTimer()
    if (mountFrame !== undefined) cancelAnimationFrame(mountFrame)
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    observer?.disconnect()
    height.destroy()
    fadeAnim?.stop()
    edgeAnim?.stop()
    edgeAnim = undefined
    edgeOn = false
  })

  return (
    <div
      ref={root}
      data-slot={props.slot}
      class={props.class}
      style={{ transform: "translateZ(0)", position: "relative" }}
    >
      <div ref={body} style={{ "padding-top": gap() > 0 ? `${gap()}px` : undefined }}>
        {props.children}
      </div>
      <div
        ref={edgeRef}
        data-slot="grow-box-edge"
        style={{
          position: "absolute",
          left: "0",
          right: "0",
          bottom: "0",
          height: `${edgeHeight()}px`,
          opacity: 0,
          "pointer-events": "none",
          background: "linear-gradient(to bottom, transparent 0%, var(--background-stronger) 100%)",
        }}
      />
    </div>
  )
}

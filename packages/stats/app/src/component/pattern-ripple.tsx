import { onCleanup, onMount } from "solid-js"

const PATTERNS = '[data-page="stats"] [data-slot$="-pattern"]'
const RIPPLE = {
  duration: 4400,
  brightness: 50,
  trail: 400,
  trailBody: 100,
  front: 90,
  ease: 4,
  fade: 3.3,
  reach: 1.3,
  rearm: 400,
}

type Ripple = { x: number; y: number; radius: number; start: number }

// Plays one soft wave of light across a dot pattern when the cursor moves onto its visible dots.
export function PatternRipple() {
  onMount(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const ripples = new Map<HTMLElement, Ripple>()
    const leftAt = new WeakMap<HTMLElement, number>()
    const state = { current: undefined as HTMLElement | undefined, primed: false, running: false }

    const frame = (now: number) => {
      ripples.forEach((ripple, el) => {
        const progress = (now - ripple.start) / RIPPLE.duration
        if (progress >= 1) {
          ripples.delete(el)
          el.style.removeProperty("--dot-ripple")
          return
        }
        el.style.setProperty("--dot-ripple", rippleGradient(ripple, progress))
      })
      if (ripples.size > 0) return requestAnimationFrame(frame)
      state.running = false
    }

    const start = (el: HTMLElement, clientX: number, clientY: number) => {
      const box = el.getBoundingClientRect()
      const visible = visibleBox(el)
      ripples.set(el, {
        x: clientX - box.left,
        y: clientY - box.top,
        radius: Math.hypot(
          Math.max(clientX - visible.left, visible.right - clientX),
          Math.max(clientY - visible.top, visible.bottom - clientY),
        ),
        start: performance.now(),
      })
      if (state.running) return
      state.running = true
      requestAnimationFrame(frame)
    }

    // The pattern must be the top element under the cursor, so text cut-outs over a pattern count as off the dots.
    // A cursor already resting on a pattern when the page loads does not trigger a ripple.
    const move = (event: PointerEvent) => {
      const now = performance.now()
      const hit = document.elementFromPoint(event.clientX, event.clientY)
      const el = hit instanceof HTMLElement && hit.matches(PATTERNS) ? hit : undefined
      if (el !== state.current) {
        if (state.current) leftAt.set(state.current, now)
        if (el && state.primed && now - (leftAt.get(el) ?? -Infinity) >= RIPPLE.rearm) start(el, event.clientX, event.clientY)
        state.current = el
      }
      state.primed = true
    }

    document.addEventListener("pointermove", move, { passive: true })
    onCleanup(() => document.removeEventListener("pointermove", move))
  })

  return null
}

function rippleGradient(ripple: Ripple, progress: number) {
  const r = ripple.radius * RIPPLE.reach * (1 - (1 - progress) ** RIPPLE.ease)
  const alpha = RIPPLE.brightness * (1 - progress) ** RIPPLE.fade
  const mix = (amount: number) => `color-mix(in srgb, var(--stats-text) ${amount.toFixed(1)}%, transparent)`
  const at = (offset: number) => `${Math.max(0, r + offset).toFixed(1)}px`
  return `radial-gradient(circle at ${ripple.x}px ${ripple.y}px, transparent ${at(-RIPPLE.trail)}, ${mix((alpha * RIPPLE.trailBody) / 100)} ${at(-RIPPLE.trail / 2)}, ${mix(alpha)} ${at(0)}, transparent ${at(RIPPLE.front)})`
}

// Some patterns are larger than their clipping container, so the ripple only needs to reach the visible part.
function visibleBox(el: HTMLElement) {
  const box = el.getBoundingClientRect()
  const clip = el.parentElement?.getBoundingClientRect() ?? box
  return {
    left: Math.max(box.left, clip.left),
    top: Math.max(box.top, clip.top),
    right: Math.min(box.right, clip.right),
    bottom: Math.min(box.bottom, clip.bottom),
  }
}

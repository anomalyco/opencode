import { frameLoop } from "@opencode/ui/motion"
import { createEffect, onCleanup, onMount } from "solid-js"
import { motion, sprung } from "./spring"

// Space between the element and its ring.
const gap = 4

// How long the ring shows once its element is found, to draw the eye there.
const flash = 1500

/**
 * A soft ring around the first element matching `selector`, tagged with the stop's id so a recording shows which stop
 * it belongs to. It never takes the pointer. It follows the element as it moves, flashes for a moment once the element
 * exists, shows again while `hold` (the pointer is over the floater), and when `leaving` fades out before `onGone`.
 */
export function SpotlightRing(props: {
  selector: string
  label: string
  hold: boolean
  leaving: boolean
  onGone: () => void
}) {
  let ring!: HTMLDivElement
  let element: Element | undefined
  let found: number | undefined
  const box = { x: 0, y: 0, width: 0, height: 0 }

  const paint = (shown: number) => {
    ring.style.opacity = String(shown)
    ring.style.transform = `translate3d(${box.x}px, ${box.y}px, 0) scale(${1.03 - 0.03 * shown})`

    if (shown === 0 && props.leaving) props.onGone()
  }

  const presence = sprung(0, motion.settle, paint)

  onMount(() => {
    // Follows the element every frame: it may move with scrolling, panels or its own motion.
    const remove = frameLoop.add(() => {
      if (props.leaving) return false

      if (!element?.isConnected) element = document.querySelector(props.selector) ?? undefined

      const rect = element?.getBoundingClientRect()
      const visible = !!rect && rect.width > 0 && rect.height > 0

      if (rect && visible) {
        const next = {
          x: rect.left - gap,
          y: rect.top - gap,
          width: rect.width + gap * 2,
          height: rect.height + gap * 2,
        }

        if (next.width !== box.width || next.height !== box.height) {
          ring.style.width = `${next.width}px`
          ring.style.height = `${next.height}px`
          ring.style.borderRadius = `${radius(element) + gap}px`
        }

        Object.assign(box, next)
        paint(presence.value)
      }

      found ??= visible ? performance.now() : undefined

      const shown = visible && (props.hold || performance.now() - (found ?? 0) < flash) ? 1 : 0

      if (shown !== presence.target) presence.set(shown)

      return true
    })

    onCleanup(() => {
      remove()
      presence.dispose()
    })
  })

  createEffect(() => {
    if (!props.leaving) return

    if (presence.value === 0) return props.onGone()
    presence.set(0)
  })

  return (
    <div
      ref={ring}
      data-component="review-tour-spotlight"
      aria-hidden="true"
      class="pointer-events-none fixed top-0 left-0 z-[2147482999] opacity-0"
      style={{
        "box-shadow":
          "0 0 0 2px var(--v2-border-border-focus), 0 0 0 6px color-mix(in oklch, var(--v2-border-border-focus) 22%, transparent)",
        "transform-origin": "center",
      }}
    >
      <span class="absolute -top-[26px] left-0 rounded-[4px] bg-v2-background-bg-accent px-1.5 font-mono text-[12px] leading-5 text-v2-text-text-contrast shadow-[var(--v2-elevation-raised)] [font-feature-settings:'zero']">
        {props.label}
      </span>
    </div>
  )
}

/** Why `selector` isn't a valid CSS selector, if it isn't. */
export function selectorError(selector: string) {
  // The DOM reports an invalid selector only by throwing.
  try {
    document.createDocumentFragment().querySelector(selector)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function radius(element: Element | undefined) {
  if (!element) return 0

  return Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
}

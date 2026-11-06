import { type JSX, onCleanup, onMount } from "solid-js"
import { detectPlatform } from "~/lib/platform"
import { onCloseMenus } from "./menu-open"
import "./sheet.css"

/**
 * A bottom sheet: what a dropdown becomes on a touch phone. A drag handle over the content, a medium
 * and a large detent, and dismissal by dragging or flicking down, a backdrop tap or Escape. Focus
 * moves into it (to the current row, else the first) and back to the trigger on close. It is a
 * popover in the top layer, so no card or carousel clips it; with an `id`, a `popovertarget` button
 * opens it without JavaScript too.
 */
export type SheetControl = {
  open: (trigger: HTMLElement) => void
  close: () => void
}

/** Touch phones and tablets get sheets: the platform, or a screen with no hover and a coarse pointer. */
export function prefersSheet(platform = detectPlatform()) {
  return platform === "ios" || platform === "android" || matchMedia("(hover: none) and (pointer: coarse)").matches
}

// The medium detent shows this share of the viewport; dragging up or a long list reaches the large one.
const MEDIUM = 0.6

export function Sheet(props: {
  /** For `popovertarget` buttons, which open the sheet before the code has loaded. */
  id?: string
  /** Names the sheet for its own styles: `data-sheet`. */
  name: string
  /** The dialog's accessible name; the sheet shows no title. */
  label: string
  control: (control: SheetControl) => void
  children: JSX.Element
}) {
  let root!: HTMLDivElement
  let panel!: HTMLDivElement
  let backdrop!: HTMLDivElement
  let head!: HTMLDivElement
  let body!: HTMLDivElement
  let y = 0
  let height = 0
  let open = false
  let returnTo: HTMLElement | undefined
  let stop: (() => void) | undefined
  let drag: { start: number; from: number; moved: boolean } | undefined
  const samples: { t: number; p: number }[] = []

  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches
  const medium = () => Math.max(0, height - window.innerHeight * MEDIUM)
  const snaps = () => (medium() > 8 ? [0, medium()] : [0])

  const setY = (next: number) => {
    y = next
    panel.style.transform = `translate3d(0, ${next}px, 0)`
    const start = medium()
    backdrop.style.opacity = String(Math.min(1, Math.max(0, 1 - (next - start) / Math.max(1, height - start))))
  }

  const animate = (
    to: number,
    options: { velocity?: number; damping: number; response: number; done?: () => void },
  ) => {
    stop?.()
    if (reduced()) {
      setY(to)
      options.done?.()
      return
    }
    stop = spring(y, to, options.velocity ?? 0, options.damping, options.response, setY, options.done)
  }

  const show = (trigger: HTMLElement) => {
    if (open) return
    open = true
    returnTo = trigger
    trigger.setAttribute("aria-expanded", "true")
    if (!root.matches(":popover-open")) root.showPopover()
    height = panel.offsetHeight
    // Open at the medium detent with the current row in view; when the body can't scroll it into
    // view there (it is near the end), open at the large detent instead.
    const current = body.querySelector<HTMLElement>('[aria-current="true"]')
    const reveal = (at: number) => {
      if (!current) return true
      const top = window.innerHeight - height + at + head.offsetHeight
      body.scrollTop = Math.max(0, current.offsetTop - (window.innerHeight - top - current.offsetHeight) / 2)
      return top + current.offsetTop - body.scrollTop + current.offsetHeight <= window.innerHeight
    }
    body.scrollTop = 0
    const start = reveal(medium()) ? medium() : 0
    if (start === 0) reveal(0)
    if (reduced()) {
      setY(start)
      root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease" })
    } else {
      setY(height)
      animate(start, { damping: 1, response: 0.38 })
    }
    ;(current ?? body.querySelector<HTMLElement>("a[href], button"))?.focus({ preventScroll: true })
  }

  const hide = (velocity = 0) => {
    if (!open) return
    open = false
    returnTo?.setAttribute("aria-expanded", "false")
    returnTo?.focus({ preventScroll: true })
    const done = () => {
      if (open) return
      if (root.matches(":popover-open")) root.hidePopover()
      panel.style.removeProperty("transform")
      backdrop.style.removeProperty("opacity")
    }
    if (reduced()) {
      stop?.()
      root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease" }).finished.then(done)
      return
    }
    animate(height, { velocity, damping: 1, response: 0.28, done })
  }

  const toggleDetent = () => {
    const s = snaps()
    animate(Math.abs(y - Math.min(...s)) < 2 ? Math.max(...s) : Math.min(...s), { damping: 1, response: 0.35 })
  }

  const startDrag = (p: number) => {
    stop?.()
    height = panel.offsetHeight
    drag = { start: p, from: y, moved: false }
    samples.length = 0
    samples.push({ t: performance.now(), p })
  }

  const moveDrag = (p: number) => {
    if (!drag) return
    if (Math.abs(p - drag.start) > 4) drag.moved = true
    const next = drag.from + p - drag.start
    // Past the large detent the sheet follows less and less: a soft edge instead of a wall.
    setY(next < 0 ? -rubberband(-next, height) : next)
    const t = performance.now()
    samples.push({ t, p })
    while (samples.length > 2 && t - samples[0].t > 90) samples.shift()
  }

  const endDrag = () => {
    if (!drag) return
    drag = undefined
    const first = samples[0]
    const last = samples[samples.length - 1]
    const velocity = last.t > first.t ? ((last.p - first.p) / (last.t - first.t)) * 1000 : 0
    // A flick goes to the next detent (or closed) in its direction. A slower release goes to the
    // detent nearest to where its momentum would carry it.
    const options = [...snaps(), height]
    const projected = y + ((velocity / 1000) * 0.99) / (1 - 0.99)
    const target =
      velocity > 500
        ? (options.find((option) => option > y + 1) ?? height)
        : velocity < -500
          ? (options.findLast((option) => option < y - 1) ?? 0)
          : options.reduce((a, b) => (Math.abs(b - projected) < Math.abs(a - projected) ? b : a))
    if (target === height) return hide(velocity)
    animate(target, { velocity, damping: 0.86, response: 0.32 })
  }

  onCloseMenus(() => hide())

  onMount(() => {
    props.control({ open: show, close: () => hide() })
    // Opened or closed by the browser itself (popovertarget before the code loaded).
    const toggle = (event: Event) => {
      if (!(event instanceof ToggleEvent)) return
      if (event.newState === "open" && !open) {
        open = true
        height = panel.offsetHeight
        setY(medium())
      }
      if (event.newState === "closed") open = false
    }
    root.addEventListener("toggle", toggle)

    // The body drags the sheet when pulled down from its top, or pushed up below the large detent.
    let touchY = 0
    let mode: "sheet" | "scroll" | undefined
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      touchY = event.touches[0].clientY
      mode = undefined
    }
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      const p = event.touches[0].clientY
      const dy = p - touchY
      if (!mode) {
        if (Math.abs(dy) < 8) return
        mode = (dy > 0 && body.scrollTop <= 0) || (dy < 0 && y > 1) ? "sheet" : "scroll"
        if (mode === "sheet") startDrag(p)
      }
      if (mode !== "sheet") return
      event.preventDefault()
      moveDrag(p)
    }
    const touchEnd = () => {
      if (mode === "sheet") endDrag()
      mode = undefined
    }
    body.addEventListener("touchstart", touchStart, { passive: true })
    body.addEventListener("touchmove", touchMove, { passive: false })
    body.addEventListener("touchend", touchEnd)
    body.addEventListener("touchcancel", touchEnd)

    onCleanup(() => {
      stop?.()
      root.removeEventListener("toggle", toggle)
      body.removeEventListener("touchstart", touchStart)
      body.removeEventListener("touchmove", touchMove)
      body.removeEventListener("touchend", touchEnd)
      body.removeEventListener("touchcancel", touchEnd)
    })
  })

  return (
    <div
      ref={root}
      id={props.id}
      popover="manual"
      data-component="sheet"
      data-sheet={props.name}
      role="dialog"
      aria-modal="true"
      aria-label={props.label}
      on:keydown={(event) => {
        if (event.key === "Escape") {
          // Stops here, so the site's own Escape doesn't also close the phone menu behind.
          event.preventDefault()
          event.stopPropagation()
          hide()
        }
        if (event.key === "Tab") trapFocus(root, event)
      }}
    >
      <div ref={backdrop} data-slot="backdrop" aria-hidden="true" on:click={() => hide()} />
      <div ref={panel} data-slot="panel">
        <div
          ref={head}
          data-slot="head"
          on:pointerdown={(event) => {
            if (!event.isPrimary || drag) return
            const target = event.currentTarget
            target.setPointerCapture(event.pointerId)
            startDrag(event.clientY)
            const move = (e: PointerEvent) => moveDrag(e.clientY)
            const up = () => {
              target.removeEventListener("pointermove", move)
              target.removeEventListener("pointerup", up)
              target.removeEventListener("pointercancel", up)
              const tap = !drag?.moved
              endDrag()
              // Pointer capture sends the click to the header, so a tap on the handle is handled here.
              if (tap) toggleDetent()
            }
            target.addEventListener("pointermove", move)
            target.addEventListener("pointerup", up)
            target.addEventListener("pointercancel", up)
          }}
        >
          <button
            type="button"
            data-slot="grabber"
            aria-label={props.label}
            // Keyboard only: pointer taps arrive through the header's pointer events.
            on:click={(event) => {
              if (event.detail === 0) toggleDetent()
            }}
          />
        </div>
        <div ref={body} data-slot="body">
          {props.children}
        </div>
      </div>
    </div>
  )
}

/** A spring in Apple's terms (damping ratio, response in seconds), stepped each frame. */
function spring(
  from: number,
  to: number,
  velocity: number,
  damping: number,
  response: number,
  update: (value: number) => void,
  done?: () => void,
) {
  const stiffness = ((2 * Math.PI) / response) ** 2
  const friction = (4 * Math.PI * damping) / response
  let x = from
  let v = velocity
  let last = performance.now()
  let frame = requestAnimationFrame(function step(now) {
    const dt = Math.min(0.064, (now - last) / 1000)
    last = now
    const steps = Math.max(1, Math.ceil(dt / 0.004))
    for (let i = 0; i < steps; i++) {
      v += (-stiffness * (x - to) - friction * v) * (dt / steps)
      x += v * (dt / steps)
    }
    if (Math.abs(v) < 4 && Math.abs(x - to) < 0.4) {
      update(to)
      done?.()
      return
    }
    update(x)
    frame = requestAnimationFrame(step)
  })
  return () => cancelAnimationFrame(frame)
}

function rubberband(overshoot: number, dimension: number) {
  return (overshoot * dimension * 0.55) / (dimension + 0.55 * overshoot)
}

function trapFocus(container: HTMLElement, event: KeyboardEvent) {
  const items = [...container.querySelectorAll<HTMLElement>("a[href], button")]
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
  if (!container.contains(document.activeElement)) {
    event.preventDefault()
    first.focus()
  }
}

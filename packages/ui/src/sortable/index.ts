import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { frameLoop, prefersReducedMotion, Spring } from "../motion"
import { clampDelta, edgeSpeed, shifts, targetIndex, type Slot } from "./geometry"

export type SortableAxis = "x" | "y"

export interface SortableOptions {
  axis: () => SortableAxis
  /**
   * Item IDs in rendered order. Disabled items can't be picked up but still shift aside, so leave out any item that
   * must stay put.
   */
  ids: () => readonly string[]
  /** The element that scrolls the list, used for auto-scroll and text direction. */
  container: () => HTMLElement | undefined
  /** Called on drop or keyboard move. Update `ids` synchronously so the moved item settles from where it was dropped. */
  onReorder: (from: number, to: number, id: string) => void
  onDragStart?: (id: string, el: HTMLElement) => void
  onDragEnd?: (id: string) => void
  /** Descendants matching this selector never start a drag. */
  ignore?: string
}

type Item = {
  id: () => string
  disabled: () => boolean
  el?: HTMLElement
  handle?: HTMLElement
}

// Positions are in flow coordinates, which grow with the item index; `sign` maps them to physical pixels.
type Layout = { axis: SortableAxis; sign: 1 | -1; ids: string[]; slots: Slot[]; elements: HTMLElement[] }

type Motion = { spring: Spring; axis: SortableAxis; sign: 1 | -1 }

type Drag = Layout & {
  id: string
  pointerId: number
  pointer: number
  origin: number
  scroll: number
  scrollOrigin: number
  scrollMax: number
  edges: [number, number]
  from: number
  to: number
}

const settling = { duration: 0.2, bounce: 0 }

/**
 * A 1D sortable list. Items keep their DOM slots while dragging and move only by transform; the caller reorders its
 * state once on drop. A dedicated `handle` also moves its item with the arrow keys. A whole-item drag adds no keys,
 * roles or attributes, so it can sit on tabs and other widgets that own their keyboard behaviour.
 */
export function createSortable(options: SortableOptions) {
  const items = new Set<Item>()
  const motion = new Map<HTMLElement, Motion>()
  const [active, setActive] = createSignal<string>()
  let pending: { item: Item; event: PointerEvent } | undefined
  let drag: Drag | undefined
  // The pointer that activated a drag stays held until it is released, even after the drag is canceled.
  let held: number | undefined
  let lifted: HTMLElement | undefined
  let stop: (() => void) | undefined

  // Each element's transform comes from one spring, so a new drag or key press continues from where it is drawn.
  const offset = (el: HTMLElement, layout: Layout) => {
    const entry = motion.get(el)

    if (entry && entry.axis === layout.axis && entry.sign === layout.sign) return entry
    const next = { spring: Spring.fromDuration(0, settling), axis: layout.axis, sign: layout.sign }
    motion.set(el, next)

    return next
  }

  const paint = (dt: number) => {
    const reduced = prefersReducedMotion()

    if (drag) {
      const current = drag
      const speed = current.scrollMax > 0 ? edgeSpeed(current.pointer, current.edges[0], current.edges[1]) : 0

      if (speed !== 0) scrollTo(current, current.scroll + speed * dt)
      track(current)
    }

    for (const [el, entry] of motion) {
      const value = reduced ? entry.spring.snap(entry.spring.target).value : entry.spring.step(dt)

      if (value !== 0 || entry.spring.target !== 0 || (drag && el === lifted)) {
        draw(el, entry)
        continue
      }

      motion.delete(el)
      el.style.transform = ""

      if (el === lifted) lower()
    }

    if (drag || motion.size > 0) return true
    stop = undefined

    return false
  }

  // Moves the dragged item to the pointer and the others out of its way. A drop can arrive before the next frame, so
  // it runs on drop as well as on each frame.
  const track = (current: Drag) => {
    const delta = clampDelta(
      current.slots,
      current.from,
      current.pointer - current.origin + current.scroll - current.scrollOrigin,
    )

    const to = targetIndex(current.slots, current.from, delta)

    if (to !== current.to) {
      current.to = to
      const next = shifts(current.slots, current.from, to)
      current.elements.forEach((el, index) => index !== current.from && offset(el, current).spring.set(next[index]!))
    }

    offset(current.elements[current.from]!, current).spring.snap(delta)
  }

  const draw = (el: HTMLElement, entry: Motion) => {
    const px = entry.spring.value * entry.sign
    el.style.transform = entry.axis === "y" ? `translate3d(0, ${px}px, 0)` : `translate3d(${px}px, 0, 0)`
  }

  const animate = () => {
    stop ??= frameLoop.add(paint)
  }

  const lift = (el: HTMLElement) => {
    lower()
    lifted = el

    if (getComputedStyle(el).position === "static") el.style.position = "relative"
    el.style.zIndex = "10"
  }

  const lower = () => {
    if (!lifted) return
    lifted.style.zIndex = ""
    lifted.style.position = ""
    lifted = undefined
  }

  // Layout positions, without the transforms this list is drawing.
  const measure = (): Layout | undefined => {
    const container = options.container()
    const ids = [...options.ids()]
    const byId = elements()
    const found = ids.flatMap((id) => byId.get(id) ?? [])

    if (!container || found.length !== ids.length) return
    const axis = options.axis()
    const sign = axis === "x" && getComputedStyle(container).direction === "rtl" ? -1 : 1

    const slots = found.map((el) => {
      const rect = el.getBoundingClientRect()
      const drawn = (motion.get(el)?.spring.value ?? 0) * sign

      if (axis === "y") return { start: rect.top - drawn, size: rect.height }

      if (sign < 0) return { start: drawn - rect.right, size: rect.width }

      return { start: rect.left - drawn, size: rect.width }
    })

    return { axis, sign, ids, slots, elements: found }
  }

  const elements = () => new Map([...items].flatMap((item) => (item.el ? [[item.id(), item.el] as const] : [])))

  // After the caller's reorder each item sits `moved` further along the flow, so rebase its drawn offset to glide
  // from where it is shown into place. The rebased offset is drawn now: pointerup and keydown are not frame-aligned,
  // so the browser can paint the new order before the next frame callback. The caller may have remounted items, so
  // their elements are looked up again.
  const settle = (layout: Layout, moved: number[] | undefined) => {
    const current = elements()

    if (prefersReducedMotion()) {
      motion.forEach((_, el) => {
        el.style.transform = ""
      })
      motion.clear()
      lower()

      return
    }

    layout.ids.forEach((id, index) => {
      const was = layout.elements[index]!
      const el = current.get(id) ?? was
      const shift = moved?.[index] ?? 0

      if (el !== was) rehome(was, el)

      if (shift === 0 && !motion.has(el)) return
      const entry = offset(el, layout)
      entry.spring.value -= shift
      entry.spring.set(0)
      draw(el, entry)
    })
    animate()
  }

  const rehome = (was: HTMLElement, el: HTMLElement) => {
    const entry = motion.get(was)
    motion.delete(was)
    was.style.transform = ""

    if (entry) motion.set(el, entry)

    if (lifted === was) lift(el)
  }

  const readScroll = (container: HTMLElement, layout: Layout) =>
    layout.axis === "y" ? container.scrollTop : container.scrollLeft * layout.sign

  const scrollTo = (current: Drag, value: number) => {
    const container = options.container()
    current.scroll = Math.min(Math.max(value, 0), current.scrollMax)

    if (!container) return

    if (current.axis === "y") container.scrollTop = current.scroll

    if (current.axis === "x") container.scrollLeft = current.scroll * current.sign
  }

  const pointer = (event: PointerEvent, layout: Layout) =>
    layout.axis === "y" ? event.clientY : event.clientX * layout.sign

  const begin = (item: Item, event: PointerEvent, now: PointerEvent) => {
    const layout = measure()
    const container = options.container()
    const id = item.id()
    const from = options.ids().indexOf(id)

    if (!layout || !container || from < 0 || !item.el) return
    const rect = container.getBoundingClientRect()
    const scroll = readScroll(container, layout)

    lift(item.el)
    getSelection()?.removeAllRanges()

    if (event.target instanceof Element && event.target.isConnected) event.target.setPointerCapture(event.pointerId)

    drag = {
      ...layout,
      id,
      pointerId: event.pointerId,
      pointer: pointer(now, layout),
      origin: pointer(event, layout),
      scroll,
      scrollOrigin: scroll,
      scrollMax:
        layout.axis === "y"
          ? container.scrollHeight - container.clientHeight
          : container.scrollWidth - container.clientWidth,
      edges:
        layout.axis === "y"
          ? [rect.top, rect.bottom]
          : layout.sign < 0
            ? [-rect.right, -rect.left]
            : [rect.left, rect.right],
      from,
      to: from,
    }
    held = event.pointerId
    container.addEventListener("scroll", scrolled, { passive: true })
    window.addEventListener("keydown", escape, true)
    window.addEventListener("selectstart", prevent, true)
    window.addEventListener("blur", blur)

    // Touch scrolls the page unless every move is canceled; handles opt out with `touch-action`, whole items may not.
    if (event.pointerType === "touch") window.addEventListener("touchmove", prevent, { passive: false })
    setActive(id)
    options.onDragStart?.(id, item.el)
    animate()
  }

  const finish = (canceled: boolean) => {
    const current = drag

    if (!current) return

    if (!canceled) track(current)
    drag = undefined
    options.container()?.removeEventListener("scroll", scrolled)
    window.removeEventListener("keydown", escape, true)
    window.removeEventListener("blur", blur)
    window.removeEventListener("touchmove", prevent)

    const moved = !canceled && current.to !== current.from

    if (moved) options.onReorder(current.from, current.to, current.id)
    const placed = moved && options.ids()[current.to] === current.id
    settle(current, placed ? shifts(current.slots, current.from, current.to) : undefined)
    setActive(undefined)
    options.onDragEnd?.(current.id)
  }

  const move = (event: PointerEvent) => {
    if (drag) {
      if (event.pointerId !== drag.pointerId) return
      drag.pointer = pointer(event, drag)
      event.preventDefault()

      return
    }

    if (!pending || event.pointerId !== pending.event.pointerId) return
    const start = pending.event

    if (
      Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < (start.pointerType === "touch" ? 8 : 4)
    )
      return
    const item = pending.item
    pending = undefined
    begin(item, start, event)
  }

  const up = (event: PointerEvent) => {
    if (event.pointerId !== (held ?? pending?.event.pointerId)) return
    const dropped = held !== undefined && event.type === "pointerup"
    release()

    if (drag && dropped) drag.pointer = pointer(event, drag)

    // The pointer is captured by the item it activated on, so its release reads as a click there, even after a cancel.
    if (dropped) {
      window.addEventListener("click", swallow, true)
      setTimeout(() => window.removeEventListener("click", swallow, true), 0)
    }

    finish(!dropped)
  }

  // Until the pointer is released, text selection stays blocked and its click is swallowed by `up`.
  const release = () => {
    pending = undefined
    held = undefined
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    window.removeEventListener("pointercancel", up)
    window.removeEventListener("selectstart", prevent, true)
  }

  // The window can lose the pointer's release, so a blur lets go of it rather than holding it.
  const blur = () => {
    release()
    finish(true)
  }

  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    finish(true)
  }

  const scrolled = () => {
    const container = options.container()

    if (drag && container) drag.scroll = readScroll(container, drag)
  }

  const down = (item: Item) => (event: PointerEvent) => {
    if (event.button !== 0 || drag || held !== undefined || item.disabled()) return
    const target = event.target instanceof Element ? event.target : null

    if (item.handle && !item.handle.contains(target)) return

    if (options.ignore && target?.closest(options.ignore)) return
    release()
    pending = { item, event }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }

  const key = (item: Item) => (event: KeyboardEvent) => {
    if (drag || item.disabled() || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const step = steps[options.axis()].get(event.key)

    if (!step) return
    event.preventDefault()
    const layout = measure()
    const id = item.id()
    const from = options.ids().indexOf(id)
    const to = from + step * (layout?.sign ?? 1)

    if (!layout || from < 0 || to < 0 || to >= layout.elements.length) return
    options.onReorder(from, to, id)

    if (options.ids()[to] !== id) return
    settle(layout, shifts(layout.slots, from, to))
    // Reordering the DOM moves the focused handle, which drops its focus.
    item.handle?.focus()
  }

  // Callers often rebuild the array on unrelated updates, so only a different order or set of IDs cancels.
  createEffect(
    on(
      options.ids,
      (ids) => {
        const started = drag?.ids

        if (started && (ids.length !== started.length || ids.some((id, index) => id !== started[index]))) finish(true)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    release()
    finish(true)
    stop?.()
    motion.forEach((_, el) => {
      el.style.transform = ""
    })
    lower()
  })

  return {
    /** The ID being dragged by pointer. */
    active,
    item(id: () => string, input: { disabled?: () => boolean } = {}) {
      const item: Item = { id, disabled: input.disabled ?? (() => false) }
      const press = down(item)
      const keys = key(item)
      items.add(item)
      onCleanup(() => {
        items.delete(item)
        item.el?.removeEventListener("pointerdown", press)
        item.handle?.removeEventListener("keydown", keys)
      })

      return {
        ref(el: HTMLElement) {
          item.el?.removeEventListener("pointerdown", press)
          item.el = el
          el.addEventListener("pointerdown", press)
        },
        /** Restricts dragging to this element and lets it move the item with the arrow keys. */
        handle(el: HTMLElement) {
          item.handle?.removeEventListener("keydown", keys)
          item.handle = el
          el.style.touchAction = "none"
          el.addEventListener("keydown", keys)
        },
        dragging: () => active() === id(),
      }
    },
  }
}

export type Sortable = ReturnType<typeof createSortable>

export function arrayMove<T>(items: readonly T[], from: number, to: number) {
  const next = items.slice()
  next.splice(to, 0, ...next.splice(from, 1))

  return next
}

const steps = {
  y: new Map([
    ["ArrowUp", -1],
    ["ArrowDown", 1],
  ]),
  x: new Map([
    ["ArrowLeft", -1],
    ["ArrowRight", 1],
  ]),
}

const prevent = (event: Event) => event.preventDefault()

const swallow = (event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  window.removeEventListener("click", swallow, true)
}

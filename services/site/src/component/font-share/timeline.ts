/**
 * A tiny deterministic timeline for the share canvases: one-shot actions at fixed times and a
 * virtual pointer that follows keyframes, dispatching real pointer and mouse events to whatever
 * is under it. `step(t)` may be called with any monotonic t; going backwards restarts the loop.
 */

export type Cursor = { x: number; y: number; down: boolean } | undefined
export type Point = readonly [number, number]
export type Target = string | Point | { at: string; x?: number; y?: number } | (() => Point | undefined) | null
export type Context = ReturnType<typeof context>

export type Timeline = {
  actions?: [number, (ctx: Context) => void][]
  path?: [number, Target][]
  /** Maps a visual (frame) point to the client point the component expects, for scaled stages. */
  map?: (x: number, y: number) => readonly [number, number]
  /** Draw the pointer (default true). */
  cursor?: boolean
  /** Called every step after the actions and before the pointer moves, for continuous effects. */
  tick?: (t: number, ctx: Context) => void
}

export function timeline(frame: HTMLElement, setCursor: (cursor: Cursor) => void, def: Timeline) {
  const ctx = context(frame, def.cursor === false ? () => {} : setCursor, def.map)
  const actions = [...(def.actions ?? [])].sort((a, b) => a[0] - b[0])
  let done = 0
  let last = -1
  return (t: number) => {
    if (t < last) done = 0
    last = t
    while (done < actions.length && actions[done][0] <= t) actions[done++][1](ctx)
    def.tick?.(t, ctx)
    if (def.path) {
      const point = locate(def.path, t, ctx)
      if (point) ctx.move(point[0], point[1])
      if (!point) ctx.leave()
    }
    ctx.release(t)
  }
}

function locate(path: [number, Target][], t: number, ctx: Context) {
  const next = path.findIndex((key) => key[0] > t)
  if (next === -1) return ctx.resolve(path.at(-1)![1])
  if (next === 0) return ctx.resolve(path[0][1])
  const a = path[next - 1]
  const b = path[next]
  const from = ctx.resolve(a[1])
  const to = ctx.resolve(b[1])
  if (!from) return undefined
  if (!to) return from
  const k = inOut((t - a[0]) / (b[0] - a[0]))
  return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k] as const
}

export const inOut = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

function context(
  frame: HTMLElement,
  setCursor: (cursor: Cursor) => void,
  map = (x: number, y: number) => [x, y] as const,
) {
  let hovered: Element | null = null
  let position: readonly [number, number] | undefined
  let downUntil = -1
  let now = 0

  const options = (x: number, y: number, extra: PointerEventInit = {}) => {
    const [clientX, clientY] = map(x, y)
    return {
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerType: "mouse",
      pointerId: 1,
      isPrimary: true,
      view: window,
      ...extra,
    }
  }
  const chain = (element: Element | null) => {
    const list: Element[] = []
    for (let node = element; node; node = node.parentElement) list.push(node)
    return list
  }
  const hover = (element: Element | null, x: number, y: number) => {
    if (element === hovered) return
    const before = chain(hovered)
    const after = chain(element)
    hovered?.dispatchEvent(new PointerEvent("pointerout", options(x, y)))
    hovered?.dispatchEvent(new MouseEvent("mouseout", options(x, y)))
    before
      .filter((node) => !after.includes(node))
      .forEach((node) => {
        node.dispatchEvent(new PointerEvent("pointerleave", options(x, y, { bubbles: false })))
        node.dispatchEvent(new MouseEvent("mouseleave", options(x, y, { bubbles: false })))
      })
    element?.dispatchEvent(new PointerEvent("pointerover", options(x, y)))
    element?.dispatchEvent(new MouseEvent("mouseover", options(x, y)))
    after
      .filter((node) => !before.includes(node))
      .reverse()
      .forEach((node) => {
        node.dispatchEvent(new PointerEvent("pointerenter", options(x, y, { bubbles: false })))
        node.dispatchEvent(new MouseEvent("mouseenter", options(x, y, { bubbles: false })))
      })
    hovered = element
  }
  const show = () => position && setCursor({ x: position[0], y: position[1], down: now < downUntil })

  const ctx = {
    frame,
    get hovered() {
      return hovered
    },
    get position() {
      return position
    },
    $: <T extends Element = HTMLElement>(selector: string) => frame.querySelector<T>(selector)!,
    $$: <T extends Element = HTMLElement>(selector: string) => [...frame.querySelectorAll<T>(selector)],
    resolve(target: Target): readonly [number, number] | undefined {
      if (target === null) return undefined
      if (typeof target === "function") return target()
      if (Array.isArray(target)) return target as readonly [number, number]
      const spec = typeof target === "string" ? { at: target } : (target as { at: string; x?: number; y?: number })
      const element = frame.querySelector(spec.at)
      if (!element) return undefined
      const rect = element.getBoundingClientRect()
      return [rect.left + rect.width * (spec.x ?? 0.5), rect.top + rect.height * (spec.y ?? 0.5)] as const
    },
    move(x: number, y: number) {
      if (position && position[0] === x && position[1] === y) return
      position = [x, y]
      const element = document.elementFromPoint(x, y)
      hover(element, x, y)
      element?.dispatchEvent(new PointerEvent("pointermove", options(x, y)))
      element?.dispatchEvent(new MouseEvent("mousemove", options(x, y)))
      show()
    },
    leave() {
      if (!position) return
      const [x, y] = position
      hover(null, x, y)
      position = undefined
      setCursor(undefined)
    },
    /** Press and release at the pointer, or on `selector` when given. */
    click(selector?: string) {
      const element = selector ? frame.querySelector(selector) : hovered
      if (!element) return
      const [x, y] = position ?? ctx.resolve(selector!)!
      element.dispatchEvent(new PointerEvent("pointerdown", options(x, y, { button: 0, buttons: 1 })))
      element.dispatchEvent(new MouseEvent("mousedown", options(x, y, { button: 0, buttons: 1 })))
      element.dispatchEvent(new PointerEvent("pointerup", options(x, y, { button: 0 })))
      element.dispatchEvent(new MouseEvent("mouseup", options(x, y, { button: 0 })))
      element.dispatchEvent(new MouseEvent("click", options(x, y, { button: 0 })))
      downUntil = now + 180
      show()
    },
    /** Set a form control's value as if the user had typed or dragged it. */
    input(selector: string | HTMLInputElement | HTMLTextAreaElement, value: string | number) {
      const element = typeof selector === "string" ? frame.querySelector<HTMLInputElement>(selector)! : selector
      element.value = String(value)
      element.dispatchEvent(new Event("input", { bubbles: true }))
    },
    release(t: number) {
      const wasDown = now < downUntil
      now = t
      if (wasDown && now >= downUntil) show()
    },
  }
  return ctx
}

/** Actions that turn `from` into `to` one keystroke at a time: backspace to the common prefix, then type. */
export function typing(start: number, from: string, to: string, apply: (text: string) => void, gap = 90) {
  let prefix = 0
  while (prefix < from.length && prefix < to.length && from[prefix] === to[prefix]) prefix++
  const steps = [
    ...Array.from({ length: from.length - prefix }, (_, index) => from.slice(0, from.length - index - 1)),
    ...Array.from({ length: to.length - prefix }, (_, index) => to.slice(0, prefix + index + 1)),
  ]
  return {
    actions: steps.map((text, index) => [start + index * gap, () => apply(text)] as [number, () => void]),
    end: start + steps.length * gap,
  }
}

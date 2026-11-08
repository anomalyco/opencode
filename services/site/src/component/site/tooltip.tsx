import "./tooltip.css"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"

/**
 * One tooltip for every element with a `data-tip` attribute, shown above it: after 400ms on hover,
 * at once when another one closed less than a second ago, and on keyboard focus. Not on touch.
 * It lines up with the element's left edge on the left half of the window and its right edge on
 * the right half, so it stays on screen at either corner. With `data-tip-align="center"` it is
 * centred over the element instead, and moves in only as far as it needs to stay 4px inside the
 * window. Near the top of the window, with no room above, it shows below instead.
 */
export function Tooltips() {
  const [tip, setTip] = createSignal<{
    text: string
    left?: number
    right?: number
    center?: number
    bottom?: number
    top?: number
  }>()
  const state: { timer?: ReturnType<typeof setTimeout>; closed: number } = { closed: 0 }

  onMount(() => {
    const owner = (node: EventTarget | null) =>
      node instanceof Element ? node.closest<HTMLElement>("[data-tip]") : null
    const show = (element: HTMLElement) => {
      clearTimeout(state.timer)
      const open = () => {
        const rect = element.getBoundingClientRect()
        const width = document.documentElement.clientWidth
        const left = rect.left + rect.width / 2 < width / 2
        const side = rect.top < 36 ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }
        if (element.dataset.tipAlign === "center")
          return setTip({
            text: element.dataset.tip ?? "",
            center: rect.left + rect.width / 2,
            ...side,
          })
        setTip({
          text: element.dataset.tip ?? "",
          left: left ? Math.max(rect.left, 4) : undefined,
          right: left ? undefined : Math.max(width - rect.right, 4),
          ...side,
        })
      }
      if (tip() || performance.now() - state.closed < 1000) return open()
      state.timer = setTimeout(open, 400)
    }
    const hide = () => {
      clearTimeout(state.timer)
      state.timer = undefined
      if (tip()) state.closed = performance.now()
      setTip(undefined)
    }
    const over = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return
      const element = owner(event.target)
      if (element) return show(element)
      if (tip() || state.timer) hide()
    }
    const focus = (event: FocusEvent) => {
      const element = owner(event.target)
      if (element?.matches(":focus-visible")) show(element)
    }
    document.addEventListener("pointerover", over)
    document.addEventListener("pointerdown", hide, true)
    document.addEventListener("focusin", focus)
    document.addEventListener("focusout", hide)
    // Escape dismisses it without moving focus or the pointer (WCAG 1.4.13).
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (tip() || state.timer)) hide()
    }
    document.addEventListener("keydown", escape)
    onCleanup(() => {
      document.removeEventListener("keydown", escape)
      clearTimeout(state.timer)
      document.removeEventListener("pointerover", over)
      document.removeEventListener("pointerdown", hide, true)
      document.removeEventListener("focusin", focus)
      document.removeEventListener("focusout", hide)
    })
  })

  return (
    <Show when={tip()}>
      {(current) => {
        const state: { element?: HTMLDivElement } = {}
        // Centred tips: measured once they have their text, then kept 4px inside the window.
        createEffect(() => {
          const center = current().center
          const element = state.element
          if (!element) return
          // A left-or-right tip after a centred one must not keep the centred one's left.
          if (center === undefined) {
            if (current().left === undefined) element.style.left = ""
            return
          }
          element.style.visibility = "hidden"
          requestAnimationFrame(() => {
            const max = document.documentElement.clientWidth - element.offsetWidth - 4
            element.style.left = `${Math.round(Math.min(Math.max(center - element.offsetWidth / 2, 4), max))}px`
            element.style.visibility = ""
          })
        })
        return (
          <div
            data-component="tooltip"
            role="tooltip"
            ref={(element) => (state.element = element)}
            style={{
              left: current().left === undefined ? undefined : `${current().left}px`,
              right: current().right === undefined ? undefined : `${current().right}px`,
              top: current().top === undefined ? undefined : `${current().top}px`,
              bottom: current().bottom === undefined ? undefined : `${current().bottom}px`,
            }}
          >
            {current().text}
          </div>
        )
      }}
    </Show>
  )
}

/**
 * One tooltip, `tip` (tooltip.tsx renders it, hidden), for every element with a `data-tip` attribute: above
 * it after 400ms on hover, at once when another one closed less than a second ago, and on keyboard
 * focus; not on touch. It lines up with the element's left edge on the left half of the window and its
 * right edge on the right half, so it stays on screen at either corner; with `data-tip-align="center"`
 * it is centred over the element and kept 4px inside the window. Near the top of the window, with no
 * room above, it shows below instead. Escape dismisses it. No Solid, so the hydrated pages (tooltip.tsx)
 * and the static pages (src/client/entry.ts) share it. Returns the function that stops it.
 */
export function startTooltips(tip: HTMLElement) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = 0
  const owner = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>("[data-tip]") : null)

  const show = (element: HTMLElement) => {
    clearTimeout(timer)
    const open = () => {
      const rect = element.getBoundingClientRect()
      const width = document.documentElement.clientWidth
      tip.textContent = element.dataset.tip ?? ""
      tip.style.cssText = ""
      if (rect.top < 36) tip.style.top = `${rect.bottom + 6}px`
      if (rect.top >= 36) tip.style.bottom = `${innerHeight - rect.top + 6}px`
      tip.hidden = false
      if (element.dataset.tipAlign === "center") {
        // Measured once it has its text, then kept 4px inside the window.
        const center = rect.left + rect.width / 2
        tip.style.visibility = "hidden"
        return requestAnimationFrame(() => {
          const max = document.documentElement.clientWidth - tip.offsetWidth - 4
          tip.style.left = `${Math.round(Math.min(Math.max(center - tip.offsetWidth / 2, 4), max))}px`
          tip.style.visibility = ""
        })
      }
      if (rect.left + rect.width / 2 < width / 2) tip.style.left = `${Math.max(rect.left, 4)}px`
      if (rect.left + rect.width / 2 >= width / 2) tip.style.right = `${Math.max(width - rect.right, 4)}px`
    }
    if (!tip.hidden || performance.now() - closed < 1000) return void open()
    timer = setTimeout(open, 400)
  }
  const hide = () => {
    clearTimeout(timer)
    timer = undefined
    if (tip.hidden) return
    closed = performance.now()
    tip.hidden = true
  }

  const stop = new AbortController()
  const on = { signal: stop.signal }
  document.addEventListener(
    "pointerover",
    (event) => {
      if (event.pointerType !== "mouse") return
      const element = owner(event.target)
      if (element) return show(element)
      if (!tip.hidden || timer) hide()
    },
    on,
  )
  document.addEventListener("pointerdown", hide, { ...on, capture: true })
  document.addEventListener(
    "focusin",
    (event) => {
      const element = owner(event.target)
      if (element?.matches(":focus-visible")) show(element)
    },
    on,
  )
  document.addEventListener("focusout", hide, on)
  // Without moving focus or the pointer (WCAG 1.4.13).
  document.addEventListener("keydown", (event) => event.key === "Escape" && hide(), on)
  return () => {
    hide()
    stop.abort()
  }
}

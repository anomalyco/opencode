import { html, on, site } from "./dom"

/**
 * One tooltip for every element with a `data-tip` attribute (tooltip.tsx on the hydrated pages): above
 * it after 400ms on hover, at once when another one closed less than a second ago, and on keyboard
 * focus; not on touch. It lines up with the element's left edge on the left half of the window and its
 * right edge on the right half; with `data-tip-align="center"` it is centred over the element and kept
 * 4px inside the window. Near the top of the window it shows below instead. Escape dismisses it.
 */
export function startTooltips() {
  const tip = document.createElement("div")
  tip.dataset.component = "tooltip"
  tip.role = "tooltip"
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = 0
  const owner = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>("[data-tip]") : null)

  const show = (element: HTMLElement) => {
    clearTimeout(timer)
    const open = () => {
      const rect = element.getBoundingClientRect()
      const width = html.clientWidth
      tip.textContent = element.dataset.tip ?? ""
      tip.style.cssText = ""
      if (rect.top < 36) tip.style.top = `${rect.bottom + 6}px`
      if (rect.top >= 36) tip.style.bottom = `${innerHeight - rect.top + 6}px`
      if (!tip.isConnected) site.append(tip)
      if (element.dataset.tipAlign === "center") {
        // Measured once it has its text, then kept 4px inside the window.
        const center = rect.left + rect.width / 2
        tip.style.visibility = "hidden"
        return requestAnimationFrame(() => {
          const max = html.clientWidth - tip.offsetWidth - 4
          tip.style.left = `${Math.round(Math.min(Math.max(center - tip.offsetWidth / 2, 4), max))}px`
          tip.style.visibility = ""
        })
      }
      if (rect.left + rect.width / 2 < width / 2) tip.style.left = `${Math.max(rect.left, 4)}px`
      if (rect.left + rect.width / 2 >= width / 2) tip.style.right = `${Math.max(width - rect.right, 4)}px`
    }
    if (tip.isConnected || performance.now() - closed < 1000) return void open()
    timer = setTimeout(open, 400)
  }
  const hide = () => {
    clearTimeout(timer)
    timer = undefined
    if (!tip.isConnected) return
    closed = performance.now()
    tip.remove()
  }

  on("pointerover", (event) => {
    if (event.pointerType !== "mouse") return
    const element = owner(event.target)
    if (element) return show(element)
    if (tip.isConnected || timer) hide()
  })
  on("pointerdown", hide, { capture: true })
  on("focusin", (event) => {
    const element = owner(event.target)
    if (element?.matches(":focus-visible")) show(element)
  })
  on("focusout", hide)
  // Without moving focus or the pointer (WCAG 1.4.13).
  on("keydown", (event) => event.key === "Escape" && hide())
}

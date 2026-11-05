import "./products-order.css"
import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { designMode } from "./design-copy"
import { productPages, type PageSlug } from "./product-data"
import { normalizeProductsOrder, productIds, setSiteSetting, siteSettings } from "./settings"

/**
 * The order of the /product grid (Design mode: drag a card, or focus inside it and press ⌥ with an
 * arrow key). The cards keep their markup order; a style element gives each one a grid `order`, so
 * a saved order applies before first paint (productsOrderScript) and changes without re-rendering.
 * Like the nav's drag (nav-order.tsx), a press only becomes a drag once the pointer moves.
 */

const styleId = "products-order"
const scope = '[data-site][data-page="products"] [data-layout="grid"] [data-card="'

/**
 * Each card's grid `order`, or none for the default order, so the markup's order shows (Mobile first
 * on a phone or tablet, deviceOrder). productsOrderScript inlines this function as source.
 */
function orderRules(order: readonly string[], scope: string, ids: readonly string[]) {
  if (order.every((id, index) => id === ids[index])) return ""
  return order.map((id, index) => scope + id + '"]{order:' + (index + 1) + "}").join("")
}

/** Runs while the page is parsed: writes the saved order before the cards paint. Saved orders are
 * Design mode's, so the script is empty outside the development server.
 */
export const productsOrderScript = import.meta.env.DEV
  ? `(()=>{try{const s=JSON.parse(localStorage.getItem("opencode-site-settings-v3")||"null");const o=s&&Array.isArray(s.productsOrder)?s.productsOrder:[];const ids=${JSON.stringify(productIds)};const k=o.filter((id,i)=>ids.includes(id)&&o.indexOf(id)===i);const e=document.getElementById("${styleId}")||document.head.appendChild(Object.assign(document.createElement("style"),{id:"${styleId}"}));e.textContent=(${String(orderRules)})([...k,...ids.filter((id)=>!k.includes(id))],${JSON.stringify(scope)},ids)}catch{}})()`
  : ""

// While a card is being dragged, the draft order drives the grid instead of the saved one.
const [draft, setDraft] = createSignal<PageSlug[]>()

/** True while a card is being dragged (Design mode hides its hover outline meanwhile). */
export const productsSorting = () => draft() !== undefined

/** Every product with a page, in the saved /product order. */
export const orderedProducts = () =>
  siteSettings.productsOrder.flatMap((id) => productPages.filter((product) => product.slug === id))

export function productsOrderChanged() {
  return siteSettings.productsOrder.some((id, index) => id !== productIds[index])
}

export function resetProductsOrder() {
  setSiteSetting("productsOrder", [...productIds])
}

function write(order: readonly string[]) {
  const element =
    document.getElementById(styleId) ??
    document.head.appendChild(Object.assign(document.createElement("style"), { id: styleId }))
  element.textContent = orderRules(order, scope, productIds)
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
const ease = "cubic-bezier(0.2, 0, 0, 1)"
// How far the pointer moves before a press on a card becomes a drag; less is a click.
const threshold = 4

type Drag = {
  id: PageSlug
  start: PageSlug[]
  pointer: number
  from: { x: number; y: number }
  at: { x: number; y: number }
  // Where in the card the pointer holds it.
  grab: { x: number; y: number }
  lifted: boolean
}

/**
 * Makes the /product grid sortable in Design mode and keeps its order in step with Settings (use
 * as the grid's ref). The cards need `data-card`.
 */
export function sortableProducts(grid: HTMLElement) {
  const state: { drag?: Drag; swallow?: boolean } = {}
  const cards = () => [...grid.querySelectorAll<HTMLElement>(":scope > [data-card]")]
  const find = (id: string) => grid.querySelector<HTMLElement>(`:scope > [data-card="${id}"]`)
  const current = () => draft() ?? siteSettings.productsOrder
  const label = (id: PageSlug) => productPages.find((product) => product.slug === id)?.name ?? id

  onMount(() => createEffect(() => write(current())))

  // The card's box as laid out, ignoring transforms (its own and the FLIP ones).
  function slot(card: HTMLElement) {
    const box = grid.getBoundingClientRect()
    return {
      left: box.left + card.offsetLeft,
      top: box.top + card.offsetTop,
      width: card.offsetWidth,
      height: card.offsetHeight,
    }
  }

  // Moves `id` to `index`; the other cards slide from where they were (FLIP).
  function place(id: PageSlug, index: number, commit: boolean) {
    const others = current().filter((other) => other !== id)
    const next = normalizeProductsOrder([...others.slice(0, index), id, ...others.slice(index)])
    if (next.join() === current().join()) return
    const before = new Map(
      cards()
        .filter((card) => card.dataset.card !== state.drag?.id || !state.drag?.lifted)
        .map((card) => [card, card.getBoundingClientRect()] as const),
    )
    if (commit) setSiteSetting("productsOrder", next)
    if (!commit) setDraft(next)
    write(next)
    if (reduced()) return
    before.forEach((box, card) => {
      const after = card.getBoundingClientRect()
      const dx = box.left - after.left
      const dy = box.top - after.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
      card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: 220,
        easing: ease,
      })
    })
  }

  // The dragged card follows the pointer; it lands in the slot whose centre is nearest.
  function follow(drag: Drag) {
    const card = find(drag.id)
    if (!card) return
    const slots = current().flatMap((id) => {
      const element = find(id)
      return element ? [slot(element)] : []
    })
    const centre = { x: drag.at.x - drag.grab.x, y: drag.at.y - drag.grab.y }
    const nearest = slots.reduce(
      (best, box, index) => {
        const distance = Math.hypot(box.left - centre.x, box.top - centre.y)
        return distance < best.distance ? { index, distance } : best
      },
      { index: 0, distance: Infinity },
    )
    place(drag.id, nearest.index, false)
    const own = slot(card)
    card.style.transform = `translate(${centre.x - own.left}px, ${centre.y - own.top}px)`
  }

  function settle(id: PageSlug) {
    const card = find(id)
    if (!card) return
    const from = card.style.transform
    card.style.transform = ""
    delete card.dataset.cardLifted
    if (from && !reduced()) card.animate([{ transform: from }, { transform: "none" }], { duration: 200, easing: ease })
  }

  function end(commit: boolean) {
    const drag = state.drag
    state.drag = undefined
    document.removeEventListener("pointermove", move)
    document.removeEventListener("pointerup", up)
    document.removeEventListener("pointercancel", cancel)
    document.removeEventListener("keydown", escape, true)
    if (!drag?.lifted) return
    // The click that ends a drag neither follows the card's links nor edits its copy.
    state.swallow = true
    setTimeout(() => (state.swallow = false), 0)
    if (commit) setSiteSetting("productsOrder", draft() ?? drag.start)
    setDraft(undefined)
    if (!commit) write(drag.start)
    settle(drag.id)
    const position = `position ${current().indexOf(drag.id) + 1} of ${current().length}`
    announce(commit ? `${label(drag.id)}, ${position}.` : `Cancelled. ${label(drag.id)} is back at ${position}.`)
  }

  const move = (event: PointerEvent) => {
    const drag = state.drag
    if (!drag || event.pointerId !== drag.pointer) return
    drag.at = { x: event.clientX, y: event.clientY }
    if (!drag.lifted && Math.hypot(event.clientX - drag.from.x, event.clientY - drag.from.y) < threshold) return
    if (!drag.lifted) {
      const card = find(drag.id)
      if (!card) return end(false)
      const own = slot(card)
      drag.lifted = true
      drag.grab = { x: drag.from.x - own.left, y: drag.from.y - own.top }
      card.dataset.cardLifted = ""
      setDraft([...siteSettings.productsOrder])
    }
    event.preventDefault()
    follow(drag)
  }
  const up = (event: PointerEvent) => {
    if (event.pointerId === state.drag?.pointer) end(true)
  }
  const cancel = (event: PointerEvent) => {
    if (event.pointerId === state.drag?.pointer) end(false)
  }
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !state.drag?.lifted) return
    // Design mode stays on: the Escape only cancels the drag.
    event.preventDefault()
    event.stopImmediatePropagation()
    end(false)
  }

  const down = (event: PointerEvent) => {
    const card = (event.target as Element).closest<HTMLElement>("[data-card]")
    if (!designMode() || event.button !== 0 || !card || state.drag) return
    // Menus and buttons inside a card keep working.
    if ((event.target as Element).closest('button, [data-slot="menu"]')) return
    state.drag = {
      id: card.dataset.card as PageSlug,
      start: [...siteSettings.productsOrder],
      pointer: event.pointerId,
      from: { x: event.clientX, y: event.clientY },
      at: { x: event.clientX, y: event.clientY },
      grab: { x: 0, y: 0 },
      lifted: false,
    }
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", up)
    document.addEventListener("pointercancel", cancel)
    document.addEventListener("keydown", escape, true)
  }
  // On the window, ahead of Design mode's own click handler on the document.
  const click = (event: MouseEvent) => {
    if (!state.swallow || !grid.contains(event.target as Node)) return
    state.swallow = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  // Links and images drag as URLs by default; in Design mode the card moves instead.
  const dragstart = (event: DragEvent) => {
    if (designMode()) event.preventDefault()
  }
  const key = (event: KeyboardEvent) => {
    if (!designMode() || !event.altKey || event.metaKey || event.ctrlKey) return
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key]
    const card = (event.target as Element).closest<HTMLElement>("[data-card]")
    if (!step || !card) return
    event.preventDefault()
    const id = card.dataset.card as PageSlug
    const index = current().indexOf(id) + step
    if (index < 0 || index >= current().length) return announce(`${label(id)} can't move further.`)
    place(id, index, true)
    announce(`${label(id)}, position ${index + 1} of ${current().length}.`)
  }

  function announce(text: string) {
    const region =
      grid.parentElement?.querySelector<HTMLElement>(':scope > [data-slot="products-announcer"]') ??
      grid.parentElement?.appendChild(document.createElement("div"))
    if (!region) return
    region.dataset.slot = "products-announcer"
    region.setAttribute("role", "status")
    region.setAttribute("aria-live", "assertive")
    region.textContent = text
  }

  grid.addEventListener("pointerdown", down)
  grid.addEventListener("dragstart", dragstart)
  grid.addEventListener("keydown", key)
  window.addEventListener("click", click, true)
  onCleanup(() => {
    if (state.drag) end(false)
    grid.removeEventListener("pointerdown", down)
    grid.removeEventListener("dragstart", dragstart)
    grid.removeEventListener("keydown", key)
    window.removeEventListener("click", click, true)
  })
}

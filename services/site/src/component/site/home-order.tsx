import "./home-order.css"
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import {
  homeSections,
  normalizeHomeOrder,
  setSiteSetting,
  siteSettings,
  siteSettingsDefaults,
  type HomeSection,
} from "./settings"

/**
 * The order of the home sections below the hero. The page markup keeps its default order; a style
 * element gives each section a flex `order` (the content column is a flex column), so a saved
 * order applies before first paint (see homeOrderScript) and changes without re-rendering.
 */

// Direct children of the home page content. The logo row and the carousel are shared components,
// so they are matched by their own data-component.
const selectors: Record<HomeSection, string> = {
  // The row (Logo layout row styles) or the "section" layout's block, whichever is shown.
  logos: ':is([data-component="logo-wall"], [data-section="logos"])',
  products: '[data-component="products"]',
  what: '[data-section="what"]',
  getStarted: '[data-section="getStarted"]',
  byos: '[data-section="byos"]',
  tools: '[data-section="tools"]',
  // Open source proof as its own section moves with the stats, right after them.
  openSource: ':is([data-section="openSource"], [data-section="openSourceProof"])',
  console: '[data-section="console"]',
}

const labels: Record<HomeSection, string> = {
  logos: "Logo row",
  products: "Product carousel",
  what: "What is OpenCode?",
  getStarted: "Get started",
  byos: "Bring your own subs",
  tools: "Bring your own tools",
  openSource: "Open source",
  console: "Console",
}

const scope = '[data-site][data-page="home"] [data-component="content"] > [data-slot="page"] > '
const styleId = "home-order"

type OrderOptions = { toolsOff: boolean; logosShown: boolean; logoDividers: boolean }

/**
 * The style rules for a section order: each section's flex `order`, then two fixes that depend on
 * what comes after the logo row.
 * - The logo row sets the carousel's top space when it comes right before it in the markup
 *   (logo-wall.css). Once the order puts something else between them, the carousel gets back its
 *   own top margin (3rem, products.css). The tools section counts only when it is on.
 * - Settings › Logo dividers "off" hides the drawn divider above the logo row and the one on top of
 *   whichever section follows it in this order. The border stays as wide (transparent), so the
 *   spacing doesn't change; the dither gradient's dots, drawn in pseudo-elements, are hidden.
 * homeOrderScript inlines this function as source, so it may only use its arguments.
 */
function orderRules(order: readonly string[], options: OrderOptions, sel: Record<string, string>, scope: string) {
  const visible = order.filter((id) => !(id === "tools" && options.toolsOff))
  const next = visible[visible.indexOf("logos") + 1]
  const dither = scope.replace("[data-site]", '[data-site][data-spacer="dither gradient"]')
  const quiet = (target: string) =>
    scope +
    target +
    "{border-top-color:transparent;border-image:none;background-image:none}" +
    dither +
    target +
    "::before," +
    dither +
    target +
    "::after{display:none}"
  return (
    order.map((id, index) => (sel[id] ? scope + sel[id] + "{order:" + (index + 1) + "}" : "")).join("") +
    (next === "products" ? "" : scope + sel.logos + ' + [data-component="products"]{margin-top:3rem}') +
    (options.logosShown && !options.logoDividers ? quiet(sel.logos) + (next && sel[next] ? quiet(sel[next]) : "") : "")
  )
}

/** Runs while the page is parsed: writes the saved order before the sections paint. Saved orders are
 * Design mode's, so the script is empty outside the development server.
 */
export const homeOrderScript = import.meta.env.DEV
  ? `(()=>{try{const s=JSON.parse(localStorage.getItem("opencode-site-settings-v3")||"null");const o=s&&Array.isArray(s.homeOrder)?s.homeOrder:[];const ids=${JSON.stringify(homeSections)};const k=o.filter((id,i)=>ids.includes(id)&&o.indexOf(id)===i);const order=ids.reduce((o,id,i)=>{if(o.includes(id))return o;const b=ids.slice(0,i).reverse().find((x)=>o.includes(x));const at=b===undefined?0:o.indexOf(b)+1;return[...o.slice(0,at),id,...o.slice(at)]},k);const e=document.getElementById("${styleId}")||document.head.appendChild(Object.assign(document.createElement("style"),{id:"${styleId}"}));e.textContent=(${String(orderRules)})(order,{toolsOff:!!s&&s.toolsSection==="off",logosShown:!(s&&s.logoWall==="off"),logoDividers:!!s&&s.logoDividers==="on"},${JSON.stringify(selectors)},${JSON.stringify(scope)})}catch{}})()`
  : ""

/**
 * The default order's rules, rendered by the server as the style element the order lives in. The
 * markup's order isn't the default one (the logo row comes before the carousel in it), so without
 * these the sections would paint in markup order and move once the page's code writes the order
 * (production keeps no saved order, so this is the order it shows; in development the pre-paint
 * script and then the store rewrite the same element).
 */
export const homeOrderStyleId = styleId
export const homeOrderDefaultCss = orderRules(
  homeSections,
  {
    toolsOff: siteSettingsDefaults.toolsSection === "off",
    logosShown: siteSettingsDefaults.logoWall !== "off",
    logoDividers: siteSettingsDefaults.logoDividers === "on",
  },
  selectors,
  scope,
)

// While a section is being moved, the draft order drives the page instead of the saved one.
const [draft, setDraft] = createSignal<HomeSection[]>()

/** True while a home section is being moved (Design mode hides its hover outline meanwhile). */
export const homeSorting = () => draft() !== undefined

function write(order: readonly string[]) {
  const element =
    document.getElementById(styleId) ??
    document.head.appendChild(Object.assign(document.createElement("style"), { id: styleId }))
  element.textContent = orderRules(
    order,
    {
      toolsOff: siteSettings.toolsSection === "off",
      logosShown: siteSettings.logoWall !== "off",
      logoDividers: siteSettings.logoDividers === "on",
    },
    selectors,
    scope,
  )
}

/** Keeps the page's section order in step with Settings (call once from the home page). */
export function useHomeOrder() {
  // Production keeps no saved order: the server's style element already holds the default's rules.
  if (!import.meta.env.DEV) return
  onMount(() => {
    createEffect(() => write(draft() ?? siteSettings.homeOrder))
  })
}

export function homeOrderChanged() {
  return siteSettings.homeOrder.some((id, index) => id !== homeSections[index])
}

export function resetHomeOrder() {
  setSiteSetting("homeOrder", [...homeSections])
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

function find(id: HomeSection) {
  return document.querySelector<HTMLElement>(scope + selectors[id])
}

/** Moves to `order` and slides every other section from where it was (FLIP). */
function reorder(order: HomeSection[], lifted?: HomeSection) {
  const before = new Map(
    order.flatMap((id) => {
      const element = find(id)
      return element && id !== lifted ? [[id, element.getBoundingClientRect().top] as const] : []
    }),
  )
  setDraft(order)
  write(order)
  if (reduced()) return
  before.forEach((top, id) => {
    const element = find(id)
    const delta = element ? top - element.getBoundingClientRect().top : 0
    if (!element || Math.abs(delta) < 1) return
    element.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], {
      duration: 220,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    })
  })
}

type Drag = {
  id: HomeSection
  start: HomeSection[]
  grab: number
  pointer: number
  keyboard: boolean
}

/** Design mode: a grip beside each home section, to drag it (or move it with the keyboard). */
export function SectionHandles() {
  const [present, setPresent] = createSignal<HomeSection[]>([])
  const [hovered, setHovered] = createSignal<HomeSection>()
  const [drag, setDrag] = createSignal<Drag>()
  const [message, setMessage] = createSignal("")
  const handles = new Map<HomeSection, HTMLButtonElement>()
  let line: HTMLDivElement | undefined

  const visible = () => (draft() ?? siteSettings.homeOrder).filter((id) => present().includes(id))
  const position = (id: HomeSection) => visible().indexOf(id) + 1
  const announce = (text: string) => setMessage(text)

  onMount(() => {
    const frame = { id: 0 }
    const tick = () => {
      // Sections hidden by a setting (display: none) get no handle.
      const ids = homeSections.filter((id) => find(id)?.getClientRects().length)
      if (ids.join() !== present().join()) setPresent(ids)
      const topbar = document.querySelector('[data-component="topbar"]')?.getBoundingClientRect()
      // The small-screen top bar sticks to the top of the window; the handles stay below it.
      const top = topbar && topbar.height > 0 ? Math.max(0, topbar.bottom) : 0
      const current = drag()
      ids.forEach((id) => {
        const element = find(id)
        const handle = handles.get(id)
        if (!element || !handle) return
        const rect = element.getBoundingClientRect()
        // Beside the section's top-left corner, outside it; on a tall section, pinned to the top of
        // the window while the section is still on screen.
        const y = Math.min(Math.max(rect.top, top + 4), rect.bottom - handle.offsetHeight)
        handle.style.transform = `translate(${Math.max(2, rect.left - handle.offsetWidth - 6)}px, ${y}px)`
      })
      if (current && line) {
        const element = find(current.id)
        const order = visible()
        const after = order[order.indexOf(current.id) + 1]
        const next = after ? find(after) : undefined
        if (element) {
          // In the gap the section will drop into: between its own slot and the section after it
          // (or just below the slot when it goes last).
          const slot = slotTop(element) + element.offsetHeight
          const y = next ? (slot + next.getBoundingClientRect().top) / 2 : slot + 12
          const rect = element.getBoundingClientRect()
          line.style.transform = `translateY(${y}px)`
          line.style.left = `${rect.left}px`
          line.style.width = `${rect.width}px`
        }
      }
      if (current && line) {
        if (!current.keyboard) {
          follow(current)
          const edge = 64
          if (current.pointer < edge) window.scrollBy(0, -Math.ceil((edge - current.pointer) / 4))
          if (current.pointer > window.innerHeight - edge)
            window.scrollBy(0, Math.ceil((current.pointer - window.innerHeight + edge) / 4))
        }
      }
      frame.id = requestAnimationFrame(tick)
    }
    frame.id = requestAnimationFrame(tick)

    const hover = (event: PointerEvent) => {
      if (drag() || event.pointerType !== "mouse") return
      const found = present().find((id) => {
        const rect = find(id)?.getBoundingClientRect()
        return (
          !!rect &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom &&
          event.clientX >= rect.left - 32 &&
          event.clientX <= rect.right
        )
      })
      setHovered(found)
    }
    document.addEventListener("pointermove", hover, { passive: true })
    onCleanup(() => {
      cancelAnimationFrame(frame.id)
      document.removeEventListener("pointermove", hover)
      if (drag()) cancel()
    })
  })

  // The section's top in the viewport as laid out, ignoring its drag transform.
  function slotTop(element: HTMLElement) {
    const transform = element.style.transform
    element.style.transform = ""
    const top = element.getBoundingClientRect().top
    element.style.transform = transform
    return top
  }

  // The dragged section follows the pointer from its layout slot.
  function follow(current: Drag) {
    const element = find(current.id)
    if (!element) return
    const offset = current.pointer - current.grab - slotTop(element)
    element.style.transform = `translateY(${offset}px) scale(1.005)`
    // Where it would land: past the middle of each other section the pointer has crossed.
    const others = visible().filter((id) => id !== current.id)
    const index = others.filter((id) => {
      const rect = find(id)?.getBoundingClientRect()
      return !!rect && rect.top + rect.height / 2 < current.pointer
    }).length
    const next = [...others.slice(0, index), current.id, ...others.slice(index)]
    if (next.join() === visible().join()) return
    reorder(withHidden(next), current.id)
  }

  // Sections that are off (tools, logo row) keep their saved place in the order.
  function withHidden(order: HomeSection[]) {
    const full = draft() ?? siteSettings.homeOrder
    const queue = [...order]
    return normalizeHomeOrder(full.map((id) => (present().includes(id) ? (queue.shift() ?? id) : id)))
  }

  function lift(id: HomeSection, keyboard: boolean, pointer: number) {
    const element = find(id)
    if (!element) return
    setDraft([...siteSettings.homeOrder])
    setDrag({
      id,
      start: [...siteSettings.homeOrder],
      grab: pointer - element.getBoundingClientRect().top,
      pointer,
      keyboard,
    })
    element.dataset.lifted = ""
    announce(
      `Picked up ${labels[id]}, position ${position(id)} of ${visible().length}.` +
        (keyboard ? " Use the arrow keys to move it, Space to drop, Escape to cancel." : ""),
    )
  }

  function settle(id: HomeSection) {
    const element = find(id)
    if (!element) return
    const from = element.style.transform
    element.style.transform = ""
    delete element.dataset.lifted
    if (from && !reduced())
      element.animate([{ transform: from }, { transform: "none" }], {
        duration: 200,
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      })
  }

  function drop() {
    const current = drag()
    if (!current) return
    const order = draft() ?? current.start
    setSiteSetting("homeOrder", order)
    settle(current.id)
    setDrag(undefined)
    setDraft(undefined)
    announce(`Dropped ${labels[current.id]} at position ${position(current.id)} of ${visible().length}.`)
  }

  function cancel() {
    const current = drag()
    if (!current) return
    settle(current.id)
    reorder(current.start)
    setDrag(undefined)
    setDraft(undefined)
    announce(`Cancelled. ${labels[current.id]} is back at position ${position(current.id)}.`)
  }

  function move(direction: -1 | 1) {
    const current = drag()
    if (!current) return
    const order = visible()
    const index = order.indexOf(current.id) + direction
    if (index < 0 || index >= order.length) return
    const others = order.filter((id) => id !== current.id)
    reorder(withHidden([...others.slice(0, index), current.id, ...others.slice(index)]))
    find(current.id)?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" })
    announce(`${labels[current.id]}, position ${index + 1} of ${order.length}.`)
  }

  return (
    <>
      <For each={present()}>
        {(id) => (
          <button
            type="button"
            data-component="section-handle"
            data-visible={hovered() === id || drag()?.id === id ? "" : undefined}
            data-dragging={drag()?.id === id ? "" : undefined}
            data-tip={drag() ? undefined : "Drag to move"}
            aria-label={`Move section: ${labels[id]}`}
            aria-pressed={drag()?.id === id ? "true" : "false"}
            ref={(element) => handles.set(id, element)}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              lift(id, false, event.clientY)
            }}
            onPointerMove={(event) => {
              const current = drag()
              if (current && !current.keyboard) setDrag({ ...current, pointer: event.clientY })
            }}
            onPointerUp={() => {
              if (drag() && !drag()?.keyboard) drop()
            }}
            onPointerCancel={cancel}
            onBlur={() => {
              if (drag()?.keyboard) cancel()
            }}
            // Bound on the button itself (not delegated), so Escape stops here and Design mode stays on.
            on:keydown={(event: KeyboardEvent) => {
              const current = drag()
              const keys = [" ", "Enter", "ArrowUp", "ArrowDown", "Escape"]
              if (!keys.includes(event.key) || (!current && !["Enter", " "].includes(event.key))) return
              event.preventDefault()
              event.stopPropagation()
              if (!current) return lift(id, true, 0)
              if (event.key === "Escape") return cancel()
              if (event.key === "ArrowUp") return move(-1)
              if (event.key === "ArrowDown") return move(1)
              drop()
            }}
          >
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
              <circle cx="3" cy="3" r="1.1" />
              <circle cx="7" cy="3" r="1.1" />
              <circle cx="3" cy="7" r="1.1" />
              <circle cx="7" cy="7" r="1.1" />
              <circle cx="3" cy="11" r="1.1" />
              <circle cx="7" cy="11" r="1.1" />
            </svg>
          </button>
        )}
      </For>
      <Show when={drag()}>
        <div data-component="section-drop" ref={line} aria-hidden="true" />
      </Show>
      <div data-component="section-announcer" aria-live="assertive" role="status">
        {message()}
      </div>
    </>
  )
}

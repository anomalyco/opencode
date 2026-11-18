import { brandSvgs } from "./brand"

/**
 * The OpenCode nav menus, for every OpenCode site: opencode.ai and its docs, OpenCode Data, the Console's pages and
 * the status page. Framework-free, so pages that never hydrate (the docs) and plain HTML (the status page) can use it.
 *
 * Mark the elements and call `installNavMenus()` once in the browser:
 * - `data-nav-logo` on the OpenCode logo link: right-click (or Shift+F10, the menu key or a long press) opens the
 *   logo menu, the brand files to download and the Brand, brand assets and Press links, as on opencode.ai.
 * - `data-nav-product="data"` on the product's name beside the logo: hovering it (a 150ms intent delay; it closes 200ms
 *   after the pointer leaves the name and the menu), ArrowDown on it, Shift+F10 or the menu key opens the product menu,
 *   the OpenCode products with the page's own one current. On touch screens, which have no hover, the name stays a plain
 *   link and a chevron after it (added here, `data-nav-product-toggle`) opens the menu.
 * - `data-nav-name` instead on a name that opens no menu (the status page's, which isn't one of the products): the
 *   lockup's look alone (nav-menus.css).
 *
 * One menu is open at a time: opening one closes the other at once, and the `opencode-nav-menu-open` event tells the
 * host to close its own menus. Both menus open on the same line, 8px under the lockup's highlight, their inline-start
 * edge on the logo's or the name's, and keep 16px from the window's sides.
 *
 * Both menus are cards on the see-through pop-up surface (nav-menus.css), fixed to the window and appended to the
 * page's body, so the host's styles never reach them. A host can recolour them by setting the `--nav-menu-*`
 * properties (nav-menus.css) on any ancestor of its triggers; the menu copies them, and the trigger's color-scheme,
 * when it opens.
 */

export type Product = "opencode" | "console" | "data" | "docs"

/**
 * The OpenCode products, in the menu's order, each at a `path` on opencode.ai (the host's `link` resolves it).
 */
export const products: { id: Product; name: string; path: string }[] = [
  { id: "opencode", name: "OpenCode", path: "/" },
  { id: "console", name: "Console", path: "/console" },
  { id: "data", name: "Data", path: "/data" },
  { id: "docs", name: "Docs", path: "/docs" },
]

/** Every logo and wordmark in one zip, in opencode.ai's files bucket (services/site/src/lib/media.ts). */
export const brandAssetsPath = "/files/site/2026-11/opencode-brand-assets.zip"

/** The logo menu's files: the light ones first, then the dark, each default (transparent) then simple (solid). */
export const logoFiles = (["light", "dark"] as const).flatMap((tone) =>
  (["transparent", "solid"] as const).flatMap((style) =>
    (["logo", "wordmark"] as const).map((kind) => ({
      kind,
      tone,
      style,
      name: style === "solid" ? `Simple ${kind}` : kind === "logo" ? "Logo" : "Wordmark",
      file: `opencode-${kind}-${style}-${tone}.svg`,
      svg: brandSvgs[`${kind}-${style}-${tone}`] ?? "",
    })),
  ),
)

export type NavMenusOptions = {
  /** A path on opencode.ai to the URL this page should link: by default the absolute https://opencode.ai URL. Hosts on
   * opencode.ai pass a same-host path (and opencode.ai its own locale route). */
  link?: (path: string) => string
}

type Kind = "logo" | "product"
type Open = { kind: Kind; trigger: HTMLElement; menu: HTMLElement; frame: number }

const icons = {
  // A ruler: the brand guidelines.
  guide: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="1.625" y="5.625" width="12.75" height="4.75"/><path d="M4.5 5.625V7.75M7 5.625V8.5M9.5 5.625V7.75M12 5.625V8.5"/></svg>`,
  // A zip file: a page with a zipper of alternating pixels and its pull.
  zip: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><path d="M3.625 1.625H12.375V14.375H3.625Z"/><path d="M7 2H8V3H7ZM8 3H9V4H8ZM7 4H8V5H7ZM8 5H9V6H8ZM7 6H8V7H7ZM8 7H9V8H8Z" fill="currentColor" stroke="none"/><path d="M6.625 8.625H9.375V11.375H6.625Z"/></svg>`,
  // The press kit: a folder.
  press: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><path d="M4.625 4.625V2.625H11.375V5.625"/><path d="M1.625 4.625H6.375L7.375 5.625H14.375V13.375H1.625Z"/></svg>`,
}

// The host properties a menu copies from its trigger (nav-menus.css).
const tokens = [
  "--nav-menu-ink",
  "--nav-menu-weak",
  "--nav-menu-popover",
  "--nav-menu-link",
  "--nav-menu-bar",
  "--nav-menu-icon",
  "--nav-menu-mono",
]

// The logo fan's motion (opencode.ai, fan-motion.ts): each card drops a little further than the one before, starts a
// touch small and turned, and settles on a tight damped spring, one after another.
const start = (index: number) => `translateY(-${Math.min(12 + index * 6, 42)}px) rotate(-1deg) scale(0.97)`
const spring = `linear(${Array.from({ length: 48 }, (_, index) => {
  const t = index / 47
  const damped = 11 * Math.sqrt(1 - 0.65 * 0.65)
  const value = 1 - Math.exp(-0.65 * 11 * t) * (Math.cos(damped * t) + ((0.65 * 11) / damped) * Math.sin(damped * t))
  return index === 47 ? "1" : value.toFixed(4)
}).join(", ")})`

let installed: (() => void) | undefined

/** Closes whichever nav menu is open. Hosts call it when they open a menu of their own. */
export let closeNavMenus: (refocus?: boolean) => void = () => {}

/** Starts the menus for this page; returns a function that stops them. Installing again replaces the first. */
export function installNavMenus(options: NavMenusOptions = {}) {
  installed?.()
  const link = options.link ?? ((path: string) => `https://opencode.ai${path}`)
  const urls: string[] = []
  // The files as object URLs, made on first use, so their downloads need no request on any host.
  const fileUrl = (svg: string) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))
    urls.push(url)
    return url
  }
  const files = () => logoFiles.map((file) => ({ ...file, url: fileUrl(file.svg) }))
  let fileList: ReturnType<typeof files> | undefined

  let current: Open | undefined
  let openTimer = 0
  let closeTimer = 0
  let pressTimer = 0
  let press: { x: number; y: number; trigger: HTMLElement } | undefined
  // A long press or a tap opened a menu, so the click that follows must not follow the trigger's link.
  let swallowClick: HTMLElement | undefined

  const items = () => [...(current?.menu.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
  const triggerOf = (target: EventTarget | null) =>
    target instanceof Element
      ? target.closest<HTMLElement>("[data-nav-logo], [data-nav-product], [data-nav-product-toggle]")
      : null
  const kindOf = (trigger: HTMLElement): Kind => (trigger.hasAttribute("data-nav-logo") ? "logo" : "product")
  // What a menu lines up with: the logo's mark, or the product's name (also for its chevron).
  const anchorOf = (trigger: HTMLElement) =>
    trigger.hasAttribute("data-nav-logo")
      ? (trigger.querySelector("svg") ?? trigger)
      : trigger.hasAttribute("data-nav-product-toggle")
        ? (trigger.parentElement?.querySelector<HTMLElement>("[data-nav-product]") ?? trigger)
        : trigger
  // The elements that show the open state: the trigger, and for the product menu the name and its chevron.
  const expandables = (trigger: HTMLElement) =>
    kindOf(trigger) === "logo"
      ? [trigger]
      : [
          ...(trigger.parentElement?.querySelectorAll<HTMLElement>("[data-nav-product], [data-nav-product-toggle]") ??
            []),
        ]
  const inside = (target: EventTarget | null) =>
    target instanceof Node && !!current && (current.menu.contains(target) || current.trigger.contains(target))

  const build = (kind: Kind, trigger: HTMLElement) => {
    const menu = document.createElement("div")
    menu.dataset.navMenu = kind
    menu.setAttribute("role", "menu")
    menu.setAttribute("aria-label", kind === "logo" ? "Brand assets" : "OpenCode products")
    menu.id = `nav-menu-${kind}`
    // Counts as an open menu for the host's floating things (opencode.ai's menu-open.ts).
    menu.setAttribute("data-menu-open", "")
    const style = getComputedStyle(trigger)
    menu.style.colorScheme = style.colorScheme
    tokens.forEach((token) => {
      const value = style.getPropertyValue(token).trim()
      if (value) menu.style.setProperty(token, value)
    })
    // A card: its thumbnail (the brand files and pages), or for a product its label alone.
    const card = (attributes: Record<string, string>, lead: HTMLElement | undefined, label: string, meta?: string) => {
      const item = document.createElement("a")
      item.setAttribute("role", "menuitem")
      item.tabIndex = -1
      Object.entries(attributes).forEach(([name, value]) => item.setAttribute(name, value))
      const text = document.createElement("span")
      text.dataset.slot = "label"
      text.textContent = label
      if (meta) {
        const note = document.createElement("span")
        note.dataset.slot = "meta"
        note.textContent = ` · ${meta}`
        text.append(note)
      }
      item.append(...(lead ? [lead, text] : [text]))
      menu.append(item)
    }
    const slot = (name: string, data: Record<string, string>, markup = "") => {
      const element = document.createElement("span")
      element.dataset.slot = name
      Object.assign(element.dataset, data)
      element.setAttribute("aria-hidden", "true")
      element.innerHTML = markup
      return element
    }
    if (kind === "logo") {
      fileList ??= files()
      fileList.forEach((file) =>
        card(
          { href: file.url, download: file.file },
          slot("thumb", { kind: file.kind, tone: file.tone, style: file.style }, file.svg),
          file.name,
          `${file.tone === "light" ? "Light" : "Dark"} SVG`,
        ),
      )
      card(
        { href: link(brandAssetsPath), download: "opencode-brand-assets.zip" },
        slot("thumb", { kind: "zip" }, icons.zip),
        "Brand assets",
        "ZIP",
      )
      card({ href: link("/brand") }, slot("thumb", { kind: "guide" }, icons.guide), "Brand", "Page")
      card({ href: link("/press") }, slot("thumb", { kind: "press" }, icons.press), "Press", "Page")
      return menu
    }
    const here = anchorOf(trigger).dataset.navProduct
    products.forEach((product) => {
      const attributes: Record<string, string> = { href: link(product.path) }
      if (product.id === here) attributes["aria-current"] = "page"
      card(attributes, undefined, product.name)
    })
    return menu
  }

  // Both menus open 9px under their anchor (the cards' 1px rings make it the 8px seen between cards), their first
  // card's inline-start edge on the anchor's. They keep 16px from the window's sides, open above only when there is
  // more room there, and scroll when taller than the room (services/site's placeMenu rules); the menu's 8px padding
  // leaves room for the cards' shadows.
  const place = () => {
    if (!current) return
    const menu = current.menu
    const box = anchorOf(current.trigger).getBoundingClientRect()
    const rtl = getComputedStyle(menu).direction === "rtl"
    const width = document.documentElement.clientWidth
    menu.style.maxHeight = ""
    const cards = menu.scrollHeight - 24
    const below = window.innerHeight - box.bottom - 9 - 8
    const above = box.top - 9 - 8
    const up = cards > below && above > below
    const room = up ? above : below
    menu.style.top = up ? "auto" : `${box.bottom + 9 - 8}px`
    menu.style.bottom = up ? `${window.innerHeight - box.top + 9 - 8}px` : "auto"
    menu.style.maxHeight = cards > room ? `${room + 8}px` : ""
    menu.toggleAttribute("data-scroll", cards > room)
    const start = rtl ? width - box.right : box.left
    const size = menu.getBoundingClientRect().width - 16
    menu.style.insetInlineStart = `${Math.max(16, Math.min(start, width - 16 - size)) - 8}px`
  }
  const follow = () => {
    if (!current) return
    place()
    current.frame = requestAnimationFrame(follow)
  }

  const open = (trigger: HTMLElement, focus: boolean) => {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
    if (current?.trigger === trigger && !current.menu.hasAttribute("data-closing")) {
      if (focus) items()[0]?.focus()
      return
    }
    // Hand over at once: the open menu and any still folding away go before the new one comes, so two never overlap.
    close(false, true)
    document.querySelectorAll("[data-nav-menu][data-closing]").forEach((menu) => menu.remove())
    document.dispatchEvent(new CustomEvent("opencode-nav-menu-open"))
    const kind = kindOf(trigger)
    const menu = build(kind, trigger)
    document.body.append(menu)
    current = { kind, trigger, menu, frame: 0 }
    document.documentElement.dataset.navMenuOpen = kind
    expandables(trigger)
      .filter((element) => element.hasAttribute("aria-haspopup"))
      .forEach((element) => {
        element.setAttribute("aria-expanded", "true")
        element.setAttribute("aria-controls", menu.id)
      })
    // The top layer, over the host's dialogs and sheets, where the browser has it.
    if (typeof menu.showPopover === "function") {
      menu.popover = "manual"
      menu.showPopover()
    }
    follow()
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches
    items().forEach((item, index) => {
      const fade = [{ opacity: 0 }, { opacity: 1 }]
      if (still) return void item.animate(fade, { duration: 150, easing: "ease-out" })
      const timing = { delay: index * 32, fill: "backwards" as const }
      item.animate([{ transform: start(index) }, { transform: "none" }], { ...timing, duration: 450, easing: spring })
      item.animate(fade, { ...timing, duration: 140, easing: "ease-out" })
    })
    if (focus) items()[0]?.focus()
  }

  // The cards fold back, the last first, as on opencode.ai; `now` removes the menu at once (another one is opening).
  const close = (refocus = false, now = false) => {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
    if (!current) return
    const shut = current
    current = undefined
    cancelAnimationFrame(shut.frame)
    delete document.documentElement.dataset.navMenuOpen
    expandables(shut.trigger)
      .filter((element) => element.hasAttribute("aria-haspopup"))
      .forEach((element) => {
        element.setAttribute("aria-expanded", "false")
        element.removeAttribute("aria-controls")
      })
    if (refocus || shut.menu.contains(document.activeElement)) shut.trigger.focus()
    if (now || matchMedia("(prefers-reduced-motion: reduce)").matches) return shut.menu.remove()
    shut.menu.setAttribute("data-closing", "")
    const list = [...shut.menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const animations = list.flatMap((item, index) => {
      const delay = (list.length - 1 - index) * 14
      return [
        item.animate([{ transform: start(index) }], {
          delay,
          duration: 220,
          easing: "cubic-bezier(0.5, -0.5, 0.8, 0.3)",
          fill: "forwards",
        }),
        item.animate([{ opacity: 0 }], { delay: delay + 80, duration: 140, easing: "ease-in", fill: "forwards" }),
      ]
    })
    void Promise.all(animations.map((animation) => animation.finished)).then(
      () => shut.menu.remove(),
      () => shut.menu.remove(),
    )
  }
  closeNavMenus = close

  // The name opens the product menu on hover; its chevron (touch screens) on a tap.
  const hover = (trigger: HTMLElement | null) => !!trigger && trigger.hasAttribute("data-nav-product")
  const toggle = (trigger: HTMLElement | null) => !!trigger && trigger.hasAttribute("data-nav-product-toggle")

  const stop = new AbortController()
  const on = <K extends keyof DocumentEventMap>(
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    capture = false,
  ) => document.addEventListener(type, listener, { capture, signal: stop.signal })
  on("contextmenu", (event: MouseEvent) => {
    const trigger = triggerOf(event.target)
    if (trigger && !hover(trigger)) {
      event.preventDefault()
      // The menu key and Shift+F10 report no pointer position.
      return open(trigger, event.button === 0 && event.clientX === 0 && event.clientY === 0)
    }
    if (current && !inside(event.target)) close()
  })
  on("keydown", (event: KeyboardEvent) => {
    const trigger = triggerOf(event.target)
    const menuKey = event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")
    const chevronKey = toggle(trigger) && (event.key === "Enter" || event.key === " " || event.key === "ArrowDown")
    if (trigger && (menuKey || chevronKey || (hover(trigger) && event.key === "ArrowDown"))) {
      event.preventDefault()
      return open(trigger, true)
    }
    if (!current) return
    if (event.key === "Escape") {
      event.preventDefault()
      return close(true)
    }
    if (event.key === "Tab") return close()
    const list = items()
    const at = list.findIndex((item) => item === document.activeElement)
    const next = { ArrowDown: at + 1, ArrowUp: at < 0 ? -1 : at - 1, Home: 0, End: -1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    list.at(next % list.length)?.focus()
  })
  on("pointerover", (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return
    // Keyboard focus follows the pointer between cards, so only one card looks active.
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="menuitem"]') : null
    if (item && current?.menu.contains(item) && current.menu.contains(document.activeElement))
      item.focus({ preventScroll: true })
    const trigger = triggerOf(event.target)
    if (current && inside(event.target)) return clearTimeout(closeTimer)
    if (!hover(trigger) || !trigger) return
    clearTimeout(openTimer)
    openTimer = window.setTimeout(() => open(trigger, false), 150)
  })
  on("pointerout", (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return
    if (triggerOf(event.target) && !triggerOf(event.relatedTarget)) clearTimeout(openTimer)
    // Leaving the name or the menu (not just moving elsewhere on the page) starts the grace period.
    if (!inside(event.target) || inside(event.relatedTarget)) return
    if (current && current.kind === "product") {
      clearTimeout(closeTimer)
      closeTimer = window.setTimeout(() => close(), 200)
    }
  })
  on("pointerdown", (event: PointerEvent) => {
    // A long press whose click never came (some phones send none) mustn't eat the next tap.
    swallowClick = undefined
    const trigger = triggerOf(event.target)
    // Pressing the other trigger hands over at once; anywhere else the menu folds away.
    if (current && !inside(event.target)) close(false, !!trigger)
    if (!trigger || event.pointerType !== "touch" || hover(trigger) || toggle(trigger)) return
    press = { x: event.clientX, y: event.clientY, trigger }
    clearTimeout(pressTimer)
    pressTimer = window.setTimeout(() => {
      swallowClick = trigger
      open(trigger, false)
    }, 500)
  })
  // Focus moving elsewhere (another menu, a dialog such as the host's search) closes the menu.
  on("focusin", (event: FocusEvent) => {
    if (current && !inside(event.target)) close()
  })
  on("pointermove", (event: PointerEvent) => {
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) clearTimeout(pressTimer)
  })
  on("pointerup", () => clearTimeout(pressTimer))
  on("pointercancel", () => clearTimeout(pressTimer))
  on(
    "click",
    (event: MouseEvent) => {
      const trigger = triggerOf(event.target)
      if (trigger && swallowClick === trigger) {
        swallowClick = undefined
        return event.preventDefault()
      }
      // The chevron opens and closes the product menu.
      if (toggle(trigger) && trigger) {
        event.preventDefault()
        return current?.trigger === trigger ? close() : open(trigger, false)
      }
      if (trigger) return close()
      if (
        event.target instanceof Element &&
        current?.menu.contains(event.target) &&
        event.target.closest('[role="menuitem"]')
      )
        close()
    },
    true,
  )
  // A page restored from the back-forward cache never shows a menu still open; a new window width can move or hide
  // the trigger (a phone layout), so it closes the menu too. Scrolling, and a phone's toolbar growing or shrinking
  // the height, keep it on its trigger (follow).
  let width = window.innerWidth
  window.addEventListener("pageshow", () => close(false, true), { signal: stop.signal })
  window.addEventListener(
    "resize",
    () => {
      if (window.innerWidth !== width) close(false, true)
      width = window.innerWidth
    },
    { signal: stop.signal },
  )

  addProductToggles()
  installed = () => {
    close(false, true)
    stop.abort()
    urls.forEach((url) => URL.revokeObjectURL(url))
    document.querySelectorAll("[data-nav-product-toggle]").forEach((chevron) => chevron.remove())
    installed = undefined
    closeNavMenus = () => {}
  }
  return installed
}

/**
 * Adds the touch screens' chevron after each product name that has none (nav-menus.css shows it where there is no
 * hover). `installNavMenus` calls it; a host that renders a name later calls it again.
 */
export function addProductToggles() {
  document.querySelectorAll<HTMLElement>("[data-nav-product]").forEach((name) => {
    // A name whose lockup already has a chevron of its own (the docs' sections menu) opts out.
    if (name.dataset.navProductChevron === "none") return
    if (name.nextElementSibling?.hasAttribute("data-nav-product-toggle")) return
    const chevron = document.createElement("button")
    chevron.type = "button"
    chevron.dataset.navProductToggle = ""
    chevron.setAttribute("aria-haspopup", "menu")
    chevron.setAttribute("aria-expanded", "false")
    chevron.setAttribute("aria-label", "OpenCode products")
    chevron.innerHTML = `<svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`
    name.after(chevron)
  })
}

// Settings › Card to page: a product card's media grows into its product page's hero, and the hero
// shrinks back into the card going back, with a view transition (products.css). The app runs it
// within one page (products.tsx); the static pages across two (`@view-transition`, which
// src/static/render.tsx writes with revealCard into the head of the pages that morph):
// src/client/islands/card-morph.ts names the card or hero on the page being left, and revealCard
// the one the next page arrives at. No framework code, and each function stands alone (no imports,
// nothing from around it), so the head script can carry their source.

type Box = { left: number; top: number; right: number; bottom: number; width?: number; height?: number }

/** Settings › Card to page's timing, which the transition's styles read from the page's root. */
export type CardTiming = {
  grow: number
  shrink: number
  easing: string
  pageFade: number
  pageDelay: number
  imageFade: number
}

/** True when at least half of the box is inside the window (and inside `clip`, if given). */
export function onScreen(box: Box, clip?: Box) {
  const left = Math.max(box.left, 0, clip?.left ?? 0)
  const right = Math.min(box.right, window.innerWidth, clip?.right ?? Infinity)
  const top = Math.max(box.top, 0, clip?.top ?? 0)
  const bottom = Math.min(box.bottom, window.innerHeight, clip?.bottom ?? Infinity)
  const width = box.right - box.left
  const height = box.bottom - box.top
  const visible = Math.max(0, right - left) * Math.max(0, bottom - top)
  return width > 0 && height > 0 && visible >= (width * height) / 2
}

/**
 * Marks the page as changing between a card and its product page ("fade" when reduced motion keeps
 * the box still), with the timing on its root. Going back, nothing may outlast the shrink: the page
 * and image fades fit inside it and the new page fades in at once, so the transition ends when the
 * box lands.
 */
export function markCard(direction: "grow" | "shrink" | "fade", timing: CardTiming) {
  const root = document.documentElement
  const shrinking = direction === "shrink"
  const duration = shrinking ? timing.shrink : timing.grow
  root.dataset.cardGrow = direction
  root.style.setProperty("--card-duration", `${duration}ms`)
  root.style.setProperty("--card-easing", timing.easing)
  root.style.setProperty("--card-page-fade", `${shrinking ? Math.min(timing.pageFade, duration) : timing.pageFade}ms`)
  root.style.setProperty("--card-page-delay", `${shrinking ? 0 : timing.pageDelay}ms`)
  root.style.setProperty(
    "--card-image-fade",
    `${shrinking ? Math.min(timing.imageFade, duration) : timing.imageFade}ms`,
  )
}

/**
 * Sets how long the box takes from how far it travels: the set duration for a trip of half the
 * window's diagonal or more, down to three quarters of it for a short one, so a small move doesn't
 * drift. Before the transition animates, which reads the value when it starts.
 */
export function travel(from: Box, to: Box, duration: number, timing: CardTiming) {
  const distance = Math.max(
    Math.hypot(to.left - from.left, to.top - from.top),
    Math.hypot(to.right - from.right, to.bottom - from.bottom),
  )
  const scale = Math.min(1, Math.max(0.75, distance / (0.5 * Math.hypot(window.innerWidth, window.innerHeight))))
  const root = document.documentElement
  const scaled = Math.round(duration * scale)
  root.style.setProperty("--card-duration", `${scaled}ms`)
  if (root.dataset.cardGrow !== "shrink") return
  root.style.setProperty("--card-page-fade", `${Math.min(timing.pageFade, scaled)}ms`)
  root.style.setProperty("--card-image-fade", `${Math.min(timing.imageFade, scaled)}ms`)
}

/**
 * Takes the transition's marks off the page: its root's data-card-grow and the name a card or hero
 * carried. Run when a transition ends, and when a page leaves for the back/forward cache or comes
 * back from it, so a page restored from it is never caught mid-transition.
 */
export function clearCardMorph() {
  delete document.documentElement.dataset.cardGrow
  document
    .querySelectorAll<HTMLElement>('[data-component="product-hero"], [data-slot="media"][data-product]')
    .forEach((element) => (element.style.viewTransitionName = ""))
}

/**
 * While a card grows into the hero, the hero's poster shows at once, with no fade of its own; its
 * video fades in over it once it can play (hero-video.ts).
 */
export function showHeroPoster() {
  const poster = document.querySelector('[data-component="product-hero"] img[data-poster]')
  poster?.setAttribute("data-instant", "")
  poster?.setAttribute("data-loaded", "")
}

/** Where the page being left says what the next one should do, for a few seconds. */
export const cardMorphKey = "opencode-card-morph"

/**
 * The arriving half, in a static page's head so it runs before the page's first frame, which the
 * transition snapshots (pagereveal): the hero takes the card's place, or the card the hero's (or,
 * with the card off screen, the hero fades out with the page), and the carousel scrolls back to
 * where it was left. Without a fresh word from the page left (another page, or a page restored
 * from the back/forward cache), there is no transition. Helpers come in as arguments, as the head
 * script carries their source.
 */
export function revealCard(
  timing: CardTiming,
  key: string,
  helpers: {
    markCard: typeof markCard
    travel: typeof travel
    onScreen: typeof onScreen
    clearCardMorph: typeof clearCardMorph
    showHeroPoster: typeof showHeroPoster
  },
) {
  addEventListener("pagereveal", (event) => {
    helpers.clearCardMorph()
    const transition = (event as Event & { viewTransition?: ViewTransition | null }).viewTransition
    const state = JSON.parse(sessionStorage.getItem(key) ?? "null") as {
      mode: "grow" | "shrink" | "fade"
      slug: string
      from: Box
      x?: number
      at: number
    } | null
    sessionStorage.removeItem(key)
    if (!transition) return
    if (!state || Date.now() - state.at > 4000) return transition.skipTransition()
    helpers.markCard(state.mode, timing)
    if (state.mode === "grow") {
      const hero = document.querySelector('[data-component="product-hero"]')
      helpers.showHeroPoster()
      if (hero) helpers.travel(state.from, hero.getBoundingClientRect(), timing.grow, timing)
    }
    if (state.mode === "shrink") {
      const card = document.querySelector<HTMLElement>(`[data-slot="media"][data-product="${state.slug}"]`)
      const track = card?.closest<HTMLElement>('[data-slot="track"]')
      if (track && state.x !== undefined) track.scrollLeft = state.x
      const box = card?.getBoundingClientRect()
      if (card && box && helpers.onScreen(box, track?.getBoundingClientRect())) {
        card.style.viewTransitionName = "product-hero"
        helpers.travel(state.from, box, timing.shrink, timing)
      }
    }
    void transition.finished.finally(() => {
      helpers.clearCardMorph()
      // The cards' stills stay shown, without their arrival fade playing again.
      document
        .querySelectorAll<HTMLElement>('[data-component="product-card"] [data-slot="still"]')
        .forEach((still) => (still.style.animation = "none"))
    })
  })
}

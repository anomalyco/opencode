import { cardMorphKey, clearCardMorph, onScreen } from "~/component/site/card-morph"
import { stillSizes } from "~/component/site/still-sizes"
import { $, html, on, reducedMotion, site, target } from "../dom"

// The page-leaving half of the card ↔ hero morph (component/site/card-morph.ts): a card opening its
// product's page names itself for the transition, and a product page's hero going back to the home
// page or /product names itself, then leaves what the next page needs in sessionStorage. Every
// other change between these pages is a plain page load. Browsers without cross-document view
// transitions (Firefox) load the page as usual.

const card = '[data-slot="media"][data-product]'
/** A path without its trailing slash, so /ja/ and /ja compare equal. */
const path = (url: string) => new URL(url, location.href).pathname.replace(/(.)\/$/, "$1")

/** Loaded once the page is idle (islands.ts), whatever part of it is on screen. */
export default function cardMorph() {
  let clicked: HTMLAnchorElement | undefined
  on(
    "click",
    (event) => {
      const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
      clicked = (plain && target(event).closest<HTMLAnchorElement>(card)) || undefined
    },
    { capture: true },
  )
  // The hero's poster loads from the first hover, so the card grows into a picture, not a black box.
  const posters = new Set<string>()
  for (const type of ["pointerover", "focusin"] as const)
    on(type, (event) => {
      const theme = site.dataset.theme
      const dark = theme === "dark" || (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
      const srcset = target(event).closest<HTMLElement>(card)?.dataset[dark ? "heroDark" : "heroLight"]
      if (!srcset || posters.has(srcset)) return
      posters.add(srcset)
      const image = new Image()
      image.sizes = stillSizes.hero
      image.srcset = srcset
      void image.decode().catch(() => posters.delete(srcset))
    })
  // Left clean for the back/forward cache, at once: the transition's end may never come on a page
  // that has gone.
  addEventListener("pagehide", clearCardMorph)

  addEventListener("pageswap", (swap) => {
    const event = swap as Event & {
      viewTransition?: ViewTransition | null
      activation?: { entry: { url: string | null } } | null
    }
    const transition = event.viewTransition
    const url = event.activation?.entry.url
    const media = clicked
    clicked = undefined
    if (!transition || !url) return
    const to = path(url)
    const save = (state: object) => sessionStorage.setItem(cardMorphKey, JSON.stringify({ ...state, at: Date.now() }))
    void transition.finished.finally(clearCardMorph)
    if (media && to === path(media.href)) {
      const track = media.closest<HTMLElement>('[data-slot="track"]')
      const from = media.getBoundingClientRect()
      // With reduced motion, or a card mostly out of view (a keyboard or scripted click), nothing
      // moves: the pages only crossfade.
      const morph = !reducedMotion() && onScreen(from, track?.getBoundingClientRect())
      if (track) sessionStorage.setItem(`${cardMorphKey}:${path(location.href)}`, String(track.scrollLeft))
      if (morph) media.style.viewTransitionName = "product-hero"
      return save({ mode: morph ? "grow" : "fade", slug: media.dataset.product, from })
    }
    // Back to the home page or /product, in the page's language.
    const locale = html.dataset.locale
    const home = !locale || locale === "en" ? "" : `/${locale}`
    const hero = $('[data-component="product-hero"][data-product]')
    if (hero && (to === (home || "/") || to === `${home}/product`)) {
      const from = hero.getBoundingClientRect()
      // The hero carries the name through products.css's rule while data-card-grow is "shrink".
      const morph = !reducedMotion() && onScreen(from)
      html.dataset.cardGrow = morph ? "shrink" : "fade"
      const x = sessionStorage.getItem(`${cardMorphKey}:${to}`)
      return save({
        mode: morph ? "shrink" : "fade",
        slug: hero.dataset.product,
        from,
        x: x === null ? undefined : Number(x),
      })
    }
    transition.skipTransition()
  })
}

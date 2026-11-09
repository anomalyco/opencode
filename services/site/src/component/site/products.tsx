import { Marked } from "./marked"
import "./products.css"
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  type JSX,
} from "solid-js"
import { useNavigate, type Navigator } from "@solidjs/router"
import { Link } from "@solidjs/meta"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { useContent } from "~/i18n/content"
import type { DownloadPlatform } from "~/routes/download/types"
import {
  desktopBuilds,
  detectDesktopBuild,
  detectOS,
  getDownloadHref,
  getDownloadPlatform,
  requestOS,
  type OS,
} from "~/lib/download"
import { strip } from "~/lib/language"
import { copyOnClick, copySelection } from "~/lib/clipboard"
import { detectPlatform, isMobile, requestPlatform } from "~/lib/platform"
import { Chevron, NewTab, PlatformIcon } from "./icons"
import { onCloseMenus } from "./menu-open"
import { Sheet, prefersSheet, type SheetControl } from "./sheet"
import { holdPopstate } from "./popstate"
import {
  androidSoon,
  deviceOrder,
  extensions,
  installs,
  mobileStores,
  productPages,
  products,
  sdkDocs,
  sdkSnippet,
  type PageSlug,
  type ProductSlug,
} from "./product-data"
import { designCopy, designMode } from "./design-copy"
import { sortableProducts } from "./products-order"
import { carouselBreakpoints, cardEasingCurves, siteSettings } from "./settings"
import { pageMedia, pageScheme, productVideo } from "./videos"
import { imageSources, loadStill, posterFile, Still, stillSizes, VideoSources } from "./media"
import { inlineKey } from "~/lib/direction"

export { installs, products, sdkSnippet, type ProductSlug } from "./product-data"

/**
 * Loads a video again once it is on the page. A client-rendered video gets its src while it still
 * belongs to Solid's template document, and while the router holds a new page off screen for its
 * data, Chromium tries the load there and rejects the URL ("URL safety check"). Joining the page
 * does not retry it. A video that has already picked its source is left alone.
 */
export function rescueMedia(video: HTMLVideoElement | undefined) {
  if (video && (video.getAttribute("src") || video.querySelector("source[src]")) && !video.currentSrc) video.load()
}

/** True when the user asks for reduced motion. Always false during SSR. */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

type Scroll = { y: number; x: number }
/** The pages a product page's hero can shrink back into a card on: the home carousel and the /product grid. */
type CardPage = "/" | "/product"

// Where each card page (and the home carousel) was scrolled, by the router's history depth, and
// the latest of them for links back to it (which open a new history entry).
const pageScroll = { "/": new Map<number | undefined, Scroll>(), "/product": new Map<number | undefined, Scroll>() }
const lastScroll: Partial<Record<CardPage, Scroll>> = {}

const cardPage = (path: string): CardPage | undefined => (path === "/" || path === "/product" ? path : undefined)

/**
 * Remembers where a card page was scrolled while the address is that page: the router changes the
 * address before it scrolls a new page to the top, and only after this one has rendered when
 * arriving. Coming back to an entry keeps what it saved; the hero's shrink restores it.
 */
function trackScroll(page: CardPage, track?: HTMLElement) {
  const save = () => {
    if (strip(window.location.pathname) !== page) return
    lastScroll[page] = { y: window.scrollY, x: track?.scrollLeft ?? 0 }
    pageScroll[page].set(history.state?._depth, lastScroll[page])
  }
  if (!pageScroll[page].has(history.state?._depth)) save()
  window.addEventListener("scroll", save, { passive: true })
  track?.addEventListener("scroll", save, { passive: true })
  onCleanup(() => {
    window.removeEventListener("scroll", save)
    track?.removeEventListener("scroll", save)
  })
}

/**
 * Settings › Card to page, in reverse: going back to the home page or /product (browser back, or
 * a link there such as the breadcrumb or the logo) shrinks the product page hero back into its
 * card. The page returns at the scroll position it was left at, so the card is where it was.
 */
export function useCardShrink(slug: () => PageSlug) {
  const navigate = useNavigate()
  onMount(() => {
    const enabled = () => siteSettings.cardTransition === "grow" && !!document.startViewTransition
    // The router swaps the page as soon as popstate fires, too early for the transition's first
    // snapshot. Hold the event back and hand the router a copy once that snapshot is taken.
    let replaying = false
    const release = holdPopstate(() => {
      const page = cardPage(strip(window.location.pathname))
      if (replaying || !enabled() || !page) return false
      shrink(slug(), page, pageScroll[page].get(history.state?._depth), () => {
        replaying = true
        window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }))
        replaying = false
      })
      return true
    })
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || !enabled()) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element).closest("a[href]")
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target) return
      const url = new URL(anchor.href)
      const page = cardPage(strip(url.pathname))
      if (url.origin !== window.location.origin || !page || url.search || url.hash) return
      event.preventDefault()
      shrink(slug(), page, lastScroll[page], () => navigate(url.pathname, { scroll: false }))
    }
    document.addEventListener("click", click, true)
    onCleanup(() => {
      release()
      document.removeEventListener("click", click, true)
    })
  })
}

function shrink(slug: PageSlug, page: CardPage, saved: Scroll | undefined, go: () => void) {
  // The hero carries the transition name through the same rule as the forward grow. With reduced
  // motion, or with the hero scrolled mostly out of view (it would fly in from off screen), nothing
  // moves: the pages only crossfade.
  const hero = document.querySelector('[data-component="product-hero"]')?.getBoundingClientRect()
  const morph = !prefersReducedMotion() && !!hero && onScreen(hero)
  markCardTransition(morph ? "shrink" : "fade")
  const media = pageMedia(siteSettings.productVideos, slug, "portrait", document.documentElement.dataset.locale)
  const poster = media?.still ?? media?.poster
  let card: HTMLElement | undefined
  // As in the grow: the page changes exactly once, inside the transition or after 400ms.
  let gone = false
  const leave = () => {
    if (gone) return
    gone = true
    go()
  }
  const transition = document.startViewTransition(async () => {
    clearTimeout(fallback)
    leave()
    const [found] = await Promise.all([
      elementReady(
        `[data-component="products"][data-layout="${page === "/" ? "carousel" : "grid"}"] [data-slot="media"][data-product="${slug}"]`,
      ),
      poster ? imageReady(poster, stillSizes.card) : undefined,
    ])
    const track = found?.closest<HTMLElement>('[data-slot="track"]')
    window.scrollTo(0, saved?.y ?? 0)
    if (track) track.scrollLeft = saved?.x ?? 0
    // A card that is off screen, or cut off by the carousel's edges, has nowhere to shrink into:
    // the hero then fades out with the page.
    if (!found || (page === "/" && !track) || !morph) return
    const box = found.getBoundingClientRect()
    const bounds = track?.getBoundingClientRect()
    if (box.bottom <= 0 || box.top >= window.innerHeight) return
    if (bounds && (box.left < bounds.left - 1 || box.right > bounds.right + 1)) return
    card = found
    card.style.viewTransitionName = "product-hero"
    if (hero) travel(hero, box, siteSettings.cardShrinkDuration)
  })
  const fallback = setTimeout(() => {
    transition.skipTransition()
    leave()
  }, 400)
  current = transition
  void transition.finished.finally(() => {
    if (card) card.style.viewTransitionName = ""
    // The cards' stills are already showing; without this their arrival fade would play again once
    // the page leaves the transition, a slow fade after the shrink has finished.
    document
      .querySelectorAll<HTMLElement>('[data-component="product-card"] [data-slot="still"]')
      .forEach((still) => (still.style.animation = "none"))
    if (current === transition) delete document.documentElement.dataset.cardGrow
  })
}

/**
 * The product carousel. Each card's image opens that product's page. `exclude` leaves out the
 * product whose page you are on.
 */
/** `header` sits above the cards, on the carousel's left edge (the home page's install row). */
/**
 * The home carousel's frame for the first paint. The page streams in, so the hero can paint before
 * the carousel's markup (cards with their videos, menus and buttons) has arrived. This light copy of
 * the card row sits right after the hero: grey media rectangles, text-shaped grey bars and a button
 * bar, sized by the same CSS. It shows until the carousel has arrived in full, which then takes its
 * place at the same size (products.css); no script decides any of it.
 */
export function ProductCarouselSkeleton() {
  const content = useContent()
  return (
    <div data-component="products-skeleton" data-phone-content={siteSettings.phoneCardContent} aria-hidden="true">
      <div data-slot="track">
        <For each={deviceOrder(products)}>
          {(product) => (
            <div data-component="product-card">
              <div data-slot="media" />
              <h3>
                <span>{content().products[product.slug].name}</span>
              </h3>
              <p>
                <span>{designCopy(`card.${product.slug}.body`, content().products[product.slug].body)}</span>
              </p>
              <span data-slot="button" />
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

export function ProductCarousel(props: { exclude?: ProductSlug; header?: JSX.Element }) {
  const i18n = useI18n()
  const language = useLanguage()
  const content = useContent()
  const navigate = useNavigate()
  let track: HTMLDivElement | undefined

  onMount(() => trackScroll("/", track))

  // The visitor's order (Mobile first on a phone or tablet), fixed at the first render.
  const order = deviceOrder(products)

  // The resting frames of the cards on the first screen: the first two on every width (a phone shows
  // the second's edge), the third and fourth where the carousel has room for them.
  const firstStills = () =>
    order.slice(0, 4).flatMap((product, index) => {
      const media = productVideo(siteSettings.productVideos, product.slug, "portrait", language.locale())
      const href = media?.still ?? media?.poster
      return href
        ? [
            {
              ...imageSources(href),
              media: [undefined, undefined, "(min-width: 640px)", "(min-width: 960px)"][index],
            },
          ]
        : []
    })

  return (
    <section
      data-component="products"
      data-layout="carousel"
      data-design="buttonHover cardTone cardInfo phoneCardContent cardVideo cardHover cardHoverEntry productBadges mobileCover mobileOrbShade cardLoopSpeed cardVideoCut cardTransition cardGrowDuration cardShrinkDuration cardEasing extensionsCard"
      data-tone={siteSettings.cardTone}
      data-card-info={siteSettings.cardInfo}
      data-phone-content={siteSettings.phoneCardContent}
      aria-label={i18n.t("site.products.label")}
    >
      <style>{carouselCss()}</style>
      {/* On the home page the cards' resting frames are the largest things above the fold: fetched with
          the page, so each card shows its frame at first paint instead of its tone. */}
      <Show when={!props.exclude}>
        <For each={firstStills()}>
          {(still, index) => (
            // The AVIF the card's <picture> picks (browsers without AVIF skip the preload), else WebP.
            <Link
              rel="preload"
              as="image"
              {...(still.avif
                ? { imagesrcset: still.avif, imagesizes: stillSizes.card, type: "image/avif" }
                : still.webp
                  ? { imagesrcset: still.webp, imagesizes: stillSizes.card }
                  : { href: still.src })}
              {...(still.media ? { media: still.media } : {})}
              // Only the first card's still is the page's largest paint on every width; the others
              // load at normal priority, so they don't compete with it.
              {...(index() === 0 ? { fetchpriority: "high" } : {})}
            />
          )}
        </For>
      </Show>
      {/* The cards' titles are h3s; on the home page nothing visible heads them. */}
      <Show when={!props.exclude}>
        <h2 data-slot="sr-only">{i18n.t("site.products.label")}</h2>
      </Show>
      {props.header}
      <div data-slot="track" ref={track}>
        <For each={order.filter((product) => product.slug !== props.exclude)}>
          {(product, index) => (
            <article data-component="product-card">
              <a
                href={language.route(`/${product.slug}`)}
                data-slot="media"
                data-product={product.slug}
                aria-label={
                  "isNew" in product && product.isNew && siteSettings.productBadges === "show"
                    ? `${content().products[product.slug].name}, ${i18n.t("home.banner.badge")}`
                    : content().products[product.slug].name
                }
                onClick={(event) => grow(event, navigate, track?.getBoundingClientRect())}
                onPointerEnter={() => heroPoster(product.slug)}
                onFocus={() => heroPoster(product.slug)}
              >
                <Show when={"isNew" in product && product.isNew}>
                  <span data-slot="badge">{i18n.t("home.banner.badge")}</span>
                </Show>
                {/* Only the chosen video set; until its resting frame paints the card is a grey rectangle. */}
                <Show when={productVideo(siteSettings.productVideos, product.slug, "portrait", language.locale())}>
                  {(media) => (
                    <CardVideo
                      src={media().src}
                      poster={media().poster}
                      still={media().still}
                      loop={media().loop}
                      matchesLoop={media().matchesLoop}
                      demo={media().demo}
                      priority={!props.exclude && index() < 2}
                      set
                    />
                  )}
                </Show>
              </a>
              <h3>
                <a href={language.route(`/${product.slug}`)}>{content().products[product.slug].name}</a>
              </h3>
              <p data-design-copy={`card.${product.slug}.body`}>
                {designCopy(`card.${product.slug}.body`, content().products[product.slug].body)}
              </p>
              <ProductAction slug={product.slug} split />
            </article>
          )}
        </For>
        <Show when={siteSettings.extensionsCard === "on" && !props.exclude}>
          <article data-component="product-card">
            <a
              href={extensions.href}
              target="_blank"
              data-slot="media"
              aria-label={i18n.t("site.newTab", { label: content().extensionCard.name })}
            />
            <h3>
              <a href={extensions.href} target="_blank">
                {content().extensionCard.name}
                <NewTab />
              </a>
            </h3>
            <p data-design-copy="card.extensions.body">
              {designCopy("card.extensions.body", content().extensionCard.body)}
            </p>
            <a href={extensions.href} target="_blank" data-component="site-button">
              {content().extensionCard.action}
              <NewTab />
            </a>
          </article>
        </Show>
      </div>
    </section>
  )
}

/**
 * Settings › Card to page: a card's media grows into the product page hero with a view
 * transition. The card and the hero share one transition name for the length of the change. `clip`
 * is the carousel's visible area, which the card must be mostly inside to move.
 */
function grow(event: MouseEvent & { currentTarget: HTMLAnchorElement }, navigate: Navigator, clip?: DOMRect) {
  if (siteSettings.cardTransition !== "grow" || !document.startViewTransition) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
  event.preventDefault()
  const card = event.currentTarget
  const href = card.getAttribute("href") ?? "/"
  const slug = card.dataset.product as PageSlug
  // With reduced motion, or a card mostly out of view (a keyboard or scripted click), nothing
  // moves: the pages only crossfade.
  const from = card.getBoundingClientRect()
  const morph = !prefersReducedMotion() && onScreen(from, clip)
  if (morph) card.style.viewTransitionName = "product-hero"
  // From a carousel on a product page, that page's hero would carry the same name as the card and
  // the browser would skip the transition. It gets the name back once the page has changed, in
  // case the router reuses it for the new product.
  const leaving = document.querySelector<HTMLElement>('[data-component="product-hero"]')
  if (leaving) leaving.style.viewTransitionName = "none"
  markCardTransition(morph ? "grow" : "fade")
  // Load the hero's poster first (hovering the card already started it), so the card grows into
  // a picture rather than a black box.
  const poster = heroPoster(slug)
  // The page changes exactly once: inside the transition, or straight away if the browser has
  // not started the transition within 400ms. It starts on the next frame, and a background tab
  // draws no frames, so without this the click would wait there. The timer stops as soon as the
  // transition starts, so the animation's own length (Settings › Card to page) does not matter.
  let gone = false
  const go = () => {
    if (gone) return
    gone = true
    card.style.viewTransitionName = ""
    navigate(href)
    if (leaving) leaving.style.viewTransitionName = ""
  }
  const transition = document.startViewTransition(async () => {
    clearTimeout(fallback)
    go()
    const [hero] = await Promise.all([
      elementReady(`[data-component="product-hero"][data-product="${slug}"]`),
      poster ? imageReady(poster, stillSizes.hero) : undefined,
    ])
    if (hero && morph) travel(from, hero.getBoundingClientRect(), siteSettings.cardGrowDuration)
  })
  const fallback = setTimeout(() => {
    transition.skipTransition()
    go()
  }, 400)
  current = transition
  void transition.finished.finally(() => {
    // Keep the poster showing (no flash back to black) while the hero's video loads.
    document.querySelector('[data-component="product-hero"] video')?.setAttribute("data-loaded", "")
    // A back step during the grow starts the next transition, which owns the page from then on.
    if (current === transition) delete document.documentElement.dataset.cardGrow
  })
}

// The design copy id for a card.
const cardCopy = (slug: PageSlug) => `card.${slug}.body` as const

/**
 * Every product as a grid of the carousel's cards (/product): four across, then two, then one.
 * Each card's media grows into its product page like the carousel's.
 */
export function ProductGrid() {
  const i18n = useI18n()
  const language = useLanguage()
  const content = useContent()
  const navigate = useNavigate()
  onMount(() => trackScroll("/product"))

  return (
    <section
      data-component="products"
      data-layout="grid"
      data-design="buttonHover productButton cardTone cardInfo cardVideo cardHover cardHoverEntry productBadges mobileCover mobileOrbShade cardLoopSpeed cardVideoCut cardTransition cardGrowDuration cardShrinkDuration cardEasing"
      data-tone={siteSettings.cardTone}
      data-card-info={siteSettings.cardInfo}
      aria-label={i18n.t("site.products.gridLabel")}
    >
      <style>{carouselCss()}</style>
      {/* The cards' titles are h3s; nothing visible heads them under the page's h1. */}
      <h2 data-slot="sr-only">{i18n.t("site.products.label")}</h2>
      {/* Markup order stays the default; products-order.tsx sets each card's grid `order`. */}
      <div data-slot="grid" ref={sortableProducts} data-sortable={designMode() ? "" : undefined}>
        <For each={deviceOrder(productPages)}>
          {(product, index) => (
            <article data-component="product-card" data-card={product.slug}>
              <a
                href={language.route(`/${product.slug}`)}
                data-slot="media"
                data-product={product.slug}
                aria-label={
                  "isNew" in product && product.isNew && siteSettings.productBadges === "show"
                    ? `${content().products[product.slug].name}, ${i18n.t("home.banner.badge")}`
                    : content().products[product.slug].name
                }
                data-empty={pageMedia(siteSettings.productVideos, product.slug, "portrait") ? undefined : ""}
                onClick={(event) => grow(event, navigate)}
                onPointerEnter={() => heroPoster(product.slug)}
                onFocus={() => heroPoster(product.slug)}
              >
                <Show when={"isNew" in product && product.isNew}>
                  <span data-slot="badge">{i18n.t("home.banner.badge")}</span>
                </Show>
                <Show when={pageMedia(siteSettings.productVideos, product.slug, "portrait", language.locale())}>
                  {(media) => (
                    <Show
                      when={media().src}
                      fallback={
                        <Still
                          data-slot="still"
                          data-loaded
                          src={media().poster}
                          sizes={stillSizes.card}
                          width="1064"
                          height="1330"
                          alt=""
                        />
                      }
                    >
                      {(src) => (
                        <CardVideo
                          src={src()}
                          poster={media().poster}
                          still={media().still}
                          loop={media().loop}
                          matchesLoop={media().matchesLoop}
                          demo={media().demo}
                          priority={index() === 0}
                          set
                        />
                      )}
                    </Show>
                  )}
                </Show>
              </a>
              <h3>
                <a href={language.route(`/${product.slug}`)}>{content().products[product.slug].name}</a>
              </h3>
              <p data-design-copy={cardCopy(product.slug)}>
                {designCopy(cardCopy(product.slug), content().products[product.slug].body)}
              </p>
              <ProductAction slug={product.slug} split />
            </article>
          )}
        </For>
      </div>
    </section>
  )
}

/**
 * Cards visible per screen width, from the settings, as CSS variables on the content column. The gap
 * count is one less than the cards that are at least partly on screen, so the card width math in CSS
 * stays exact. The /product grid uses the same variables, so its cards match the home carousel's.
 */
/** The carousel's cards per screen (Settings › Carousel) as the content's --visible, per breakpoint. */
export function carouselCss() {
  return carouselBreakpoints
    .map((breakpoint) => {
      const visible = siteSettings.carousel[breakpoint.key]
      // Home sections span two cards ("3 columns") or run to the right edge ("4 columns").
      const bodyCards = siteSettings.sectionWidth[breakpoint.key] === "3 columns" ? 2 : 99
      const rule = `[data-site][data-page] [data-component="content"] { --visible: ${visible}; --gaps: ${Math.ceil(visible) - 1}; --body-cards: ${bodyCards}; }`
      return breakpoint.min === 0 ? rule : `@media (min-width: ${breakpoint.min}px) { ${rule} }`
    })
    .reverse()
    .join("\n")
}

/**
 * A card video that rests on its first frame. On hover or focus it plays from that frame, so the
 * still turns into motion without a jump. On leave it either plays back to the start quickly
 * ("hover · reverse") or the still fades back over it ("hover · fade"). "autoplay" plays all the
 * time. Reduced motion keeps the still.
 *
 * With `loop`, the card rests on that short idle loop instead of a still: it plays while the card
 * is on screen, crossfades to the product video on hover and back on leave. Reduced motion shows
 * its first frame (`still`).
 */
export function CardVideo(props: {
  src: string
  poster: string
  still?: string
  loop?: string
  set?: boolean
  // The video's first frame has the loop's framing, so the swap is a short crossfade, not a 300ms fade.
  matchesLoop?: boolean
  // The video is the product demo (Card hover entry › demo): hovering stops the loop and switches to
  // it with a cut or a 320ms crossfade, and leaving switches back to the loop where it stopped.
  demo?: boolean
  /** The home page's first two cards (on every width): their stills are the largest paints above the fold. */
  priority?: boolean
}) {
  const [still, setStill] = createSignal(true)
  // The product video (megabytes) buffers only once its card is pointed at or focused (or, on phones,
  // once the sizzle is due), so no clip competes with the page's load.
  const [seen, setSeen] = createSignal(false)
  // The still fades in over the black card once it has loaded, instead of popping in.
  const [loaded, setLoaded] = createSignal(false)
  // Phones and tablets (no hover, or a mobile platform, as in the device preview): the card plays its
  // hover video, the sizzle reel, by itself a while after it comes into view (see onMount).
  const [sizzle, setSizzle] = createSignal(false)
  // On those, the sizzle loads its metadata once the card is near and the rest once it is in view.
  const [near, setNear] = createSignal(false)
  let video: HTMLVideoElement | undefined
  let idle: HTMLVideoElement | undefined
  let poster: HTMLImageElement | undefined
  let frame = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = false
  let visible = false

  const mode = () => siteSettings.cardVideo
  // Settings › Card hover: "match" keeps the short swap for hover videos that start on the loop's
  // framing; "fade" (default) crossfades from the loop to the video's start over 150ms; "cut" swaps instantly.
  const matching = () => Boolean(props.matchesLoop) && siteSettings.cardHover === "match"
  const loopMode = () => {
    if (sizzle()) return "sizzle"
    if (props.demo) return siteSettings.cardHover === "cut" ? "cut" : "demo"
    return matching() ? "match" : siteSettings.cardHover === "match" ? "crossfade" : siteSettings.cardHover
  }
  const fade = () => {
    if (sizzle()) return 400
    if (props.demo) return siteSettings.cardHover === "cut" ? 0 : 320
    if (matching()) return 120
    if (props.loop && siteSettings.cardHover === "cut") return 0
    if (props.loop && siteSettings.cardHover === "fade") return 150
    return 300
  }
  // Settings › Card loop speed, for the carousel cards only (the ones with a loop). A new source
  // resets playbackRate to defaultPlaybackRate, so both are set, again on load. The hover videos are
  // cut to hold each shot for its length, so they always play at 1×.
  const speed = () => {
    if (!props.loop) return
    for (const [element, rate] of [
      [video, 1],
      [idle, siteSettings.cardLoopSpeed],
    ] as const) {
      if (!element) continue
      element.defaultPlaybackRate = rate
      element.playbackRate = rate
    }
  }
  createEffect(speed)

  // The idle loop plays only while the card is on screen and resting.
  const rest = () => {
    if (!idle) return
    if (visible && !active && mode() !== "autoplay" && !prefersReducedMotion()) {
      void idle.play().catch(() => {})
      return
    }
    idle.pause()
  }
  const stop = () => {
    cancelAnimationFrame(frame)
    clearTimeout(timer)
  }

  // Marks the card as active (hovered, focused or in view on touch) so CSS can bring back colour.
  const mark = (on: boolean) => video?.closest('[data-slot="media"]')?.toggleAttribute("data-active", on)

  const enter = () => {
    mark(true)
    if (!video || mode() === "autoplay" || prefersReducedMotion()) return
    active = true
    stop()
    // Hide the still once the video is actually playing, so a slow load never flashes black.
    void video
      .play()
      .then(() => {
        if (!active || !video) return
        const show = () => {
          if (!active) return
          // The demo is a different animation: the loop stops on the frame it was showing.
          if (props.demo) idle?.pause()
          setStill(false)
          // Pause the idle loop once the product video has faded in over it.
          setTimeout(rest, fade())
        }
        // Fade only once the first frame is on screen, so the crossfade never shows black.
        if (matching() || !("requestVideoFrameCallback" in video)) return show()
        video.requestVideoFrameCallback(show)
      })
      .catch(() => {})
  }

  const leave = () => {
    mark(false)
    if (!video || mode() === "autoplay" || !active) return
    active = false
    stop()
    video.pause()
    // A separate still is not the first frame, so it always fades back over the video. With "cut" or
    // "fade" the resting loop comes straight back instead of the video rewinding into it.
    if (mode() === "hover · fade" || props.still || (props.loop && siteSettings.cardHover !== "match")) {
      setStill(true)
      rest()
      timer = setTimeout(() => {
        if (video) video.currentTime = 0
      }, fade())
      return
    }
    // Seek backwards to the first frame with an ease-out, faster than it played: at most 0.8s.
    const from = video.currentTime
    const duration = Math.min(800, Math.max(250, from * 250))
    const start = performance.now()
    const step = (now: number) => {
      if (!video) return
      const progress = Math.min(1, (now - start) / duration)
      if (!video.seeking) video.currentTime = from * (1 - (1 - (1 - progress) ** 3))
      if (progress < 1) {
        frame = requestAnimationFrame(step)
        return
      }
      video.currentTime = 0
      setStill(true)
    }
    frame = requestAnimationFrame(step)
  }

  onMount(() => {
    rescueMedia(video)
    rescueMedia(idle)
    if (mode() === "autoplay" && !prefersReducedMotion()) {
      setStill(false)
      void video?.play().catch(() => {})
    }
    // The loop may have loaded before hydration attached onLoadedData.
    if (idle && idle.readyState >= 2) setLoaded(true)
    if (poster?.complete && poster.naturalWidth > 0) poster.setAttribute("data-loaded", "")
    const media = video?.closest<HTMLElement>('[data-slot="media"]')
    // A hover clip downloads only once the card itself is pointed at or focused (preload="none" until
    // then; the still shows meanwhile and the clip fades in once a frame of it is decoded). Not on
    // phones, where the sizzle loads by itself when its card is in view, nor with reduced motion.
    const want = () => !sizzle() && !prefersReducedMotion() && setSeen(true)
    // A tap also fires pointerenter and pointerleave; touch plays by visibility instead (below).
    const pointerEnter = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      want()
      enter()
    }
    const focus = () => {
      want()
      enter()
    }
    // While the card's menu is open (data-menu-open, ProductAction) the card stays as hovered: the
    // pointer moving from the media into the menu doesn't end it; closing the menu does, unless
    // the pointer is back on the media.
    const card = media?.closest<HTMLElement>('[data-component="product-card"]')
    const pointerLeave = (event: PointerEvent) =>
      event.pointerType !== "touch" && !card?.hasAttribute("data-menu-open") && leave()
    const menuClose = () => {
      if (!media?.matches(":hover") && document.activeElement !== media) leave()
    }
    card?.addEventListener("menuclose", menuClose)
    media?.addEventListener("pointerenter", pointerEnter)
    media?.addEventListener("pointerleave", pointerLeave)
    media?.addEventListener("focus", focus)
    media?.addEventListener("blur", leave)

    // Touch screens and mobile platforms have no hover: once most of the card is on screen
    // (scrolling the page or swiping the carousel), it rests on its cover for 2s, then crossfades
    // into the sizzle reel once a frame of it is decoded (as soon as one is, if that takes longer).
    // Leaving pauses the sizzle where it is and coming back resumes it, unless the card was away
    // for over 30s: then it starts again from the cover. Reduced motion and Save-Data keep the cover.
    setSizzle(window.matchMedia("(hover: none), (pointer: coarse)").matches || isMobile(detectPlatform()))
    const connection = (navigator as typeof window.navigator & { connection?: { saveData?: boolean } }).connection
    const cover = () => prefersReducedMotion() || connection?.saveData === true
    let wait: ReturnType<typeof setTimeout> | undefined
    let away = 0
    // Back to the cover with the sizzle rewound, without a fade (the card is off screen).
    const reset = () => {
      active = false
      setStill(true)
      if (video) video.currentTime = 0
      rest()
    }
    const inView = () => {
      mark(true)
      if (!video || mode() === "autoplay" || cover()) return
      // The sizzle (megabytes) buffers once the page has loaded, so on a slow phone it doesn't share
      // the connection with the card stills and scripts; the 2s wait below hides the difference.
      afterLoad(() => setSeen(true))
      if (active && performance.now() - away < 30_000) return void video.play().catch(() => {})
      if (active) reset()
      clearTimeout(wait)
      wait = setTimeout(enter, 2000)
    }
    const outOfView = () => {
      mark(false)
      clearTimeout(wait)
      away = performance.now()
      video?.pause()
    }
    const view = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
        rest()
        if (!sizzle()) return
        if (entry.intersectionRatio >= 0.6) inView()
        if (entry.intersectionRatio < 0.6) outOfView()
      },
      { threshold: [0, 0.6, 1] },
    )
    if (media) view.observe(media)
    // On phones the sizzle's metadata loads a screen ahead of the card scrolling into view.
    const ahead = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && sizzle()) setNear(!cover())
      },
      { rootMargin: "100% 50%" },
    )
    if (media) ahead.observe(media)
    onCleanup(() => {
      view.disconnect()
      ahead.disconnect()
      clearTimeout(wait)
      stop()
      media?.removeEventListener("pointerenter", pointerEnter)
      media?.removeEventListener("pointerleave", pointerLeave)
      card?.removeEventListener("menuclose", menuClose)
      media?.removeEventListener("focus", focus)
      media?.removeEventListener("blur", leave)
    })
  })

  return (
    <>
      <video
        ref={video}
        aria-hidden="true"
        // The demo's poster is its first product frame: show it only once the loop covers it, so the
        // card never flashes the demo while it loads.
        // On phones the cover stays over it until a frame of it is playing, so it needs no poster.
        // A clip whose still is its own poster (the feature clips) has the image over it until it
        // plays (except with autoplay), so the attribute would only download it again as WebP.
        poster={
          (props.demo && !loaded()) || sizzle() || (!props.loop && !props.still && mode() !== "autoplay")
            ? undefined
            : posterFile(props.poster)
        }
        data-set={props.set ? "" : undefined}
        muted
        loop
        playsinline
        onLoadedMetadata={speed}
        preload={seen() ? "auto" : near() ? "metadata" : "none"}
      >
        <VideoSources src={props.src} video={() => video} />
      </video>
      <Show
        when={props.loop}
        fallback={
          <Still
            data-slot="still"
            src={props.still ?? props.poster}
            sizes={props.still ? stillSizes.card : stillSizes.clip}
            // The product pages' feature clips, the only cards without a loop, are 1600 × 1000.
            width="1600"
            height="1000"
            alt=""
            data-set={props.set ? "" : undefined}
            data-mode={props.still ? "crossfade" : mode()}
            data-hidden={still() ? undefined : ""}
            data-loaded={loaded() ? "" : undefined}
            onLoad={() => setLoaded(true)}
          />
        }
      >
        {(loop) => (
          <>
            {/* The loop's first frame as an image, shown as soon as it loads (Site's pre-paint
                script marks it, before the page's code runs); the loop then fades in over it. Its
                data-loaded is set directly, so hydration never takes it away again. */}
            <Still
              ref={poster}
              data-slot="still"
              data-poster
              src={props.still ?? props.poster}
              sizes={stillSizes.card}
              width="1064"
              height="1330"
              alt=""
              aria-hidden="true"
              fetchpriority={props.priority ? "high" : undefined}
              // Cards off the first screen stay grey until they are scrolled near.
              loading={props.priority ? undefined : "lazy"}
              data-set={props.set ? "" : undefined}
              data-mode={loopMode()}
              data-hidden={still() ? undefined : ""}
              onLoad={(event) => event.currentTarget.setAttribute("data-loaded", "")}
            />
            <video
              ref={idle}
              data-slot="still"
              // No poster: the still image under it is the same frame, and the loop stays hidden
              // (data-loaded) until it has one of its own, so a poster would only be a second download.
              data-set={props.set ? "" : undefined}
              data-mode={loopMode()}
              data-hidden={still() ? undefined : ""}
              data-loaded={loaded() ? "" : undefined}
              onLoadedMetadata={speed}
              onLoadedData={() => setLoaded(true)}
              aria-hidden="true"
              muted
              loop
              playsinline
              // The first screen's loops buffer with the page; the others once they play on screen.
              preload={props.priority ? "auto" : "metadata"}
            >
              <VideoSources src={loop()} video={() => idle} />
            </video>
          </>
        )}
      </Show>
    </>
  )
}

/**
 * The visitor's platform: the request's on the server and in hydration (requestPlatform), what the
 * browser can say once mounted (an iPad reporting a Mac). Device-based, not width-based: a narrow
 * desktop window keeps the desktop buttons.
 */
export function useDevicePlatform() {
  const [platform, setPlatform] = createSignal(requestPlatform())
  onMount(() => setPlatform(detectPlatform()))
  return platform
}

/**
 * The main action for a product: OS download, store or install menu, or the SDK docs. The cards, Get
 * started and the product pages all use it, so they never drift. On a phone or tablet the Desktop
 * action is a "Download" menu of every build (phones keep the file for later) and the Mobile one is
 * that device's app; elsewhere the Desktop action downloads this computer's build (`split` adds a
 * menu of the others) and the Mobile one is a menu of both stores, or with `both` the two buttons.
 * While Android is coming soon (androidStatus), every Mobile action but an iPhone's leads with the
 * iPhone app and lists Android as unavailable.
 */
export function ProductAction(props: { slug: PageSlug; split?: boolean; both?: boolean }) {
  const language = useLanguage()
  const i18n = useI18n()
  const content = useContent()
  // The server and hydration read the same platform (requestPlatform), so the button renders
  // "Download for macOS" at its final width instead of growing after load.
  const platform = useDevicePlatform()
  const mobile = () => isMobile(platform())
  const [os, setOS] = createSignal<OS>(requestOS())
  // The exact build for this computer, once the browser has said (the Mac's chip; detectDesktopBuild).
  const [build, setBuild] = createSignal<DownloadPlatform>()
  const [open, setOpen] = createSignal(false)
  onCloseMenus(() => setOpen(false))
  const [copied, setCopied] = createSignal<string>()
  // Touch phones and tablets get the menu as a bottom sheet (sheet.tsx); pointers keep the dropdown.
  const [sheet, setSheet] = createSignal(false)
  const menuID = createUniqueId()
  let menu: HTMLDivElement | undefined
  let trigger: HTMLButtonElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let sheetControl: SheetControl | undefined

  // A store's listing, or a page of this site (localized) until the app is listed.
  const stores = mobileStores.map((store) => ({
    ...store,
    href: store.href.startsWith("/") ? language.route(store.href) : store.href,
  }))
  // A store still coming soon is never a device's own button: Android gets the iPhone-first layout.
  const store = () => stores.find((item) => !item.soon && item.platform.toLowerCase() === platform())
  // While Android is coming soon, everyone but an iPhone gets the iPhone app's button, with a menu
  // (or both buttons) listing Android as coming soon.
  const iosFirst = () => androidSoon && props.slug === "mobile" && !store()
  const ios = stores.find((item) => item.platform === "iOS")!

  // While its menu is open, the card (carousel, /product) keeps its hover state and its buttons:
  // the pointer moving from the card into the menu doesn't end it (CardVideo, products.css).
  createEffect(
    on(open, (isOpen, wasOpen) => {
      const card = menu?.closest<HTMLElement>('[data-component="product-card"]')
      if (!card) return
      card.toggleAttribute("data-menu-open", isOpen)
      if (wasOpen && !isOpen) card.dispatchEvent(new Event("menuclose"))
    }),
  )
  onCleanup(() => menu?.closest('[data-component="product-card"]')?.removeAttribute("data-menu-open"))

  onMount(() => {
    setOS(detectOS())
    setSheet(prefersSheet())
    if (props.slug === "desktop") void detectDesktopBuild().then(setBuild)
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return
      if (event instanceof MouseEvent && menu?.contains(event.target as Node)) return
      if (event instanceof KeyboardEvent && open() && menu?.contains(document.activeElement)) trigger?.focus()
      setOpen(false)
    }
    document.addEventListener("keydown", close)
    document.addEventListener("click", close)
    onCleanup(() => {
      document.removeEventListener("keydown", close)
      document.removeEventListener("click", close)
      clearTimeout(timer)
    })
  })

  // The whole row copies its command; embedded browsers that block the Clipboard API get the old copy
  // command instead.
  const copy = (item: { id: string; command: string }) => {
    const done = () => {
      setCopied(item.id)
      clearTimeout(timer)
      timer = setTimeout(() => setCopied(undefined), 1500)
    }
    void (navigator.clipboard?.writeText(item.command) ?? Promise.reject()).then(done, () => {
      if (copySelection(item.command)) done()
    })
  }

  // A known desktop OS gets its build directly; anything else (unknown systems) goes to the Desktop
  // page's builds to choose.
  const desktopButton = () => (
    <a
      href={
        build()
          ? getDownloadHref(build()!)
          : os()
            ? getDownloadHref(getDownloadPlatform(os()))
            : language.route("/desktop#download")
      }
      data-component="site-button"
    >
      <Show when={os()}>{(value) => <PlatformIcon platform={value()} />}</Show>
      {/* One text node with the OS inside, so its leading space survives the button's flex layout;
          the inline card layouts hide the OS to fit the button beside the title. */}
      <span>
        <Show when={os()} fallback={i18n.t("download.action.download")}>
          {(value) => <Marked text={i18n.t("site.action.forOs", { os: value() })} slots={{ os: "for-os" }} />}
        </Show>
      </span>
    </a>
  )

  // A store's button: "Download for iPhone", the device name hidden like the OS in inline cards. The
  // iPhone beta opens TestFlight in a new tab, but the button shows the Apple logo.
  const storeButton = (item: (typeof stores)[number]) => (
    <a
      href={item.href}
      data-component="site-button"
      {...betaLink(item, i18n.t("site.newTab", { label: i18n.t("site.action.forOsBeta", { os: item.device }) }))}
    >
      <PlatformIcon platform={item.platform} />
      <span>
        <Marked text={i18n.t("site.action.forOs", { os: item.device })} slots={{ os: "for-os" }} />
      </span>
    </a>
  )

  // A store row in the menus and sheets: the store and the device; the iPhone beta has TestFlight's
  // mark for the Apple logo and the new-tab arrow.
  const storeRow = (item: (typeof stores)[number]) => (
    <>
      <PlatformIcon platform={item.beta ? "TestFlight" : item.platform} />
      <span data-slot="label">
        {item.label}
        <Show when={item.beta}>
          <NewTab />
        </Show>
      </span>
      <span data-slot="status">{item.device}</span>
    </>
  )

  // A store that is coming soon: unavailable, still focusable, and named "Android, coming soon".
  const soonButton = (item: (typeof stores)[number]) => (
    <button
      type="button"
      data-component="site-button"
      aria-disabled="true"
      aria-label={i18n.t("site.action.comingSoonFor", { os: item.device })}
    >
      <PlatformIcon platform={item.platform} />
      <span>
        {item.device}
        <span data-slot="soon"> · {i18n.t("site.action.comingSoon")}</span>
      </span>
    </button>
  )

  // Every desktop build, a direct download each.
  const buildItems = () => (
    <For each={desktopBuilds}>
      {(item) => (
        <a href={getDownloadHref(item.id)} data-slot="store" role="menuitem">
          <PlatformIcon platform={item.platform} />
          <span data-slot="label">{i18n.t(item.label)}</span>
        </a>
      )}
    </For>
  )

  // The menu this action opens, shown as a sheet on touch screens.
  const sheetMenu = () => {
    if (props.slug === "desktop") return mobile() || props.split ? ("builds" as const) : undefined
    if (props.slug === "terminal" || props.slug === "mini") return "installs" as const
    if (props.slug === "mobile" && !store() && !props.both) return "stores" as const
  }

  // On a touch screen the menu opens as a sheet; true when it did.
  const openSheet = () => {
    if (!sheet() || !sheetControl || !trigger) return false
    sheetControl.open(trigger)
    return true
  }

  const toggle = (event: MouseEvent) => {
    if (openSheet()) return
    setOpen(!open())
    const panel = menu?.querySelector<HTMLElement>('[data-slot="menu"]')
    if (panel) fitMenu(panel)
    // From the keyboard, focus moves into the menu.
    if (open() && event.detail === 0)
      menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }

  // Up and down move between a menu's items; Home and End jump to the ends.
  const moveFocus = (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    items[(next + items.length) % items.length]?.focus()
  }

  return (
    <>
      <Switch>
        {/* A phone or tablet: "Download" opens every desktop build. */}
        <Match when={props.slug === "desktop" && mobile()}>
          <div data-component="site-menu" ref={menu}>
            <button
              ref={trigger}
              type="button"
              data-component="site-button"
              aria-haspopup="menu"
              aria-expanded={open() ? "true" : "false"}
              aria-controls={menuID}
              onClick={toggle}
            >
              Download
              <Chevron />
            </button>
            <Show when={open()}>
              <div
                data-slot="menu"
                id={menuID}
                role="menu"
                aria-label={i18n.t("site.action.desktopDownloads")}
                onKeyDown={moveFocus}
              >
                {buildItems()}
              </div>
            </Show>
          </div>
        </Match>
        <Match when={props.slug === "desktop"}>
          {/* With `split`, a chevron beside the button opens every desktop build, in the same menu as
            the Terminal and Mobile cards. */}
          <Show when={props.split} fallback={desktopButton()}>
            <div data-component="site-split">
              {desktopButton()}
              <div data-component="site-menu" ref={menu}>
                <button
                  ref={trigger}
                  type="button"
                  data-component="site-button"
                  data-slot="split-toggle"
                  aria-label={i18n.t("site.action.moreDesktopDownloads")}
                  aria-haspopup="menu"
                  aria-expanded={open() ? "true" : "false"}
                  aria-controls={menuID}
                  onClick={toggle}
                >
                  <Chevron />
                </button>
                <Show when={open()}>
                  <div
                    data-slot="menu"
                    id={menuID}
                    role="menu"
                    aria-label={i18n.t("site.action.desktopDownloads")}
                    onKeyDown={moveFocus}
                  >
                    {buildItems()}
                  </div>
                </Show>
              </div>
            </div>
          </Show>
        </Match>
        {/* A phone or tablet: its own app, one button. */}
        <Match when={props.slug === "mobile" && store()}>{(item) => storeButton(item())}</Match>
        {/* A computer could be next to either phone: both, plainly. */}
        <Match when={props.slug === "mobile" && props.both}>
          <div data-component="site-buttons">
            <For each={stores}>{(item) => (item.soon ? soonButton(item) : storeButton(item))}</For>
          </div>
        </Match>
        {/* Android coming soon: the iPhone app, and a chevron that lists both apps. */}
        <Match when={iosFirst()}>
          <div data-component="site-split">
            {storeButton(ios)}
            <div data-component="site-menu" ref={menu}>
              <button
                ref={trigger}
                type="button"
                data-component="site-button"
                data-slot="split-toggle"
                aria-label={i18n.t("site.action.moreMobileApps")}
                aria-haspopup="menu"
                aria-expanded={open() ? "true" : "false"}
                aria-controls={menuID}
                onClick={toggle}
              >
                <Chevron />
              </button>
              <Show when={open()}>
                <div
                  data-slot="menu"
                  id={menuID}
                  role="menu"
                  aria-label={i18n.t("site.action.mobileApps")}
                  onKeyDown={moveFocus}
                >
                  <For each={stores}>
                    {(item) => (
                      <Show
                        when={item.soon}
                        fallback={
                          <a
                            href={item.href}
                            data-slot="store"
                            role="menuitem"
                            {...betaLink(
                              item,
                              i18n.t("site.newTab", { label: i18n.t("site.action.storeBeta", { os: item.device }) }),
                            )}
                          >
                            {storeRow(item)}
                          </a>
                        }
                      >
                        <span
                          data-slot="store"
                          role="menuitem"
                          tabIndex={-1}
                          aria-disabled="true"
                          aria-label={i18n.t("site.action.comingSoonFor", { os: item.device })}
                        >
                          <PlatformIcon platform={item.platform} />
                          <span data-slot="label">{item.device}</span>
                          <span data-slot="status">{i18n.t("site.action.comingSoon")}</span>
                        </span>
                      </Show>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </Match>
        <Match when={props.slug === "sdk"}>
          <a href={language.route(sdkDocs)} data-component="site-button">
            {content().products.sdk.action}
          </a>
        </Match>
        {/* The VS Code extension; ACP editors are on its page. */}
        <Match when={props.slug === "ide"}>
          <a href={extensions.href} target="_blank" rel="noopener" data-component="site-button">
            {content().extensionCard.action}
            <NewTab />
          </a>
        </Match>
        <Match when={props.slug === "mobile" || props.slug === "terminal" || props.slug === "mini"}>
          <div data-component="site-menu" ref={menu}>
            <button
              ref={trigger}
              type="button"
              data-component="site-button"
              aria-expanded={open() ? "true" : "false"}
              aria-controls={menuID}
              onClick={() => {
                if (openSheet()) return
                setOpen(!open())
                const panel = menu?.querySelector<HTMLElement>('[data-slot="menu"]')
                if (panel) fitMenu(panel)
              }}
            >
              {props.slug === "mobile" ? i18n.t("download.action.download") : i18n.t("download.action.install")}
              <Chevron />
            </button>
            <Show when={open()}>
              <div data-slot="menu" id={menuID}>
                <Show
                  when={props.slug !== "mobile"}
                  fallback={
                    <For each={stores}>
                      {(store) => (
                        <a
                          href={store.href}
                          data-slot="store"
                          {...betaLink(
                            store,
                            i18n.t("site.newTab", { label: i18n.t("site.action.storeBeta", { os: store.device }) }),
                          )}
                        >
                          {storeRow(store)}
                        </a>
                      )}
                    </For>
                  }
                >
                  <For each={installs}>
                    {(item) => (
                      <button
                        type="button"
                        data-slot="install"
                        data-copied={copied() === item.id ? "" : undefined}
                        onClick={() => copy(item)}
                      >
                        <span data-slot="method">{item.id}</span>
                        <span data-slot="command">{item.command}</span>
                        <span data-slot="status" aria-live="polite">
                          <span data-slot="idle" aria-hidden={copied() === item.id}>
                            {i18n.t("site.action.copy")}
                          </span>
                          <span data-slot="done" aria-hidden={copied() !== item.id}>
                            {i18n.t("site.action.copied")}
                          </span>
                        </span>
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>
        </Match>
      </Switch>
      <Show when={sheet() && sheetMenu()}>
        {(kind) => (
          <Sheet
            name="product"
            label={
              kind() === "builds"
                ? i18n.t("site.action.desktopDownloads")
                : kind() === "installs"
                  ? i18n.t("site.action.installCommands")
                  : i18n.t("site.action.mobileApps")
            }
            control={(control) => (sheetControl = control)}
          >
            <Switch>
              <Match when={kind() === "builds"}>
                <ul>
                  <For each={desktopBuilds}>
                    {(item) => (
                      <li>
                        <a
                          href={getDownloadHref(item.id)}
                          data-slot="row"
                          on:click={() => sheetControl?.close()}
                        >
                          <PlatformIcon platform={item.platform} />
                          <span data-slot="label">{i18n.t(item.label)}</span>
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </Match>
              <Match when={kind() === "installs"}>
                <ul>
                  <For each={installs}>
                    {(item) => (
                      <li>
                        <button
                          type="button"
                          data-slot="row"
                          data-copied={copied() === item.id ? "" : undefined}
                          onClick={() => copy(item)}
                        >
                          <span data-slot="method">{item.id}</span>
                          <span data-slot="command">{item.command}</span>
                          <span data-slot="status" aria-live="polite">
                            {copied() === item.id ? i18n.t("site.action.copied") : i18n.t("site.action.copy")}
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Match>
              <Match when={kind() === "stores"}>
                <ul>
                  <For each={stores}>
                    {(item) => (
                      <li>
                        <Show
                          when={item.soon}
                          fallback={
                            <a
                              href={item.href}
                              data-slot="row"
                              on:click={() => sheetControl?.close()}
                              {...betaLink(
                                item,
                                i18n.t("site.newTab", { label: i18n.t("site.action.storeBeta", { os: item.device }) }),
                              )}
                            >
                              {storeRow(item)}
                            </a>
                          }
                        >
                          <button
                            type="button"
                            data-slot="row"
                            aria-disabled="true"
                            aria-label={i18n.t("site.action.comingSoonFor", { os: item.device })}
                          >
                            <PlatformIcon platform={item.platform} />
                            <span data-slot="label">{item.device}</span>
                            <span data-slot="status">{i18n.t("site.action.comingSoon")}</span>
                          </button>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Match>
            </Switch>
          </Sheet>
        )}
      </Show>
    </>
  )
}

/** The Terminal install commands shown openly: a tab per method over one command with a Copy action. */
export function InstallTabs() {
  const i18n = useI18n()
  const id = createUniqueId()
  const [selected, setSelected] = createSignal(0)
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  const select = (index: number) => {
    clearTimeout(timer)
    setCopied(false)
    setSelected(index)
  }

  const keyDown = (event: KeyboardEvent, index: number) => {
    const next = {
      ArrowLeft: (index - 1 + installs.length) % installs.length,
      ArrowRight: (index + 1) % installs.length,
      Home: 0,
      End: installs.length - 1,
    }[inlineKey(event)]
    if (next === undefined) return
    event.preventDefault()
    select(next)
    document.getElementById(`${id}-tab-${next}`)?.focus()
  }

  const copy = () => {
    void navigator.clipboard.writeText(installs[selected()].command).then(() => {
      clearTimeout(timer)
      setCopied(true)
      timer = setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div data-component="install-tabs">
      <div data-slot="tabs" role="tablist" aria-label={i18n.t("site.action.installMethod")}>
        <For each={installs}>
          {(item, index) => (
            <button
              type="button"
              role="tab"
              id={`${id}-tab-${index()}`}
              aria-controls={`${id}-panel`}
              aria-selected={selected() === index() ? "true" : "false"}
              tabIndex={selected() === index() ? 0 : -1}
              onClick={() => select(index())}
              onKeyDown={(event) => keyDown(event, index())}
            >
              {item.id}
            </button>
          )}
        </For>
      </div>
      <div data-slot="code" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected()}`}>
        <code data-copy-command {...copyOnClick(copy)}>
          {installs[selected()].command}
        </code>
        <button type="button" data-slot="copy" aria-live="polite" onClick={copy}>
          {copied() ? i18n.t("site.action.copied") : i18n.t("site.action.copy")}
        </button>
      </div>
    </div>
  )
}

/**
 * Resolves with the element once it is on the page, or with nothing after a second. Watches the
 * DOM rather than polling each frame, because rendering is paused while a view transition updates
 * the page.
 */
function elementReady(selector: string) {
  return new Promise<HTMLElement | undefined>((resolve) => {
    const find = () => document.querySelector<HTMLElement>(selector) ?? undefined
    if (find()) return resolve(find())
    const done = () => {
      observer.disconnect()
      clearTimeout(timer)
      resolve(find())
    }
    const observer = new MutationObserver(() => find() && done())
    observer.observe(document.body, { childList: true, subtree: true })
    const timer = setTimeout(done, 1000)
  })
}

/**
 * Keeps an open menu inside the carousel's visible area (or the window, outside the carousel),
 * which would otherwise cut it off: no wider than that area and 8px clear of the window's edges
 * (long install commands wrap), and slid sideways just enough.
 */
function fitMenu(panel: HTMLElement) {
  const area = panel.closest('[data-slot="track"]')?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth)
  // Never closer than 16px to a screen edge; on phones the menu takes that whole width, so the
  // install commands get as much room as there is (each still one line, cut with an ellipsis).
  const left = Math.max(area.left, 16)
  const right = Math.min(area.right, window.innerWidth - 16)
  panel.style.maxWidth = `${right - left}px`
  panel.style.width = window.matchMedia("(max-width: 40rem)").matches ? `${right - left}px` : ""
  // Laid out, not as drawn: the opening animation scales the menu from a corner.
  const parent = (panel.offsetParent ?? document.body).getBoundingClientRect()
  const start = parent.left + panel.offsetLeft
  const shift = Math.max(left - start, Math.min(0, right - (start + panel.offsetWidth)))
  panel.style.translate = shift ? `${Math.round(shift)}px 0` : ""
}

// The card transition running now. A newer one (back during a grow) owns the page's markers.
let current: ViewTransition | undefined

/** The product page hero's poster, loading from the first hover so a click doesn't wait for it. */
function heroPoster(slug: PageSlug) {
  const media = pageMedia(siteSettings.productVideos, slug, "landscape")
  // A themed hero (videos.ts): the poster for the page's theme, the one the page will show.
  const poster = media?.themes?.[pageScheme() ?? "light"].poster ?? media?.poster
  if (poster) imageReady(poster, stillSizes.hero)
  return poster
}

// Each image decodes once: a click after the hover finds it ready instead of decoding it again.
const decoded = new Map<string, Promise<unknown>>()

/**
 * Sets how long the box takes from how far it travels: the set duration for a trip of half the
 * window's diagonal or more, down to three quarters of it for a short one, so a small move doesn't
 * drift. Runs before the transition animates, which reads the value when it starts.
 */
function travel(from: DOMRect, to: DOMRect, duration: number) {
  const distance = Math.max(
    Math.hypot(to.left - from.left, to.top - from.top),
    Math.hypot(to.right - from.right, to.bottom - from.bottom),
  )
  const scale = Math.min(1, Math.max(0.75, distance / (0.5 * Math.hypot(window.innerWidth, window.innerHeight))))
  const root = document.documentElement
  const scaled = Math.round(duration * scale)
  root.style.setProperty("--card-duration", `${scaled}ms`)
  if (root.dataset.cardGrow !== "shrink") return
  root.style.setProperty("--card-page-fade", `${Math.min(siteSettings.cardPageFade, scaled)}ms`)
  root.style.setProperty("--card-image-fade", `${Math.min(siteSettings.cardImageFade, scaled)}ms`)
}

/**
 * Marks the page as changing between a card and its product page ("fade" when reduced motion keeps
 * the box still), and sets the timing from Settings › Card to page for the ::view-transition styles
 * in product-page.css.
 */
function markCardTransition(direction: "grow" | "shrink" | "fade") {
  const root = document.documentElement
  root.dataset.cardGrow = direction
  // Going back, nothing may outlast the shrink: the page and image fades fit inside it and the new
  // page fades in at once, so the transition ends when the box lands.
  const shrinking = direction === "shrink"
  const duration = shrinking ? siteSettings.cardShrinkDuration : siteSettings.cardGrowDuration
  root.style.setProperty("--card-duration", `${duration}ms`)
  root.style.setProperty("--card-easing", cardEasingCurves[siteSettings.cardEasing])
  root.style.setProperty(
    "--card-page-fade",
    `${shrinking ? Math.min(siteSettings.cardPageFade, duration) : siteSettings.cardPageFade}ms`,
  )
  root.style.setProperty("--card-page-delay", `${shrinking ? 0 : siteSettings.cardPageDelay}ms`)
  root.style.setProperty(
    "--card-image-fade",
    `${shrinking ? Math.min(siteSettings.cardImageFade, duration) : siteSettings.cardImageFade}ms`,
  )
}

/** True when at least half of the box is inside the window (and inside `clip`, if given). */
function onScreen(box: DOMRect, clip?: DOMRect) {
  const left = Math.max(box.left, 0, clip?.left ?? 0)
  const right = Math.min(box.right, window.innerWidth, clip?.right ?? Infinity)
  const top = Math.max(box.top, 0, clip?.top ?? 0)
  const bottom = Math.min(box.bottom, window.innerHeight, clip?.bottom ?? Infinity)
  const visible = Math.max(0, right - left) * Math.max(0, bottom - top)
  return box.width > 0 && box.height > 0 && visible >= (box.width * box.height) / 2
}

/** Resolves once an image (the copy a <picture> with `sizes` picks) has loaded and decoded, or after 400ms. */
function imageReady(src: string, sizes: string) {
  if (!decoded.has(src)) {
    const image = loadStill(src, sizes)
    decoded.set(
      src,
      image.decode().catch(() => decoded.delete(src)),
    )
  }
  return Promise.race([decoded.get(src), new Promise((resolve) => setTimeout(resolve, 400))])
}

/** Runs `run` once the page's load event has fired (now, if it already has). */
function afterLoad(run: () => void) {
  if (document.readyState === "complete") return run()
  window.addEventListener("load", run, { once: true })
}

/** A beta store link's attributes: a new tab, and its name (one that says "TestFlight beta"). */
function betaLink(item: { beta: boolean }, name: string) {
  if (!item.beta) return {}
  return { target: "_blank", rel: "noopener", "aria-label": name }
}

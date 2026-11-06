import { moreProducts, type MoreSlug, type PageSlug, type ProductSlug } from "./product-data"
import { siteSettings } from "./settings"

type VideoFiles = { portrait: string; landscape: string; portraitPoster: string; landscapePoster: string }

type Manifest = {
  id: string
  label: string
  tool: string
  style: string
  products: Partial<Record<ProductSlug, VideoFiles>>
}

/**
 * The sets the video experiments wrote to public/product-videos/<id>/manifest.json, bundled at build
 * time so the server renders the cards' and heroes' posters, and Vite picks up new sets in dev.
 */
export const videoSets = Object.values(
  import.meta.glob<Manifest>("../../../public/product-videos/*/manifest.json", { eager: true, import: "default" }),
).toSorted((a, b) => a.id.localeCompare(b.id))

export const videoSetIds = () => videoSets.map((set) => set.id)

/**
 * Card covers recorded in a page locale: public/product-videos/card-loops/locales.json lists, per
 * locale, the covers with a `<cover>.<locale>.mp4` and `.webp` beside the English ones. Any other
 * cover, and every other locale, uses the English files. To add one, drop the two files in and list
 * the cover under its locale. Read at build time, so the server picks the page locale's files.
 */
const coverLocales: Record<string, string[] | undefined> =
  Object.values(
    import.meta.glob<Record<string, string[]>>("../../../public/product-videos/card-loops/locales.json", {
      eager: true,
      import: "default",
    }),
  )[0] ?? {}

function coverFile(cover: string, locale: string | undefined) {
  return locale && coverLocales[locale]?.includes(cover)
    ? `/product-videos/card-loops/${cover}.${locale}`
    : `/product-videos/card-loops/${cover}`
}

/**
 * The portrait (carousel) or landscape (product hero) video for a product from a set, if any. A set
 * id saved by an older build that no longer exists (the panning sets are archived) falls back to the
 * default set. `locale`: the page's, for a card cover recorded in it (coverLocales).
 */
export function productVideo(setId: string, slug: ProductSlug, aspect: "portrait" | "landscape", locale?: string) {
  const set = videoSets.find((item) => item.id === setId) ?? videoSets.find((item) => item.id === defaultSet)
  const files = set?.products[slug]
  if (!set || !files) return
  const folder = set.id
  const hover = aspect === "portrait" && cardHovers[slug]
  // Settings › Card hover entry › demo: the hover cut from its first product shot; "continue" opens
  // on the resting cover's own first second, then cuts into the same shots.
  const demo = hover && siteSettings.cardHoverEntry === "demo"
  const angled = siteSettings.cardVideoCut === "angled" && slug in angledCuts
  const cut = `card-hover/${angled ? "angled" : "cinematic"}${demo ? "" : "-continue"}`
  // Settings › Mobile cover: the Living Orb loop, or the call bar's.
  const cover =
    slug === "mobile" && siteSettings.mobileCover === "orb" ? `mobile-orb-${siteSettings.mobileOrbShade}` : slug
  return {
    src: hover ? `/product-videos/${cut}/${slug}.mp4` : `/product-videos/${folder}/${files[aspect]}`,
    poster: hover
      ? `/product-videos/${cut}/${slug}.jpg`
      : `/product-videos/${set.id}/${aspect === "portrait" ? files.portraitPoster : files.landscapePoster}`,
    still: aspect === "portrait" && slug in cardLoops ? `${coverFile(cover, locale)}.webp` : undefined,
    loop: aspect === "portrait" && slug in cardLoops ? `${coverFile(cover, locale)}.mp4` : undefined,
    themes: aspect === "landscape" ? heroThemes(slug) : undefined,
    // The hover video starts on the card loop's framing, so the card swaps to it with a short crossfade.
    matchesLoop: Boolean(hover) && !demo,
    demo,
  }
}

/**
 * The media for any product page's hero (landscape) or card (portrait): a set's video for the
 * carousel's four, or the fixed files below for the others. Nothing for a product with no real
 * footage yet: its hero and card stay black.
 */
export function pageMedia(
  setId: string,
  slug: PageSlug,
  aspect: "portrait" | "landscape",
  locale?: string,
):
  | {
      src?: string
      poster: string
      still?: string
      loop?: string
      themes?: ReturnType<typeof heroThemes>
      matchesLoop?: boolean
      demo?: boolean
    }
  | undefined {
  if (!moreProducts.some((item) => item.slug === slug)) return productVideo(setId, slug as ProductSlug, aspect, locale)
  if (!moreMedia[slug as MoreSlug]) return
  const poster = `/product-videos/more/${slug}-${aspect}.jpg`
  const src = `/product-videos/more/${slug}-${aspect}.mp4`
  if (aspect === "landscape") return { src, poster, themes: heroThemes(slug) }
  // A card with a resting loop rests on it and plays the session on hover, as the carousel's four do.
  if (aspect === "portrait" && slug in moreLoops)
    return {
      src,
      poster,
      still: `${coverFile(slug, locale)}.webp`,
      loop: `${coverFile(slug, locale)}.mp4`,
    }
  // The poster is the video's last frame, so the card crossfades between them.
  return { src, poster, still: poster }
}

/**
 * The cards after the carousel's four with a resting loop in card-loops: Mini's is real `opencode
 * mini` sitting idle, its caret blinking (made in product-videos/mini next to the checkout).
 */
const moreLoops: Partial<Record<MoreSlug, true>> = { mini: true }

/**
 * The products after the carousel's four with real footage, the same in every set
 * (public/product-videos/more): Mini is a real `opencode mini` session recorded with VHS. IDE
 * extensions has none yet.
 */
const moreMedia: Partial<Record<MoreSlug, true>> = { mini: true }

/**
 * The product pages' heroes, framed for the hero's wide box: the whole window (or the whole recorded
 * frame) pulled back on a flat backdrop, which object-fit: cover crops at any of the box's ratios
 * (1.6 to 2.45) without touching the UI. One file per theme, as video has no alpha: #161616 in light
 * (the home cards' backdrop) and #1e1e1e in dark (a gentle step up from the #0c0c0c page); Mobile's
 * phone recording keeps its own #0a0a0a backdrop in both, its edge feathered into it. Made in
 * product-videos/cinematic next to the checkout (edits/hero-*.json with angle.py); the posters are
 * each file's first frame as the browser decodes it (product-videos/wordmark/hero-posters.mjs).
 */
const themedHeroes: Partial<Record<PageSlug, true>> = {
  desktop: true,
  mobile: true,
  terminal: true,
  sdk: true,
  mini: true,
}

function heroThemes(slug: PageSlug) {
  if (!themedHeroes[slug]) return
  const file = (theme: string) => `/product-videos/heroes/${slug}-landscape-${theme}`
  return {
    light: { src: `${file("light")}.mp4`, poster: `${file("light")}.webp` },
    dark: { src: `${file("dark")}.mp4`, poster: `${file("dark")}.webp` },
  }
}

/**
 * The page's colour scheme on the client: the site's theme (the site root's data-theme, which the
 * pre-paint script sets from the saved choice), else the system's. Server: undefined.
 */
export function pageScheme(): "light" | "dark" | undefined {
  if (typeof document === "undefined") return
  const theme = document.querySelector<HTMLElement>("[data-site]")?.dataset.theme
  if (theme === "light" || theme === "dark") return theme
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

/** The default product video set: locked-off real UI shots joined by hard cuts (public/product-videos/locked). */
const defaultSet = "locked"

/**
 * Products with an angled hover cut (Settings › Card video cut › angled, the default). The cuts are
 * card-hover/{cinematic,angled}/<slug>.mp4 for "demo" and card-hover/{cinematic,angled}-continue for
 * "continue" (the cover's first second, then the same shots); made in product-videos/cinematic next
 * to the checkout (lock.py, angle.py, continue.sh).
 */
const angledCuts: Partial<Record<ProductSlug, true>> = { desktop: true, mobile: true, terminal: true, sdk: true }

/** The carousel cards with hover cuts; they replace the set's portrait video, whatever set is chosen. */
const cardHovers: Partial<Record<ProductSlug, true>> = { desktop: true, mobile: true, terminal: true, sdk: true }

/**
 * The carousel cards' resting state for every set, in place of the portrait poster: a short
 * seamless loop of the product's key element (`<slug>.mp4`) and its first frame (`<slug>.webp`).
 * They are not frames of the product videos, so the card crossfades between them.
 */
const cardLoops: Partial<Record<ProductSlug, true>> = { desktop: true, mobile: true, terminal: true, sdk: true }

/** The focused (essential UI only) clips that exist so far. */
const focusedClips = [
  "desktop-1",
  "desktop-2",
  "desktop-3",
  "terminal-1",
  "terminal-2",
  "terminal-3",
  "sdk-1",
  "sdk-2",
  "sdk-3",
  "mobile-1",
  "mobile-2",
  "mobile-3",
]

/**
 * The fourth showcase clips (`<slug>-4`) whose full-UI still exists so far (features/<slug>-4.jpg).
 * Add a name here when its files land, and to focusedClips when focused/<slug>-4.* does. Until then
 * the showcase shows a black placeholder.
 */
export const fourthClips: string[] = ["terminal-4", "desktop-4", "mobile-4"]

/**
 * The fourth clips whose video (features/<slug>-4.mp4) is in the files bucket. The others show
 * their still alone, so the page requests no video that isn't there.
 */
const fourthVideos: string[] = []

/**
 * A feature clip's video and poster: the focused version when that setting is on and it exists,
 * otherwise the full-UI clip. Nothing for a fourth clip that doesn't exist yet, and no video for
 * one whose video isn't uploaded.
 */
export function featureClip(clip: string): { src?: string; poster: string } | undefined {
  const name = clip.split("/").pop() ?? ""
  const fourth = name.endsWith("-4")
  if (siteSettings.featureClipStyle === "focused" && focusedClips.includes(name))
    return {
      src: `/product-videos/features/focused/${name}.mp4`,
      poster: `/product-videos/features/focused/${name}.jpg`,
    }
  if (fourth && !fourthClips.includes(name)) return
  return {
    src: fourth && !fourthVideos.includes(name) ? undefined : `${clip}.mp4`,
    poster: `${clip}.jpg`,
  }
}

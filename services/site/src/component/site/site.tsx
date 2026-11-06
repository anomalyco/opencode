import "./site.css"
import "./rtl.css"
import { preloadSettings, themeScript } from "./preload-settings"
import "./locale-type.css"
import "./github-link.css"
import "./tap-targets.css"
import "./asset-buttons.css"
import { Link, Meta } from "@solidjs/meta"
import { A, createAsync, useLocation, useNavigate, usePreloadRoute } from "@solidjs/router"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  lazy,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js"
import { Dynamic, isServer } from "solid-js/web"
import interLatin from "../../asset/fonts/inter-latin.woff2"
import interRest from "../../asset/fonts/inter-rest.woff2"
import logoLight from "../../asset/brand/opencode-logo-light.svg"
import logoDark from "../../asset/brand/opencode-logo-dark.svg"
import wordmarkLight from "../../asset/brand/opencode-wordmark-light.svg"
import wordmarkDark from "../../asset/brand/opencode-wordmark-dark.svg"
import { LanguagePicker } from "~/component/language-picker"
import { LanguageSheet } from "~/component/language-sheet"
import { useI18n } from "~/context/i18n"
import type { Key } from "~/i18n"
import { useLanguage } from "~/context/language"
import { strip } from "~/lib/language"
import { brandAssets } from "~/lib/media"
import { status, type ServiceStatus } from "~/lib/status"
import { useViewportCover } from "~/lib/viewport"
import { loadMarkdownPages, markdownKey, markdownPagesLoaded } from "./use-markdown"
import type { MarkdownPages } from "./markdown-pages"
import { LiveMeta } from "~/component/head-meta"
import { Chevron, ChevronRight, ExternalArrow, NewTab, ThemeIcon, themes } from "./icons"
import { GitHubLink } from "./github-link"
import { MenuSheet, MenuToggle } from "./phone-menu"
import { siteLinks } from "./links"
import {
  navEditing,
  navList,
  navSavedLabel,
  navSequence,
  setNavEditing,
  setNavLabel,
  setNavVisible,
  navCustomItems,
  removeNavItem,
  sortableNav,
} from "./nav-order"
// The Markdown view's styles load with the page: they also hide the page while the view loads.
import "./markdown-view.css"
import { monoFontChoice, monoFontLatin } from "./mono-fonts"
import { NavVersions } from "./nav-versions"
import { closeAllMenus, closeMenusOnLinks, onCloseMenus, takeMenuNavigation } from "./menu-open"
import { watchSurfaces } from "./surface"
import { designCopy, designMode } from "./design-copy"
import { bannerThemeColorScript, bannerTopColor, bannerVisible, SiteBanner } from "./site-banner"
import { bannerDismissScript } from "./site-banner-script"
import { Tooltips } from "./tooltip"
import { SiteSearch } from "./search"
import { preloadVisibleLinks } from "./preload-visible"
import { adoptVoice, dropVoice } from "./voice/host"
// The fan's styles load with the page; its code on first use (loadLogoFan).
import "./logo-fan.css"
import type { LogoFan } from "./logo-fan"
import { logoVariantSvgs } from "./logo-variants"
import { AnomalyLogo, Logo, LogoIcon, Wordmark } from "./marks"
import {
  navGroups,
  toggles,
  carouselBreakpoints,
  loadSiteSettings,
  siteSettingsDefaults,
  spacerGradientRule,
  ditherGradientRule,
  setSiteSetting,
  siteSettings,
  statusPreviews,
} from "./settings"

export { Chevron, ExternalArrow, NewTab, PlatformIcon } from "./icons"
export {
  applyCarouselPreset,
  carouselBreakpoints,
  carouselPresetNames,
  docsSwitchers,
  heroVariants,
  spacerStyles,
  setCarouselSetting,
  setSiteSetting,
  siteSettings,
} from "./settings"

// Development tools: the settings panel (downloaded the first time Settings opens), Design mode and
// the device preview. Production builds leave them out, shortcuts and all.
const SettingsPanel = import.meta.env.DEV ? lazy(() => import("./settings-panel")) : undefined
const DesignMode = import.meta.env.DEV ? lazy(() => import("./design-mode")) : undefined
const DevicePreview = import.meta.env.DEV ? lazy(() => import("./device-preview")) : undefined

// The logo's fan menu, loaded the first time it may open: a pointer, touch or focus on a logo, or
// a right-click before any of those.
const [logoFan, setLogoFan] = createSignal<typeof LogoFan>()
let logoFanLoad: Promise<void> | undefined
const loadLogoFan = () => (logoFanLoad ??= import("./logo-fan").then((module) => void setLogoFan(() => module.LogoFan)))
const prefetchLogoFan = () => {
  if (siteSettings.logoMenu === "fan") void loadLogoFan().catch(() => (logoFanLoad = undefined))
}

// Inter as WOFF2, split so most pages only fetch the Latin file (about 95 KB instead of the 870 KB
// TTF). The other file has the Greek, Cyrillic, Vietnamese and symbol glyphs. The ranges must not
// overlap: a character in both that Inter lacks would fetch the second file only to fall back. The
// Latin file keeps both axes (weight, optical size) but only the OpenType features the site uses
// (pyftsubset --layout-features="calt,case,ccmp,locl,tnum,pnum,kern,mark,mkmk,cpsp,liga"): no
// character variants or stylistic sets.
const interFaces = [
  [
    interRest,
    "U+0180-0191, U+0193-0217, U+021C-0236, U+0238-02BA, U+02BD-02C5, U+02C8, U+02CA-02D7, U+02DE-02FF, U+0309, U+030D-0325, U+032A-058F, U+0E3F, U+1D00-1E9D, U+1E9F-1FFF, U+2070-20AB, U+20AD-20B8, U+20BA-20BC, U+20BE-2112, U+2114-2115, U+2117-2121, U+2123-2125, U+2127-212D, U+212F-218F, U+2200-2211, U+2213-2214, U+2216-2218, U+221A-221D, U+221F-2247, U+2249-225F, U+2261-2263, U+2266-2302, U+2304-2317, U+2319-2324, U+2326-232A, U+232C-238A, U+238C-23CD, U+23CF-259F, U+2600-2712, U+2714, U+2716-2E7F, U+A640-A9FF, U+E000-F8FF",
  ],
  [
    interLatin,
    "U+0000-017F, U+0192, U+0218-021B, U+0237, U+02BB-02BC, U+02C6-02C7, U+02C9, U+02D8-02DD, U+0300-0308, U+030A-030C, U+0326-0329, U+1E9E, U+2000-206F, U+20AC, U+20B9, U+20BD, U+2113, U+2116, U+2122, U+2126, U+212E, U+2190-21FF, U+2212, U+2215, U+2219, U+221E, U+2248, U+2260, U+2264-2265, U+2303, U+2318, U+2325, U+232B, U+238B, U+23CE, U+25A0-25FF, U+2713, U+2715, U+FB01-FB02, U+FEFF, U+FFFD",
  ],
]
  .map(
    ([url, range]) =>
      `@font-face { font-family: "Inter"; src: local("Inter"), local("Inter Variable"), url(${url}) format("woff2"); font-weight: 100 900; font-display: optional; unicode-range: ${range}; }`,
  )
  .join("\n")

// A nav item as the nav renders it: a known one (links.ts) or a custom link (nav-order.tsx).
type NavItemView = { id: string; label: string; href: string; arrow: boolean; external: boolean; company: boolean }

// Pages of this site that render client-side; everything else keeps a full page load. The docs
// (/docs) are served separately, and /download redirects on the server.
const clientPages = /^\/(?:desktop|mobile|terminal|sdk|changelog(?:\/v\d[\w.+-]*)?|brand|press|legal(?:\/.*)?)?\/?$/
function clientPage(pathname: string) {
  return clientPages.test(strip(pathname))
}
// The full page loads a link here can lead to on this domain (this site's other pages, in any
// language, the docs and Stats), fetched once the pointer rests on the link so the page opens sooner.
// Only addresses that are safe to request ahead of time: never the Console or a download, and never a
// language link (hreflang), whose page sets the language cookie. Browsers without Speculation Rules
// ignore it.
const speculationRules = JSON.stringify({
  prefetch: [
    {
      source: "document",
      eagerness: "moderate",
      where: {
        and: [
          {
            href_matches: [
              "{/:locale}?/:page(product|ide|mini|font)",
              "{/:locale}?/product/*",
              "{/:locale}?/extensions/*",
              "/docs{/*}?",
              "/data{/*}?",
            ],
          },
          { not: { selector_matches: "[hreflang]" } },
        ],
      },
    },
  ],
})

// Labels and headlines match status.opencode.ai.
const statusLabel = {
  operational: "site.status.operational",
  degraded: "site.status.degraded",
  outage: "site.status.outage",
  unknown: "site.status.unknown",
} as const satisfies Record<ServiceStatus, Key>
const statusHeadline = {
  operational: "site.status.operationalHeadline",
  degraded: "site.status.degradedHeadline",
  outage: "site.status.outageHeadline",
  unknown: "site.status.unknownHeadline",
} as const satisfies Record<ServiceStatus, Key>
// Preview-only bar sequences, oldest first; the last bar is the current state.
const statusSamples: Record<Exclude<(typeof statusPreviews)[number], "live">, ServiceStatus[]> = {
  operational: ["operational", "operational", "operational", "operational", "operational", "operational"],
  degraded: ["operational", "operational", "operational", "operational", "operational", "degraded"],
  outage: ["operational", "operational", "operational", "operational", "degraded", "outage"],
  mixed: ["operational", "operational", "operational", "degraded", "operational", "operational"],
  unknown: ["unknown", "unknown", "unknown", "unknown", "unknown", "unknown"],
}

/**
 * Shared layout for the new marketing pages: fixed sidebar with the logo and primary nav, the
 * content column, the footer whose secondary nav scrolls up under the sidebar, and the
 * development settings panel. Pages render their sections as children.
 */
// Set after the first page mounts in the browser. Pages reached by in-place navigation then fade
// their content in; the first load paints immediately.
let navigated = false

export function Site(props: {
  page: string
  children: JSX.Element
  /** Page-specific settings for each section of the settings panel. */
  settings?: (section: SettingsSectionID) => JSX.Element
  /** Replaces the numbered primary nav, for example with the docs navigation. */
  nav?: JSX.Element
  /** The current page in `nav`, shown on the button that opens it on small screens. */
  navLabel?: string
  /** A right-hand sidebar, the same width as the left one. */
  aside?: JSX.Element
  /**
   * Leaves out the nav, the small-screen top bar and the footer: the page draws its own world and
   * gets only the logo (top-left) and the theme controls (fixed bottom-left).
   */
  bare?: boolean
  /**
   * The page as Markdown: `href` serves it to agents, `source` renders it in place of the page
   * when the reader turns on the Markdown view.
   */
  markdown?: { href: string; source: (pages: MarkdownPages) => string }
  /**
   * Fixed docs component options (data-docs-variants) instead of the reader's Settings › docsVariants,
   * for a reference page that must always show the locked set (/dev/docs).
   */
  docsVariants?: string
}) {
  const i18n = useI18n()
  const language = useLanguage()
  const location = useLocation()
  const navigate = useNavigate()
  // The page-change fade, except when a carousel card is growing into this page: the view
  // transition is then the only motion.
  const enter = !isServer && navigated && !document.documentElement.hasAttribute("data-card-grow")
  const routed = !isServer && navigated
  onMount(() => (navigated = true))
  const preloadRoute = usePreloadRoute()
  // The page runs under the notch and home indicator; edge elements pad by the safe-area insets.
  useViewportCover()
  // Read the saved theme before the first client render so hydration doesn't flip it back to
  // "system" for a frame. The inline script below applies it even earlier, before first paint.
  const [theme, setTheme] = createSignal<(typeof themes)[number]>(
    isServer ? "system" : (themes.find((item) => item === localStorage.getItem("opencode-theme")) ?? "system"),
  )
  // The browser bar colour: the open banner's blue while it covers the top of the screen, the letters
  // bar's while it fills the bottom, else the page's background in the scheme the tag's media query
  // stands for (or the chosen theme's).
  const themeColor = (scheme: "light" | "dark") =>
    bannerTopColor() ??
    lettersBlue() ??
    ((theme() === "system" ? scheme : theme()) === "dark" ? "#0c0c0c" : siteSettings.lightBackground)
  const colorScheme = () => (theme() === "system" ? "light dark" : theme())
  const [dark, setDark] = createSignal(false)
  const [settings, setSettings] = createSignal(false)
  // Voice mode only ever renders in the browser.
  const [voiceReady, setVoiceReady] = createSignal(false)
  onMount(() => setVoiceReady(true))
  // The logo menu opens in whichever header holds the logo that was right-clicked.
  // `origin` is the logo's centre from the menu's left edge, where the menus scale in from.
  const [logoMenu, setLogoMenu] = createSignal<{ owner: "sidebar" | "topbar"; x: number; y: number; origin?: number }>()
  const [menu, setMenu] = createSignal(false)
  const [sectionNav, setSectionNav] = createSignal(false)
  onCloseMenus(() => {
    setMenu(false)
    setSectionNav(false)
    setLogoMenu(undefined)
  })
  const [markdown, setMarkdown] = createSignal(false)
  // The Markdown view's code, loaded the first time it is wanted: its shortcut's "m", a pointer or
  // focus on its switch, or a reload in the view.
  const [markdownPages, setMarkdownPages] = createSignal(markdownPagesLoaded())
  const loadMarkdown = () => loadMarkdownPages().then((pages) => setMarkdownPages(pages))
  const prefetchMarkdown = () => void loadMarkdown().catch(() => undefined)
  let page!: HTMLDivElement
  let sidebarNav: HTMLElement | undefined
  let footerNav: HTMLElement | undefined
  const [navAway, setNavAway] = createSignal(false)
  // Set after the first toggle, so only a swap (not the first page load) animates the content in.
  const [swapped, setSwapped] = createSignal(false)
  let mark: HTMLDivElement | undefined
  // While the wordmark's letters are out of order, the footer shows a line about the font. It is
  // always there with the wordmark's play on, so it fades in and out without moving anything.
  const [wordmarkNote, setWordmarkNote] = createSignal(false)
  // Whether the "Like letters?" bar is on screen, so the voice orb can rise above it.
  const [lettersBarInView, setLettersBarInView] = createSignal(false)
  // The bar shows while the letters are out of their "opencode" order and slides away once they are
  // put back.
  const lettersBarShown = wordmarkNote
  // The letters bar's body: the full label after its highlight ("Like letters?"), or the whole label
  // in a language where it doesn't start with it.
  const lettersBody = () => {
    const label = i18n.t("footer.wordmark.fontLabel")
    const highlight = i18n.t("footer.wordmark.font")
    return label.startsWith(highlight) ? label.slice(highlight.length).trim() : label
  }
  // Whether the whole open bar is on screen (the page is scrolled to its end), so it fills the bottom
  // of the screen.
  const [lettersBarAtEnd, setLettersBarAtEnd] = createSignal(false)
  const watchLettersBar = (element: HTMLDivElement) => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setLettersBarInView(entry.isIntersecting)
        setLettersBarAtEnd(entry.intersectionRatio >= 0.98)
      },
      { threshold: [0, 0.98] },
    )
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  }
  // While the open bar fills the bottom of the screen, its blue runs on to the screen's bottom edge:
  // the page behind the site (what shows past the end, and what iOS Safari tints its bottom toolbar
  // area from) and the browser bar colour take the bar's blue as painted, and a fixed strip under the
  // home indicator (site.css) gives Safari a blue element touching the bottom edge.
  const lettersBottom = () => lettersBarShown() && lettersBarAtEnd()
  const [lettersBlue, setLettersBlue] = createSignal<string>()
  createEffect(
    on(lettersBottom, (bottom) => {
      const link = document.querySelector<HTMLElement>('[data-component="letters-bar"] a')
      const blue = bottom && link ? getComputedStyle(link).backgroundColor : undefined
      setLettersBlue(blue)
      if (blue) document.documentElement.style.backgroundColor = blue
      else document.documentElement.style.removeProperty("background-color")
    }),
  )
  onCleanup(() => {
    if (!isServer) document.documentElement.style.removeProperty("background-color")
  })
  // The bar grows at the very end of the page. Someone at the bottom stays at the bottom while it
  // grows, so the page visibly moves up with it.
  createEffect(
    on(
      lettersBarShown,
      (shown) => {
        if (!shown) return
        const root = document.documentElement
        if (window.scrollY + window.innerHeight < root.scrollHeight - 4) return
        const until = performance.now() + 400
        const follow = () => {
          window.scrollTo(0, root.scrollHeight)
          if (performance.now() < until) requestAnimationFrame(follow)
        }
        requestAnimationFrame(follow)
      },
      { defer: true },
    ),
  )
  const wordmarkEntrance = () => (siteSettings.footerWordmark === "off" ? "off" : siteSettings.footerWordmarkAnimation)
  let menuToggle: HTMLButtonElement | undefined
  // Settings opens from the keyboard (Shift+S, or the search), so Escape gives focus back to
  // where it was.
  let settingsReturn: HTMLElement | undefined
  const toggleSettings = () => {
    if (!settings() && document.activeElement instanceof HTMLElement) settingsReturn = document.activeElement
    setSettings(!settings())
  }
  let content: HTMLElement | undefined

  const navVariant = () => siteSettings.nav
  const logoVariant = () => siteSettings.logo
  const popoverTheme = () => siteSettings.popover
  const statusPreview = () => siteSettings.status
  const liveStatus = createAsync(() => status())
  const statusView = () => {
    const preview = statusPreview()
    const bars = preview === "live" ? (liveStatus() ?? statusSamples.operational) : statusSamples[preview]
    return { bars, current: bars[bars.length - 1] }
  }

  // Follows the locale, so a client-side language switch relabels the nav and footer.
  const links = createMemo(() => siteLinks(i18n.t, language.route))
  // Every known item renders, in the saved list's order (Design mode shows the hidden ones, dimmed);
  // the shown ones are numbered and take the number keys. The items stay the same objects while the
  // list changes, so a reorder moves them in place.
  const navEntries = createMemo(() =>
    links().nav.map(
      (item): NavItemView => ({
        id: item.id,
        label: item.label,
        href: siteSettings.productNavDemo === "on" && item.demo ? item.demo : item.href,
        arrow: "arrow" in item && !!item.arrow,
        external: "external" in item && !!item.external,
        company: "company" in item,
      }),
    ),
  )
  const navEntry = (id: string) => navList().find((entry) => entry.id === id)
  // Deleted items (Design mode can add them back) don't render; custom links follow the known ones.
  const navAll = createMemo(() =>
    navSequence(
      [...navEntries(), ...navCustomItems(navList())],
      navList(),
      siteSettings.navGroups === "grouped",
    ).filter((item) => !navEntry(item.id)?.removed),
  )
  const nav = createMemo(() => navAll().filter((item) => navEntry(item.id)?.visible))
  const navLabel = (item: { id: string; label: string }) =>
    navSavedLabel(navEntry(item.id), language.locale()) ?? item.label
  const navNumber = (item: { id: string }) => nav().findIndex((entry) => entry.id === item.id) + 1
  // One nav item, in the sidebar or the phone menu. In Design mode a hidden item shows dimmed with
  // its eye crossed out, and the label it is renaming becomes a field.
  const navItem = (item: NavItemView, index: () => number) => {
    const external = item.external
    const hidden = () => !navEntry(item.id)?.visible
    const editing = () => designMode() && navEditing() === item.id
    // The label itself becomes editable, so the row keeps its trimmed height while it is renamed.
    // Typing changes the text Solid owns, so its original nodes go back before the store updates.
    const original: { nodes: Node[]; text: string[] } = { nodes: [], text: [] }
    const done = (label: HTMLElement, save: boolean) => {
      if (navEditing() !== item.id) return
      const text = label.textContent ?? ""
      window.getSelection()?.removeAllRanges()
      if (original.nodes.length > 0) label.replaceChildren(...original.nodes)
      original.nodes.forEach((node, index) => {
        if (node instanceof Text) node.data = original.text[index]
      })
      original.nodes = []
      setNavEditing(undefined)
      // Saved labels are English (navSavedLabel), so a rename in another language isn't kept.
      if (save && (language.locale() === "en" || item.id.startsWith("custom-"))) setNavLabel(item.id, text, item.label)
    }
    return (
      <>
        <Show when={groupStart(index())}>
          <li data-slot="group" aria-hidden="true">
            Anomaly
          </li>
        </Show>
        <li data-nav-id={item.id} data-nav-hidden={hidden() ? "" : undefined}>
          <a
            href={editing() ? undefined : item.href}
            target={external ? "_blank" : undefined}
            // Products swaps in place (client-side), so the page around it doesn't reload or jump.
            link={item.id === "products" ? true : undefined}
            aria-current={current(item.href) ? "page" : undefined}
          >
            <span data-slot="index" aria-hidden="true">
              [
              <Show when={navNumber(item) > 0 && navNumber(item) < 10}>
                <span data-slot="pad">0</span>
              </Show>
              <span data-slot="number" data-n={navNumber(item) || "–"} />]
            </span>
            <span
              data-slot="label"
              data-editing={editing() ? "" : undefined}
              contenteditable={editing() ? "plaintext-only" : undefined}
              role={editing() ? "textbox" : undefined}
              aria-label={editing() ? `Rename ${navLabel(item)}` : undefined}
              spellcheck={editing() ? false : undefined}
              onFocus={(event) => {
                if (!editing() || original.nodes.length > 0) return
                original.nodes = [...event.currentTarget.childNodes]
                original.text = original.nodes.map((node) => (node instanceof Text ? node.data : ""))
              }}
              // Bound on the label itself (not delegated), so its Escape stops here and Design mode stays on.
              on:keydown={(event: KeyboardEvent & { currentTarget: HTMLElement }) => {
                if (!editing()) return
                if (event.key === "Enter") {
                  event.preventDefault()
                  done(event.currentTarget, true)
                }
                if (event.key === "Escape") {
                  // Only the rename ends; Design mode stays on.
                  event.preventDefault()
                  event.stopPropagation()
                  done(event.currentTarget, false)
                }
              }}
              onBlur={(event) => done(event.currentTarget, true)}
            >
              {navLabel(item)}
            </span>
            {/* Shows a renamed label before the settings load (navConfigRules). */}
            <span data-slot="label-preload" aria-hidden="true" />
            <Show when={item.arrow}>
              <ExternalArrow />
            </Show>
            <Show when={external}>
              <NewTab />
            </Show>
          </a>
          <Show when={designMode()}>
            <button
              type="button"
              data-slot="nav-visibility"
              aria-pressed={!hidden() ? "true" : "false"}
              aria-label={`${hidden() ? "Show" : "Hide"} ${navLabel(item)}`}
              onClick={() => setNavVisible(item.id, hidden())}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M1.5 8C3 5 5.3 3.5 8 3.5S13 5 14.5 8C13 11 10.7 12.5 8 12.5S3 11 1.5 8Z" />
                <circle cx="8" cy="8" r="2" />
                <Show when={hidden()}>
                  <path d="M2.5 13.5L13.5 2.5" />
                </Show>
              </svg>
            </button>
            <button
              type="button"
              data-slot="nav-remove"
              aria-label={`Delete ${navLabel(item)} from the nav`}
              onClick={() => removeNavItem(item.id)}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M2 2L8 8M8 2L2 8" />
              </svg>
            </button>
          </Show>
        </li>
      </>
    )
  }
  // Grouped nav: the first of Anomaly's products starts the group, under its label.
  const groupStart = (index: number) =>
    siteSettings.navGroups === "grouped" &&
    navAll()[index]?.company &&
    !navAll()[index - 1]?.company &&
    nav().some((item) => item.company)
  // Settings › Footer links: "community" drops X and turns Discord into "Community", in both footers.
  const footerLinks = <T extends { label: string; href: string }>(items: readonly T[]) =>
    items
      .filter((item) => siteSettings.footerLinks === "classic" || !("social" in item))
      .map((item) =>
        siteSettings.footerLinks === "community" && "community" in item
          ? { ...item, label: String(item.community), external: true, arrow: true }
          : item,
      )
  const secondary = () => footerLinks(links().secondary)

  // Compare without the language prefix, so "/product", "/de/product" and a German visitor on an
  // unprefixed URL all match the Product item. Links to other sites are never current.
  const current = (href: string) => {
    const url = new URL(href, "https://opencode.ai")
    if (url.origin !== "https://opencode.ai") return false
    const path = strip(url.pathname)
    const here = strip(location.pathname)
    return here === path || (path !== "/" && here.startsWith(`${path}/`))
  }

  // From the footer's switch, leaving the Markdown view lands at the page's end, where the footer
  // shows the same controls the Markdown view pins in that spot, so they stay put under the pointer.
  const toggleMarkdown = (fromFooter = false) => {
    const next = !markdown()
    if (next && !markdownPages())
      return void loadMarkdown().then(
        () => !markdown() && toggleMarkdown(fromFooter),
        () => undefined,
      )
    setSwapped(true)
    setMarkdown(next)
    if (next) sessionStorage.setItem(markdownKey, "1")
    if (!next) sessionStorage.removeItem(markdownKey)
    window.scrollTo({ top: !next && fromFooter ? document.documentElement.scrollHeight : 0 })
  }

  // Brand assets for the logo's context menu follow the visible theme.
  const assets = () =>
    dark()
      ? { logo: logoDark, wordmark: wordmarkDark, suffix: "dark" as const }
      : { logo: logoLight, wordmark: wordmarkLight, suffix: "light" as const }

  // A page's own nav (the docs nav) scrolls in its own box under the fixed logo and lockup. It holds
  // the wheel only while it has something to scroll (data-scrolls, site.css), fades out at an edge
  // only while items pass under it (data-fade-top, data-fade-bottom), and starts with the current
  // page in view.
  onMount(() => {
    if (!props.nav) return
    const nav = document.querySelector<HTMLElement>('[data-component="sidebar"] > [data-component="section-nav"]')
    if (!nav) return
    const update = () => {
      nav.toggleAttribute("data-scrolls", nav.scrollHeight > nav.clientHeight)
      nav.toggleAttribute("data-fade-top", nav.scrollTop > 0)
      nav.toggleAttribute("data-fade-bottom", nav.scrollTop + nav.clientHeight < nav.scrollHeight - 1)
    }
    const current = nav.querySelector<HTMLElement>('[aria-current="page"]')
    if (current && current.offsetTop + current.offsetHeight > nav.clientHeight)
      nav.scrollTop = current.offsetTop - nav.clientHeight / 2
    const resize = new ResizeObserver(update)
    ;[nav, ...nav.children].forEach((element) => resize.observe(element))
    nav.addEventListener("scroll", update, { passive: true })
    update()
    onCleanup(() => {
      resize.disconnect()
      nav.removeEventListener("scroll", update)
    })
  })

  // Dark plates, videos and banners scroll under the fixed marks (the GitHub mark, the product pages'
  // previous/next chevrons and, on bare pages like /font, the logo): each switches to the artwork
  // for what is behind it (surface.ts, github-link.css).
  onMount(() => {
    onCleanup(
      watchSurfaces(() => [
        ...document.querySelectorAll<HTMLElement>(
          '[data-component="github-link"], [data-component="product-cycle"], [data-component="bare-chrome"] > [data-slot="logo"]',
        ),
      ]),
    )
  })

  onMount(() => {
    // Hydration keeps the server's attributes (theme "system"), so the toggle would show the wrong
    // option. Flip the signal away and back so every theme binding re-applies the saved value; the
    // second set waits a microtask, or the batched updates cancel out and nothing re-renders.
    const saved = theme()
    setTheme(saved === "system" ? "light" : "system")
    queueMicrotask(() => setTheme(saved))
    loadSiteSettings()
    // The settings store now drives the same rules, so the pre-paint copy can go.
    document.getElementById("site-settings-preload")?.remove()
    // The saved settings apply in a microtask; once they have, fade in what the pre-paint script hid.
    queueMicrotask(() =>
      document.querySelectorAll<HTMLElement>("[data-settling]").forEach((element) => {
        element.removeAttribute("data-settling")
        element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" })
      }),
    )
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const syncDark = () => setDark(theme() === "dark" || (theme() === "system" && media.matches))
    syncDark()
    media.addEventListener("change", syncDark)

    // Number keys 1-n open the matching nav item, unless the user is typing or using a shortcut.
    const navigateWithNumber = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return
      // 0 is always the home page, also on pages whose own nav replaces the numbered one.
      const item =
        event.key === "0" ? { href: language.route("/") } : props.nav ? undefined : nav()[Number(event.key) - 1]
      if (!item) return
      event.preventDefault()
      // A shortcut is not keyboard navigation through the page: drop focus so no ring is left behind.
      ;(document.activeElement as HTMLElement | null)?.blur()
      if ("external" in item && item.external) {
        window.open(item.href, "_blank", "noopener")
        return
      }
      if (clientPage(new URL(item.href, window.location.origin).pathname)) return navigate(item.href)
      window.location.assign(item.href)
    }

    // The app's router only handles links marked with a `link` attribute (explicitLinks), so the
    // older console pages and proxied paths like /docs keep full page loads. Links between pages
    // of this site get the attribute as soon as a pointer, focus or click reaches them, so the
    // router swaps the page in place and preloads it on intent: hover, focus or touch. Touch screens,
    // which have no hover, also preload the pages their links lead to as the links come into view.
    const markLink = (event: Event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]")
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("link") || anchor.target) return
      const url = new URL(anchor.href)
      if (url.origin === window.location.origin && clientPage(url.pathname)) anchor.setAttribute("link", "")
    }
    for (const type of ["pointerover", "focusin", "touchstart", "click"])
      document.addEventListener(type, markLink, true)
    const stopPreloads = preloadVisibleLinks(
      (link) => link.hasAttribute("link") || clientPage(new URL(link.href).pathname),
      (path) => preloadRoute(path, { preloadData: false }),
    )

    const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1500))
    // window.opencode and its greeting for developers who open DevTools (Settings › Other › Console API).
    createEffect(() => {
      if (siteSettings.consoleApi === "off") return void delete (window as { opencode?: unknown }).opencode
      // Checked again when idle: saved settings load in a microtask after this first run.
      idle(() => siteSettings.consoleApi === "on" && void import("~/lib/console-api").then((api) => api.install()))
    })
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (settings()) settingsReturn?.focus()
      setSettings(false)
      if (logoMenu()) {
        document.querySelector<HTMLElement>(`[data-component="${logoMenu()?.owner}"] [data-slot="logo"]`)?.focus()
        setLogoMenu(undefined)
      }
      if (menu()) {
        setMenu(false)
        menuToggle?.focus()
      }
      setSectionNav(false)
    }
    const closeLogoMenu = (event: MouseEvent) => {
      if (
        (event.target as Element).closest(
          '[data-component="logo-menu"], [data-component="asset-menu"], [data-component="logo-fan"], [data-slot="logo"]',
        )
      )
        return
      setLogoMenu(undefined)
    }
    // One highlighted row per menu: keyboard focus follows the pointer into another row, so a
    // focused row and a hovered row never show at once (site.css's shared menu rows).
    const focusHoveredRow = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return
      const row = (event.target as Element).closest<HTMLElement>(
        '[data-component="site-menu"] [data-slot="menu"] > *, [data-component="language-picker"] [data-slot="item"], [data-component="logo-menu"] a, [data-component="docs-lockup"] [role="menuitem"]',
      )
      const popup = row?.closest('[data-slot="menu"], [data-slot="dropdown"]')
      if (!row || !popup?.contains(document.activeElement) || document.activeElement === row) return
      row.focus({ preventScroll: true })
    }
    // The menu belongs to the small-screen header, so it closes once the sidebar is back.
    const wide = window.matchMedia("(min-width: 60.0625rem)")
    const closeMenus = () => {
      setMenu(false)
      setSectionNav(false)
    }
    // Typing "m" then "d" toggles the Markdown view.
    let lastKey = { key: "", time: 0 }
    const markdownShortcut = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return
      const key = event.key.toLowerCase()
      if (key === "m") prefetchMarkdown()
      const quick = lastKey.key === "m" && event.timeStamp - lastKey.time < 600
      lastKey = { key, time: event.timeStamp }
      if (key !== "d" || !quick) return
      lastKey = { key: "", time: 0 }
      // The funnel's queue (lib/funnel.ts), as the switch reports its own clicks.
      window.__ocFunnel?.push({
        event: {
          name: "ui.clicked",
          action: "clicked",
          target: `markdown-view:${markdown() ? "off" : "on"}`,
          properties: { via: "shortcut" },
        },
        at: performance.now(),
      })
      toggleMarkdown()
    }
    // The pre-paint script hid the page while it waited for the Markdown view, whose code it started
    // loading (entry-server.tsx).
    const booted = () => delete document.querySelector<HTMLElement>("[data-site]")?.dataset.markdownBoot
    const restore = sessionStorage.getItem(markdownKey) === "1"
    if (!restore || markdownPages()) {
      setMarkdown(restore)
      booted()
    }
    if (restore && !markdownPages())
      loadMarkdown()
        .then(() => setMarkdown(true), () => undefined)
        .finally(booted)

    document.addEventListener("keydown", navigateWithNumber)
    document.addEventListener("keydown", markdownShortcut)
    document.addEventListener("keydown", closeOnEscape)
    document.addEventListener("click", closeLogoMenu)
    document.addEventListener("contextmenu", closeLogoMenu)
    document.addEventListener("pointerover", focusHoveredRow)
    wide.addEventListener("change", closeMenus)
    const stopMenuLinks = closeMenusOnLinks()

    onCleanup(() => {
      stopMenuLinks()
      stopPreloads()
      for (const type of ["pointerover", "focusin", "touchstart", "click"])
        document.removeEventListener(type, markLink, true)
      media.removeEventListener("change", syncDark)
      document.removeEventListener("keydown", navigateWithNumber)
      document.removeEventListener("keydown", markdownShortcut)
      document.removeEventListener("keydown", closeOnEscape)
      document.removeEventListener("click", closeLogoMenu)
      document.removeEventListener("contextmenu", closeLogoMenu)
      document.removeEventListener("pointerover", focusHoveredRow)
      wide.removeEventListener("change", closeMenus)
      document.documentElement.style.removeProperty("overflow")
    })
  })

  // The fixed sidebar nav fades out once the footer's own list scrolls up into its space, so the two
  // never overlap; it comes back as the footer leaves. Footer columns keep the sidebar column empty.
  createEffect(() => {
    const list = siteSettings.footerLayout === "list"
    let observer: IntersectionObserver | undefined
    const watch = () => {
      observer?.disconnect()
      setNavAway(false)
      if (!list || !sidebarNav || !footerNav) return
      const clear = window.innerHeight - sidebarNav.getBoundingClientRect().bottom - 24
      observer = new IntersectionObserver(([entry]) => setNavAway(entry.isIntersecting), {
        rootMargin: `0px 0px ${-Math.max(0, clear)}px 0px`,
      })
      observer.observe(footerNav)
    }
    watch()
    window.addEventListener("resize", watch)
    onCleanup(() => {
      observer?.disconnect()
      window.removeEventListener("resize", watch)
    })
  })

  // Any navigation (another page, its query or a hash) closes every open menu (menu-open.ts).
  // A page swapped in place has no page load for screen readers to announce, so focus moves to its
  // title (or the content when it has none) without scrolling. The first page load keeps focus. A
  // link chosen in a menu that only changes the query (a docs section) moves focus there too, and
  // one that jumps on the page focuses its target, rather than leaving focus on the menu's trigger.
  createEffect(
    on(
      () => [location.pathname, location.search, location.hash] as const,
      (now, previous) => {
        const menuNavigation = takeMenuNavigation()
        if (previous) closeAllMenus()
        if (previous === undefined && !routed) return
        const samePage = previous && now[0] === previous[0]
        if (samePage && !menuNavigation) return
        if (samePage && now[1] === previous[1] && now[2] === previous[2]) return
        requestAnimationFrame(() => {
          const jump =
            samePage && now[1] === previous[1] && now[2]
              ? document.getElementById(decodeURIComponent(now[2].slice(1)))
              : null
          const target = jump || (!markdown() && page.querySelector<HTMLElement>("h1")) || content
          if (!target || target.contains(document.activeElement)) return
          if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1")
          target.focus({ preventScroll: true })
        })
      },
    ),
  )

  // Lock the page behind the open menu so a swipe on the menu never scrolls the page.
  createEffect(() => {
    if (isServer) return
    if (menu()) {
      document.documentElement.style.overflow = "hidden"
      return
    }
    document.documentElement.style.removeProperty("overflow")
  })

  const openLogoMenu = (event: MouseEvent & { currentTarget: HTMLElement }, owner: "sidebar" | "topbar") => {
    event.preventDefault()
    const logo = event.currentTarget
    // The menu key or Shift+F10 report no pointer position.
    const keyboard = event.button === 0 && event.clientX === 0 && event.clientY === 0
    if (siteSettings.logoMenu === "fan" && !logoFan())
      return void loadLogoFan().then(
        () => showLogoMenu(logo, owner, keyboard),
        () => (logoFanLoad = undefined),
      )
    showLogoMenu(logo, owner, keyboard)
  }

  const showLogoMenu = (logo: HTMLElement, owner: "sidebar" | "topbar", keyboard: boolean) => {
    // Always open directly under the logo, wherever the click landed. The menu sits in the same
    // header as the logo, so it stays attached when that header scrolls or sticks.
    setMenu(false)
    setLogoMenu({ owner, x: logo.offsetLeft, y: logo.offsetTop + logo.offsetHeight + 8 })
    alignLogoMenu(logo)
    // Move focus into the menu when it was opened from the keyboard; a right-click leaves focus
    // where it was.
    if (keyboard)
      document
        .querySelector<HTMLElement>(
          ':is([data-component="logo-menu"], [data-component="asset-menu"], [data-component="logo-fan"]) [role="menuitem"]',
        )
        ?.focus()
  }

  // Line the menu's first thumbnail (or icon) up under the centre of the logo, then keep the menu
  // at least 8px from the window's left edge. Layout offsets are used, so the opening animation's
  // transforms never skew the measurement.
  const alignLogoMenu = (logo: HTMLElement) => {
    const position = logoMenu()
    // The menu renders in the same header as the logo (the sidebar, the top bar or a page's own
    // chrome, as on /font), so look for it from the logo outwards.
    const find = (element: HTMLElement | null): HTMLElement | null =>
      !element
        ? null
        : (element.querySelector<HTMLElement>(
            ':is([data-component="logo-menu"], [data-component="asset-menu"], [data-component="logo-fan"]):not([data-closing])',
          ) ?? find(element.parentElement))
    const menu = find(logo.parentElement)
    const thumb = menu?.querySelector<HTMLElement>(
      '[role="menuitem"] :is([data-slot="thumb"], [data-slot="variant"], [data-slot="icon"], svg)',
    )
    if (!position || !menu || !thumb) return
    const offset = (element: HTMLElement): number =>
      element === menu || !element.offsetParent ? 0 : element.offsetLeft + offset(element.offsetParent as HTMLElement)
    const item = thumb.closest<HTMLElement>('[role="menuitem"]') ?? thumb
    const menuLeft = menu.getBoundingClientRect().left
    const mark = (logo.querySelector("svg") ?? logo).getBoundingClientRect()
    const centre = mark.left + mark.width / 2
    const shift = Math.max(centre - (menuLeft + offset(thumb) + thumb.offsetWidth / 2), 8 - (menuLeft + offset(item)))
    setLogoMenu({ ...position, x: position.x + shift, origin: centre - menuLeft - shift })
  }

  // Up and down arrows move between the logo menu items, wrapping at the ends.
  const logoMenuKeys = (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const index = items.indexOf(document.activeElement as HTMLElement)
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus()
  }

  // The files the logo menus offer: the transparent ones (shown as the default logo and wordmark;
  // on a plain background they look the same as the standard files, which stay in the zip and on
  // the Brand page) and the solid ones (shown as "simple").
  const logoMenuFiles = (["transparent", "solid"] as const).flatMap((style) =>
    (["logo", "wordmark"] as const).map((kind) => ({
      style,
      kind,
      // The transparent files are the default logos; the solid ones are labelled "simple".
      name: i18n.t(`site.logoMenu.${kind}${style === "solid" ? "Simple" : ""}`),
    })),
  )

  // The cards option: a square preview of each asset, springing open under the logo.
  const assetCards = (position: { x: number; y: number; origin?: number }) => (
    <div
      data-component="asset-menu"
      role="menu"
      aria-label={i18n.t("nav.context.brandAssets")}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        "transform-origin": position.origin === undefined ? undefined : `${position.origin}px 0`,
      }}
      onKeyDown={logoMenuKeys}
      onClick={(event) => {
        if ((event.target as Element).closest('[role="menuitem"]')) setLogoMenu(undefined)
      }}
    >
      {/* The default (transparent) and simple (solid) files for the current theme. */}
      <For each={logoMenuFiles}>
        {(file, index) => (
          <a
            role="menuitem"
            href={logoVariantSvgs[file.style][file.kind][assets().suffix]}
            download={`opencode-${file.kind}-${file.style}-${assets().suffix}.svg`}
            style={{ "--i": index() }}
          >
            <span data-slot="thumb" data-kind={file.kind} data-style={file.style} data-tone={assets().suffix}>
              <img src={logoVariantSvgs[file.style][file.kind][assets().suffix]} alt="" />
            </span>
            <span data-slot="name">{file.name}</span>
            <span data-slot="meta">SVG</span>
          </a>
        )}
      </For>
      <A role="menuitem" href={language.route("/brand")} style={{ "--i": 4 }}>
        <span data-slot="thumb" data-kind="guide" aria-hidden="true">
          <span data-slot="page">
            <LogoIcon />
            <i />
            <i />
            <i data-short />
            <b>
              <i />
              <i />
              <i />
            </b>
          </span>
        </span>
        <span data-slot="name">{i18n.t("legal.brand")}</span>
        <span data-slot="meta">{i18n.t("site.logoMenu.page")}</span>
      </A>
      <a role="menuitem" href={brandAssets} download="opencode-brand-assets.zip" style={{ "--i": 5 }}>
        <span data-slot="thumb" data-kind="zip" aria-hidden="true">
          <span data-slot="archive">
            <i />
            <span>ZIP</span>
          </span>
        </span>
        <span data-slot="name">{i18n.t("nav.context.brandAssets")}</span>
        <span data-slot="meta">ZIP</span>
      </a>
    </div>
  )

  const logoMenuView = (owner: "sidebar" | "topbar") => (
    <Show
      when={siteSettings.logoMenu !== "fan" && logoMenu()?.owner === owner && logoMenu()}
      fallback={
        <Show when={siteSettings.logoMenu === "fan" && logoFan()}>
          {(fan) => (
            <Dynamic
              component={fan()}
              position={logoMenu()?.owner === owner ? logoMenu() : undefined}
              onSelect={() => setLogoMenu(undefined)}
            />
          )}
        </Show>
      }
    >
      {(position) => (
        <Show when={siteSettings.logoMenu === "list"} fallback={assetCards(position())}>
          <div
            data-component="logo-menu"
            data-slot="menu"
            role="menu"
            aria-label={i18n.t("nav.context.brandAssets")}
            style={{
              left: `${position().x}px`,
              top: `${position().y}px`,
              "transform-origin": position().origin === undefined ? undefined : `${position().origin}px 0`,
            }}
            onKeyDown={logoMenuKeys}
            onClick={(event) => {
              if ((event.target as Element).closest('[role="menuitem"]')) setLogoMenu(undefined)
            }}
          >
            <For each={logoMenuFiles}>
              {(file) => (
                <a
                  role="menuitem"
                  href={logoVariantSvgs[file.style][file.kind][assets().suffix]}
                  download={`opencode-${file.kind}-${file.style}-${assets().suffix}.svg`}
                >
                  <Show when={file.kind === "logo"} fallback={<MenuIcon name="wordmark" />}>
                    <span
                      data-slot="variant"
                      style={{ "mask-image": `url(${logoVariantSvgs[file.style].logo.light})` }}
                    />
                  </Show>
                  {file.name}
                </a>
              )}
            </For>
            <A role="menuitem" href={language.route("/brand")}>
              <MenuIcon name="brand" />
              {i18n.t("legal.brand")}
            </A>
            <A role="menuitem" href={language.route("/press")}>
              <MenuIcon name="press" />
              {i18n.t("site.footer.press")}
            </A>
            <a role="menuitem" href={brandAssets} download="opencode-brand-assets.zip">
              <MenuIcon name="press" />
              {i18n.t("site.logoMenu.zip")}
            </a>
          </div>
        </Show>
      )}
    </Show>
  )

  // The repo, as a GitHub mark: fixed in the top-right corner beside the sidebar (and at every
  // width on bare pages), in the top bar on small screens.
  const githubLink = (owner: "corner" | "topbar") => <GitHubLink owner={owner} />

  const logoLink = (owner: "sidebar" | "topbar") => (
    <A
      href={language.route("/")}
      data-slot="logo"
      data-variant={logoVariant()}
      data-design="logoScale logoMenu logoMenuItem logoMenuHover pressIcon"
      aria-label={i18n.t("nav.logoAlt")}
      title={i18n.t("nav.home")}
      onContextMenu={(event) => openLogoMenu(event, owner)}
      onPointerEnter={prefetchLogoFan}
      onFocus={prefetchLogoFan}
      onClick={() => {
        setMenu(false)
        setLogoMenu(undefined)
        // The logo always leads to the real home page, so it leaves the Markdown view.
        if (markdown()) toggleMarkdown()
      }}
    >
      <Show when={logoVariant() === "icon"} fallback={<Logo />}>
        <LogoIcon />
      </Show>
    </A>
  )

  const chooseTheme = (value: (typeof themes)[number]) => {
    setTheme(value)
    localStorage.setItem("opencode-theme", value)
    setDark(value === "dark" || (value === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches))
  }

  // The footer list and the footer columns' bottom bar both show these.
  const themeControls = () => (
    <Show
      when={siteSettings.themeSwitcherStyle === "cycle"}
      fallback={<ThemeToggle theme={theme()} onChange={chooseTheme} />}
    >
      <div
        ref={snapToPixels}
        data-component="theme-toggle"
        data-variant="cycle"
        data-design="themeSwitcherStyle"
        role="group"
        aria-label={i18n.t("site.theme.andView")}
      >
        <ThemeCycle theme={theme()} onChange={chooseTheme} />
        {/* Bare pages (the font page) have no Markdown version, so they show only the theme. */}
        <Show when={!props.bare}>
          <Show
            when={props.markdown?.href}
            fallback={
              <button
                type="button"
                aria-label={markdown() ? i18n.t("site.view.person") : i18n.t("site.view.markdown")}
                aria-pressed={markdown() ? "true" : "false"}
                data-funnel={markdown() ? "markdown-view:off" : "markdown-view:on"}
                onPointerEnter={prefetchMarkdown}
                onFocus={prefetchMarkdown}
                onClick={(event) => toggleMarkdown(!!event.currentTarget.closest('[data-component="site-footer"]'))}
              >
                {/* In the Markdown view the button offers the way back: a person instead of the robot. */}
                <Show when={markdown()} fallback={<AgentIcon />}>
                  <PersonIcon />
                </Show>
              </button>
            }
          >
            {(href) => (
              // A real link to the page's Markdown, so middle-click and "Open in new tab" still work.
              <a
                href={href()}
                aria-label={markdown() ? i18n.t("site.view.person") : i18n.t("site.view.markdown")}
                data-active={markdown() ? "" : undefined}
                data-funnel={markdown() ? "markdown-view:off" : "markdown-view:on"}
                onPointerEnter={prefetchMarkdown}
                onFocus={prefetchMarkdown}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  toggleMarkdown(!!event.currentTarget.closest('[data-component="site-footer"]'))
                }}
              >
                <Show when={markdown()} fallback={<AgentIcon />}>
                  <PersonIcon />
                </Show>
              </a>
            )}
          </Show>
        </Show>
      </div>
    </Show>
  )
  const copyright = () => (
    <span data-slot="copyright">
      <bdi dir="ltr">
        ©{new Date().getFullYear()}{" "}
        <a href="https://anoma.ly" aria-label="Anomaly">
          <Show when={siteSettings.copyrightMark === "logo"} fallback="Anomaly">
            <AnomalyLogo />
          </Show>
        </a>
      </bdi>
    </span>
  )
  const statusLink = () => (
    // Its own boundary, so a page change (and a card growing into a product page) does not wait
    // for the status API.
    <Suspense>
      <a
        href="https://status.opencode.ai"
        target="_blank"
        rel="noopener"
        data-component="status"
        data-design="statusBars"
        data-state={statusView().current}
        title={i18n.t(statusHeadline[statusView().current])}
      >
        <span data-slot="bars" aria-hidden="true">
          <For each={statusView().bars}>{(bar) => <span data-state={bar} />}</For>
        </span>
        <span data-slot="status-label">
          <span data-slot="sr-only">{i18n.t("site.status.prefix")}</span>
          <Show when={statusView().current === "operational"} fallback={i18n.t(statusLabel[statusView().current])}>
            <span data-design-copy="footer.status.ok">
              {designCopy("footer.status.ok", i18n.t(statusLabel.operational))}
            </span>
          </Show>
        </span>
        <ExternalArrow />
        <NewTab />
      </a>
    </Suspense>
  )

  return (
    <div
      ref={(el) =>
        createEffect(() => {
          if (!voiceReady()) return
          if (siteSettings.voiceOrb === "always") return adoptVoice(el)
          dropVoice()
        })
      }
      data-site
      data-page={props.page}
      data-theme={theme()}
      data-popover={popoverTheme()}
      data-letters-bar={lettersBarShown() && lettersBarInView() ? "" : undefined}
      data-letters-end={lettersBottom() ? "" : undefined}
      data-spacer={props.page === "home" || props.page === "product" ? siteSettings.spacer : undefined}
      data-logo={logoVariant()}
      data-hero-install={props.page === "home" ? siteSettings.heroInstall : undefined}
      data-home-announcement={props.page === "home" ? siteSettings.homeAnnouncement : undefined}
      data-banner-host
      data-banner={bannerVisible() ? "" : undefined}
      style={{
        "font-weight": siteSettings.bodyWeight,
        "--selection-alpha": `${siteSettings.selectionOpacity}%`,
        "--hero-scale": siteSettings.heroSize / 100,
        "--mono-choice": monoFontChoice(siteSettings.monoFont),
      }}
      data-selection={siteSettings.selection === "muted blue" ? "muted" : undefined}
      data-blue={siteSettings.linkBlue === "console" ? undefined : siteSettings.linkBlue}
      data-dark-blue={siteSettings.darkBlue === "4f8bff" ? undefined : siteSettings.darkBlue}
      data-logo-size={siteSettings.logoScale === "current" ? undefined : siteSettings.logoScale}
      data-menu-active={siteSettings.menuActive.replace(" ", "-")}
      data-menu-color={siteSettings.menuColor}
      data-button-hover={siteSettings.buttonHover === "ring" ? undefined : siteSettings.buttonHover.replace(" + ", "-")}
      data-menu-align={siteSettings.menuAlign === "edge" ? "edge" : undefined}
      data-wide-align={siteSettings.wideAlign === "left" ? "left" : undefined}
      data-product-badges={siteSettings.productBadges === "show" ? "show" : undefined}
      data-nav-numbers={siteSettings.navNumbers === "1" ? "1" : undefined}
      data-docs-nav={siteSettings.docsNav}
      data-section-menu={siteSettings.sectionMenuStyle}
      data-docs-fixed={props.docsVariants ? "" : undefined}
      data-docs-variants={
        props.docsVariants ??
        (Object.entries(siteSettings.docsVariants)
          .filter((entry) => entry[1] !== "1")
          .map((entry) => `${entry[0]}-${entry[1]}`)
          .join(" ") ||
          undefined)
      }
      data-status-bars={siteSettings.statusBars}
      data-logo-menu-hover={siteSettings.logoMenuHover}
      data-light-bg={siteSettings.lightBackground === "#ffffff" ? undefined : siteSettings.lightBackground.slice(1)}
      data-sidebar={siteSettings.sidebar === "fifth column" ? "column" : undefined}
      data-layout={props.aside ? "docs" : undefined}
      data-bare={props.bare ? "" : undefined}
      data-markdown={markdown() ? "" : undefined}
      data-swapped={swapped() ? "" : undefined}
    >
      {/* The "dot gradient" spacer's stops and the "dither gradient" pattern, from their settings. The pre-paint script writes the saved
          ones one step more specific until the store takes over. */}
      <style
        innerHTML={
          (siteSettings.spacer === "dot gradient" ? spacerGradientRule(siteSettings, "") : "") +
          (siteSettings.spacer === "dither gradient" ? ditherGradientRule(siteSettings, "") : "")
        }
      />
      {/* A plain style element, which hydration keeps: the meta <Style> is inserted again on
          hydration, and the new faces then miss font-display: optional's window, so the page
          swaps to the fallback font and reflows. */}
      <style innerHTML={interFaces} />
      {/* Fetched with the page, so Inter is ready for the first paint instead of arriving inside
          font-display: optional's short wait and reflowing the text (CLS). Only the Latin file:
          most pages need nothing else. */}
      <Link rel="preload" href={interLatin} as="font" type="font/woff2" crossorigin="anonymous" />
      {/* OpenTUI Mono's regular Latin file, the monospace text above the fold (the nav, the hero title,
          card titles): fetched with the page, so it paints in OpenTUI Mono instead of swapping to it
          (which, with the size-matched stand-ins, is a change of letter shapes only). The other files
          load when text needs them. */}
      <Link rel="preload" href={monoFontLatin} as="font" type="font/woff2" crossorigin="anonymous" />
      {/* Browser bar colour and form controls follow the site's theme. Both theme-color tags keep
          their media query; an explicit theme, or the open banner at the top, gives them the same
          colour. The scripts below set them before first paint. Safari 26 and later ignores
          theme-color and tints from the page itself: the sticky top bar's background, or the page
          behind the status bar (the banner, while it is at the top). */}
      {/* Home Screen web app: the status bar stays opaque above the page in the system's light or
          dark colour, so its text always reads ("black-translucent" draws white text over the page). */}
      <Meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <LiveMeta name="theme-color" media="(prefers-color-scheme: light)" content={themeColor("light")} />
      <LiveMeta name="theme-color" media="(prefers-color-scheme: dark)" content={themeColor("dark")} />
      <LiveMeta name="color-scheme" content={colorScheme()} />

      {/* Runs while the page is parsed, before first paint: apply the saved settings (development
          only) and the saved theme, so a full page load never flashes the defaults or the system
          theme first. The theme script also sets the theme-color and color-scheme tags. */}
      {import.meta.env.DEV && <script innerHTML={preloadSettings} />}
      {/* After the settings: closes the banner again before first paint if its message was dismissed. */}
      <script innerHTML={bannerDismissScript} />
      <script innerHTML={themeScript(import.meta.env.DEV)} />
      {/* Card stills and product hero posters fade in as soon as their image loads, long before the
          page's code has loaded: load events reach a capturing listener on the document (added once,
          though the script runs again when a client navigation renders it). One already decoded when
          it first paints (preloaded, or cached) is marked data-instant and shows at once instead: a
          check each frame, before paint, while the page loads. */}
      <script
        innerHTML={`if(!document.posterLoads){document.posterLoads=1;document.addEventListener("load",(e)=>{const t=e.target;if(t instanceof HTMLImageElement&&t.hasAttribute("data-poster"))t.setAttribute("data-loaded","")},true);const scan=()=>{document.querySelectorAll("img[data-poster]:not([data-seen])").forEach((i)=>{i.setAttribute("data-seen","");if(i.complete&&i.naturalWidth){i.setAttribute("data-instant","");i.setAttribute("data-loaded","")}});if(document.readyState!=="complete")requestAnimationFrame(scan)};requestAnimationFrame(scan)}`}
      />
      <script type="speculationrules" innerHTML={speculationRules} />
      <Show when={props.markdown?.href}>{(href) => <Link rel="alternate" type="text/markdown" href={href()} />}</Show>
      {/* Hidden until it has keyboard focus. It moves focus itself, before the router sees the click.
          First in the page, before the banner's link, so it is the first Tab stop. */}
      <a
        href="#content"
        data-component="skip-link"
        on:click={(event) => {
          event.preventDefault()
          content?.focus()
        }}
      >
        {i18n.t("site.skipToContent")}
      </a>
      {/* The announcement's "banner" style, above everything on every page (site-banner.tsx). */}
      <SiteBanner />
      <script innerHTML={bannerThemeColorScript} />
      {/* Hide the page before first paint when the Markdown view will replace it on mount. */}
      <script
        innerHTML={`(()=>{try{if(sessionStorage.getItem("${markdownKey}")==="1")document.currentScript.parentElement.dataset.markdownBoot=""}catch{}})()`}
      />
      {/* Marks that the page's code will run, so entrance reveals (reveal.css) wait unseen from first paint. */}
      <script innerHTML={`document.currentScript.parentElement.dataset.js=""`} />
      <Show when={props.bare}>
        <header data-component="bare-chrome">
          {logoLink("sidebar")}
          {logoMenuView("sidebar")}
          <div data-slot="bare-theme">{themeControls()}</div>
          {githubLink("corner")}
        </header>
      </Show>
      {/* Small screens: the logo and a menu button replace the sidebar. */}
      <Show when={!props.bare}>
        <header data-component="topbar">
          {logoLink("topbar")}
          {githubLink("topbar")}
          <MenuToggle
            ref={(element) => (menuToggle = element)}
            open={menu()}
            onToggle={() => {
              setLogoMenu(undefined)
              setMenu(!menu())
            }}
          />
          {logoMenuView("topbar")}
        </header>
        <MenuSheet open={menu()} onClose={() => setMenu(false)} listRef={sortableNav} sortable={designMode()}>
          <For each={navAll()}>{(item, index) => navItem(item, index)}</For>
        </MenuSheet>
      </Show>
      <LanguageSheet />

      {/* Behind the open menu sheet, the page and footer leave the tab order, so focus stays in the menu. */}
      <div data-slot="frame" inert={menu()}>
        {/* The site's banner beside the content. With a page nav (docs) it shows beside the phone
            bar on small screens too, so it is a sidebar there rather than a second banner. */}
        <Show when={!props.bare}>
          <Dynamic
            component={props.nav ? "aside" : "header"}
            aria-label={props.nav ? i18n.t("site.landmark.navigation") : undefined}
            data-component="sidebar"
            data-section-nav={props.nav ? "" : undefined}
          >
            {logoLink("sidebar")}
            {logoMenuView("sidebar")}

            <Show
              when={!props.nav}
              fallback={
                <div data-component="section-nav" data-open={sectionNav() ? "" : undefined}>
                  <button
                    type="button"
                    data-slot="section-toggle"
                    aria-expanded={sectionNav() ? "true" : "false"}
                    aria-controls="section-nav"
                    onClick={() => setSectionNav(!sectionNav())}
                  >
                    <span>{props.navLabel ?? i18n.t("site.menu")}</span>
                    <Chevron />
                  </button>
                  <div
                    data-slot="section-body"
                    id="section-nav"
                    onClick={(event) => {
                      if ((event.target as Element).closest("a")) setSectionNav(false)
                    }}
                  >
                    {props.nav}
                  </div>
                </div>
              }
            >
              <nav
                data-component="nav"
                data-design="navGroups navNumbers productNavDemo wideAlign monoFont"
                data-variant={navVariant()}
                data-away={navAway() ? "" : undefined}
                // Faded out, it leaves the tab order and the accessibility tree too.
                inert={navAway()}
                aria-label={i18n.t("site.landmark.primary")}
                ref={sidebarNav}
              >
                <ul ref={sortableNav} data-sortable={designMode() ? "" : undefined}>
                  <For each={navAll()}>{(item, index) => navItem(item, index)}</For>
                </ul>
                {/* Inside the nav, so Design mode's controls for the nav open below it. */}
                <Show when={designMode()}>
                  <NavVersions />
                </Show>
              </nav>
            </Show>
          </Dynamic>
        </Show>
        {/* After the nav in reading order; fixed in the top-right corner (site.css). */}
        <Show when={!props.bare}>{githubLink("corner")}</Show>

        <main data-component="content" id="content" tabIndex={-1} ref={content} data-enter={enter ? "" : undefined}>
          <div data-slot="page" ref={page}>
            {props.children}
          </div>
          {/* Pages without a hand-written Markdown version show their own content converted. */}
          <Show when={markdown() && markdownPages()}>
            {(pages) => (
              <Dynamic
                component={pages().MarkdownView}
                source={props.markdown?.source(pages()) ?? pages().domMarkdown(page)}
                file={
                  props.markdown?.href.split("/").pop() ?? `${strip(location.pathname).split("/").pop() || "index"}.md`
                }
                href={props.markdown?.href}
                home={language.route("/")}
                onHome={() => markdown() && toggleMarkdown()}
              />
            )}
          </Show>
        </main>

        {/* After the content, so it is read and tabbed to in the order it shows (grid-area places it). */}
        <Show when={props.aside}>
          <aside data-component="aside" aria-label={i18n.t("site.landmark.page")}>
            {props.aside}
          </aside>
        </Show>
      </div>

      <Show when={!props.bare}>
        <footer
          data-component="site-footer"
          inert={menu()}
          data-design="footerLayout footerLinks copyrightMark lightBackground"
          data-layout={siteSettings.footerLayout}
        >
          {/* With footer columns the sidebar column stays empty: the links move to the columns, and
            the copyright and controls to a bar beneath them. */}
          <Show when={siteSettings.footerLayout === "list"}>
            <div data-slot="secondary">
              <nav data-component="secondary-nav" aria-label={i18n.t("site.landmark.secondary")} ref={footerNav}>
                <ul>
                  <For each={secondary()}>
                    {(item) => (
                      <li>
                        <a
                          href={item.href}
                          target={"external" in item && item.external ? "_blank" : undefined}
                          aria-current={current(item.href) ? "page" : undefined}
                        >
                          <Bracket />
                          {item.label}
                          <Show when={"arrow" in item && item.arrow}>
                            <ExternalArrow />
                          </Show>
                          <Show when={"external" in item && item.external}>
                            <NewTab />
                          </Show>
                        </a>
                      </li>
                    )}
                  </For>
                  <li data-slot="language">
                    <Bracket />
                    <LanguagePicker />
                  </li>
                  <li>{statusLink()}</li>
                </ul>
              </nav>
              {/* Left out entirely when the switch is off, so the copyright follows the nav at one gap. */}
              <Show when={siteSettings.themeSwitcher === "on"}>
                <div data-slot="footer-controls">{themeControls()}</div>
              </Show>
              {copyright()}
            </div>
          </Show>
          <div data-slot="main">
            <Show when={siteSettings.footerLayout === "columns"}>
              <nav data-component="footer-columns" aria-label={i18n.t("site.landmark.footer")}>
                <For each={links().columns}>
                  {(column) => (
                    <div data-slot="column">
                      <h2>{column.title}</h2>
                      <ul>
                        <For each={footerLinks(column.links)}>
                          {(item) => (
                            <li>
                              <a
                                href={item.href}
                                target={"external" in item && item.external ? "_blank" : undefined}
                                aria-current={current(item.href) ? "page" : undefined}
                              >
                                {item.label}
                                <Show when={"arrow" in item && item.arrow}>
                                  <ExternalArrow />
                                </Show>
                                <Show when={"external" in item && item.external}>
                                  <NewTab />
                                </Show>
                              </a>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                  )}
                </For>
              </nav>
              <div data-slot="bar">
                {copyright()}
                <div data-slot="bar-controls">
                  {statusLink()}
                  <LanguagePicker align="right" />
                  <Show when={siteSettings.themeSwitcher === "on"}>{themeControls()}</Show>
                </div>
              </div>
            </Show>
            <div
              data-component="wordmark"
              data-hidden={siteSettings.footerWordmark === "off" ? "" : undefined}
              data-entrance={siteSettings.footerWordmarkAnimation === "off" ? undefined : ""}
              data-design="footerWordmarkAnimation footerWordmarkSpeed footerWordmarkPlay"
              ref={mark}
            >
              <Wordmark
                hatch={siteSettings.wordmarkHatch}
                nodes={siteSettings.wordmarkNodes === "on"}
                entrance={wordmarkEntrance()}
                speed={siteSettings.footerWordmarkSpeed}
                play={siteSettings.footerWordmarkPlay === "drag"}
                onOrder={setWordmarkNote}
              />
            </div>
          </div>
        </footer>
        {/* The "Like letters?" bar: at the very end of the page, so it pushes everything up. */}
        <Show when={siteSettings.footerWordmark === "on" && siteSettings.footerWordmarkPlay === "drag"}>
          <div
            data-component="letters-bar"
            data-shown={lettersBarShown() ? "" : undefined}
            inert={!lettersBarShown()}
            ref={watchLettersBar}
          >
            <div data-slot="clip">
              <div data-slot="slide">
                <a href={language.route("/font")} aria-label={i18n.t("footer.wordmark.fontLabel")}>
                  <span data-slot="highlight" aria-hidden="true">
                    {i18n.t("footer.wordmark.font")}
                  </span>{" "}
                  <span data-slot="body" aria-hidden="true">
                    {lettersBody()}
                    <ChevronRight />
                  </span>
                </a>
              </div>
            </div>
          </div>
        </Show>
      </Show>

      {DesignMode && DevicePreview && (
        // Their own boundary, so loading them never suspends the page.
        <Suspense>
          <DesignMode onSettings={toggleSettings} />
          <DevicePreview />
        </Suspense>
      )}
      <SiteSearch
        onToggleTheme={() => chooseTheme(dark() ? "light" : "dark")}
        onSettings={import.meta.env.DEV ? () => !settings() && toggleSettings() : undefined}
        onDesign={
          import.meta.env.DEV
            ? () => void import("./design-mode").then((module) => module.setDesignMode(!designMode()))
            : undefined
        }
        go={(href) => (clientPage(href) ? navigate(href) : window.location.assign(href))}
      />
      <Tooltips />

      {SettingsPanel && (
        <Show when={settings()}>
          {/* Loaded when first opened, in its own boundary so loading never suspends the page. */}
          <Suspense>
            <SettingsPanel
              onClose={() => setSettings(false)}
              settings={props.settings}
              theme={theme()}
              onTheme={chooseTheme}
              onFooter={() => mark?.scrollIntoView({ behavior: "smooth", block: "end" })}
            />
          </Suspense>
        </Show>
      )}
    </div>
  )
}

/** The settings panel's sections, each for one part of the site. Pages add their own rows by ID. */
export type SettingsSectionID =
  | "theme"
  | "nav"
  | "hero"
  | "logos"
  | "carousel"
  | "sections"
  | "product"
  | "video"
  | "docs"
  | "footer"
  | "search"
  | "other"
  | "arcade"

/** One row of the development settings panel: a label on the left and a native select on the right. */
export function SettingsSelect<T extends string>(props: {
  label: string
  options: readonly T[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <label data-slot="setting">
      <span>{props.label}</span>
      <select
        value={props.value}
        onChange={(event) => {
          const option = props.options.find((item) => item === event.currentTarget.value)
          if (option) props.onChange(option)
        }}
      >
        <For each={props.options}>{(option) => <option value={option}>{option}</option>}</For>
      </select>
    </label>
  )
}

/** A labeled range input with its current value shown on the right. */
export function SettingsSlider(props: {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  onInput: (value: number) => void
}) {
  return (
    <label data-slot="setting" data-kind="slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(event) => props.onInput(Number(event.currentTarget.value))}
      />
      <output>
        {props.value}
        {props.unit}
      </output>
    </label>
  )
}

// Placeholder icons for the logo menu, drawn on a 14px grid to match the logo icon.
function MenuIcon(props: { name: "wordmark" | "brand" | "press" }) {
  return (
    <svg
      data-slot="menu-icon"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <Show when={props.name === "wordmark"}>
        <path d="M1.5 4.5H5.5V10.5H1.5ZM8.5 4.5H12.5V10.5H8.5Z" />
      </Show>
      <Show when={props.name === "brand"}>
        <path d="M2.5 1.5H11.5V12.5H2.5ZM2.5 4.5H11.5M5 7H9M5 9.5H9" />
      </Show>
      <Show when={props.name === "press"}>
        <path d="M1.5 2.5H10.5V12.5H1.5ZM10.5 5.5H12.5V12.5H10.5M3.5 5H8.5M3.5 7.5H8.5M3.5 10H6.5" />
      </Show>
    </svg>
  )
}

/** "[ ]" with a dash that appears on hover or for the current item, as in the footer list. */
export function Bracket() {
  return (
    <span data-slot="box" aria-hidden="true">
      [<span data-slot="fill" />]
    </span>
  )
}

function ThemeToggle(props: { theme: (typeof themes)[number]; onChange: (theme: (typeof themes)[number]) => void }) {
  const i18n = useI18n()
  return (
    <div
      ref={snapToPixels}
      data-component="theme-toggle"
      data-design="themeSwitcherStyle"
      role="group"
      aria-label={i18n.t("site.theme.label")}
    >
      <For each={themes}>
        {(item) => (
          <button
            type="button"
            aria-label={i18n.t("site.theme.button", { theme: i18n.t(`site.theme.${item}`) })}
            aria-pressed={props.theme === item ? "true" : "false"}
            onClick={() => props.onChange(item)}
          >
            <ThemeIcon theme={item} />
          </button>
        )}
      </For>
    </div>
  )
}

// The content above the footer has fluid heights (wrapping text, media sized by width), so the
// theme control often lands between device pixels and its thin icon strokes blur at 1x. This
// moves it back onto the pixel grid whenever the page's size changes.
function snapToPixels(el: HTMLElement) {
  let frame = 0
  const snap = () => {
    frame = 0
    el.style.translate = ""
    const rect = el.getBoundingClientRect()
    const shift = (value: number) =>
      (Math.round(value * devicePixelRatio) - value * devicePixelRatio) / devicePixelRatio
    const x = shift(rect.left)
    const y = shift(rect.top)
    if (Math.abs(x) > 0.001 || Math.abs(y) > 0.001) el.style.translate = `${x}px ${y}px`
  }
  const observer = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(snap)
  })
  onMount(() => observer.observe(document.body))
  onCleanup(() => {
    observer.disconnect()
    cancelAnimationFrame(frame)
  })
}

/** One button showing the current theme; each click moves to the next (system, light, dark). */
function ThemeCycle(props: { theme: (typeof themes)[number]; onChange: (theme: (typeof themes)[number]) => void }) {
  const i18n = useI18n()
  const next = () => themes[(themes.indexOf(props.theme) + 1) % themes.length]
  return (
    <button
      type="button"
      data-slot="cycle"
      aria-label={i18n.t("site.theme.cycle", {
        theme: i18n.t(`site.theme.${props.theme}`),
        next: i18n.t(`site.theme.${next()}`),
      })}
      onClick={() => props.onChange(next())}
    >
      {/* All three icons stay in place so the change can cross-fade. */}
      <For each={themes}>
        {(item) => (
          <span data-slot="icon" data-current={props.theme === item ? "" : undefined}>
            <ThemeIcon theme={item} />
          </span>
        )}
      </For>
    </button>
  )
}

// A face (eyes and a smile, no outline) on the 16px icon grid, shown in the Markdown view.
function PersonIcon() {
  // Drawn about 2px larger than the 16px grid in the same 14px box, to match the robot's ink (the
  // face alone is smaller than the robot's head and ears); the stroke is thinned to stay 1.1px.
  return (
    <svg
      width="14"
      height="14"
      viewBox="1.45 1.3 13.1 13.1"
      fill="none"
      stroke="currentColor"
      stroke-width="1.02"
      aria-hidden="true"
    >
      <rect x="4.5" y="3.5" width="2" height="4" fill="currentColor" stroke="none" />
      <rect x="9.5" y="3.5" width="2" height="4" fill="currentColor" stroke="none" />
      <path d="M3.25 9.25Q8 14 12.75 9.25" />
    </svg>
  )
}

// A robot face on the 16px icon grid, drawn like the theme icons.
function AgentIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      aria-hidden="true"
    >
      <rect x="2.125" y="2.125" width="11.75" height="11.75" />
      <path d="M0.875 6V10M15.125 6V10" />
      <rect x="4.875" y="5.75" width="2" height="4.5" fill="currentColor" stroke="none" />
      <rect x="9.125" y="5.75" width="2" height="4.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

import "./search.css"
import { createSignal, onCleanup, onMount, Show, type Component } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useI18n } from "~/context/i18n"
import { detectPlatform, isApple } from "~/lib/platform"
import { revealHandedOff } from "./search-reveal"
import { siteSettings } from "./settings"

/**
 * The site search: ⌘K, Ctrl+K or "/" (when not typing) opens it. It has no visible trigger unless
 * Settings › Search hint shows one. This shell only listens for the shortcut; the dialog
 * (search-palette.tsx, with its styles) and the index (search-index.ts) load on intent: ⌘ or Ctrl
 * pressed (the start of ⌘K), hover or focus of a trigger, or the first open. Neither loads without
 * one.
 */

export type SiteSearchProps = {
  onToggleTheme: () => void
  onSettings?: () => void
  /** Toggles Design mode. Given only on the main site on the development server, where it also adds
   *  the development actions (Settings, Design mode, Device preview) to the results. */
  onDesign?: () => void
  /** Opens a site path: in place for this site's pages, with a full load for the rest. */
  go: (href: string) => void
}

/** Dispatched on the document to open the search, such as from Settings › Search › Preview. */
export const searchOpenEvent = "opencode-site-search-open"
// Whether the search is open, for triggers outside it to show their open state (aria-expanded).
const [shown, setShown] = createSignal(false)
export const searchShown = shown
export const setSearchShown = setShown
// The polite live region's text (result counts, copy confirmations). It lives in the shell, so the
// region is in the page before its first announcement.
const [announcement, setAnnouncement] = createSignal("")
export const searchAnnouncement = announcement
export const setSearchAnnouncement = setAnnouncement

/** How the search was opened, for the funnel's `search.opened`. */
export type SearchVia = "shortcut" | "slash" | "button"

/** ⌘K or Ctrl+K anywhere, or "/" outside text fields. */
export function isSearchShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.repeat) return false
  const target = event.target as HTMLElement
  if (target.closest?.("[contenteditable]")) return false
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") return true
  return event.key === "/" && !event.metaKey && !event.ctrlKey && !target.closest?.("input, textarea, select")
}

let palette: Promise<typeof import("./search-palette")> | undefined
/** Starts loading the dialog and the index, for a trigger's hover or focus. */
export function prefetchSearch() {
  palette ??= import("./search-palette")
  void import("./search-index")
  return palette
}

export function SiteSearch(props: SiteSearchProps) {
  const i18n = useI18n()
  const [Palette, setPalette] = createSignal<Component<SiteSearchProps & { openOnMount?: SearchVia }>>()
  const [mounted, setMounted] = createSignal(false)
  const [mac, setMac] = createSignal(true)
  let openOnMount: SearchVia | undefined

  // Until the dialog has loaded; once mounted it handles the shortcut and the open event itself.
  const open = (via: SearchVia) => {
    if (Palette()) return
    openOnMount = via
    void prefetchSearch().then((module) => setPalette(() => module.SearchPalette))
  }

  onMount(() => {
    revealHandedOff()
    setMounted(true)
    setMac(isApple(detectPlatform()))
    const shortcut = (event: KeyboardEvent) => {
      if (Palette()) return
      // ⌘ or Ctrl on its own starts loading the dialog, so a fast ⌘K, type and Enter finds results.
      if (event.key === "Meta" || event.key === "Control")
        return void prefetchSearch().then((module) => !Palette() && setPalette(() => module.SearchPalette))
      if (!isSearchShortcut(event)) return
      event.preventDefault()
      open(event.key === "/" ? "slash" : "shortcut")
    }
    const openFromButton = () => open("button")
    document.addEventListener("keydown", shortcut)
    document.addEventListener(searchOpenEvent, openFromButton)
    onCleanup(() => {
      document.removeEventListener("keydown", shortcut)
      document.removeEventListener(searchOpenEvent, openFromButton)
    })
  })

  return (
    <>
      <span data-slot="search-status" aria-live="polite" role="status">
        {announcement()}
      </span>
      <Show when={mounted() && siteSettings.searchHint === "corner"}>
        <button
          type="button"
          data-component="search-hint"
          data-tip={i18n.t("site.search.label")}
          aria-label={i18n.t("site.search.label")}
          aria-keyshortcuts="Meta+K Control+K /"
          aria-haspopup="dialog"
          aria-expanded={shown() ? "true" : "false"}
          onPointerEnter={() => void prefetchSearch()}
          onFocus={() => void prefetchSearch()}
          onClick={() => (Palette() ? document.dispatchEvent(new Event(searchOpenEvent)) : open("button"))}
        >
          {mac() ? "⌘K" : "Ctrl K"}
        </button>
      </Show>
      <Show when={Palette()}>{(loaded) => <Dynamic component={loaded()} {...props} openOnMount={openOnMount} />}</Show>
    </>
  )
}

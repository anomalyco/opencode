import { useArea } from "~/i18n/content"
import { announcementsSource } from "~/i18n/content/areas/announcements"
import { useI18n } from "~/context/i18n"
import "./site-banner.css"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "~/context/language"
import { announcementCopy, announcements } from "./announcement"
import { designCopy } from "./design-copy"
import { dismissKey } from "./site-banner-script"
import { ChevronRight, CloseIcon } from "./icons"
import { setSiteSetting, siteSettings } from "./settings"

const [dismissed, setDismissed] = createSignal<string>()

const message = () => designCopy("home.announcement", announcementCopy(announcements[0]))

/** On when the announcement is on in the "banner" style (the other styles are home only) and its message wasn't dismissed. */
export const bannerVisible = () =>
  siteSettings.homeAnnouncement === "on" && siteSettings.announcementStyle === "banner" && dismissed() !== message()

// Whether the banner still covers the top of the screen (it scrolls away with the page), and its blue
// as painted, which follows the theme and the blue settings.
const [onTop, setOnTop] = createSignal(true)
const [blue, setBlue] = createSignal<string>()

/**
 * The banner's blue while it is open and covers the top of the screen, else undefined: the browser
 * bar colour (theme-color) then matches it, so the status bar area and the banner read as one surface.
 */
export const bannerTopColor = () => (bannerVisible() && onTop() ? blue() : undefined)

/**
 * Runs while the page is parsed, right after the banner: when it is open, gives the theme-color tags
 * its blue before first paint. The stylesheets come before it in the document, so it reads the blue
 * as painted; it skips the tags if they have not applied yet.
 */
export const bannerThemeColorScript = `(()=>{const a=document.currentScript.parentElement;if(!a.hasAttribute("data-banner"))return;const l=a.querySelector('[data-component="announcement-banner"] a');const c=l&&getComputedStyle(l).backgroundColor;if(!c||c==="transparent"||/, 0\\)$/.test(c))return;document.querySelectorAll('meta[name="theme-color"]').forEach((m)=>{m.content=c})})()`

/**
 * The announcement's "banner" style: a full-width blue bar above the whole page, the footer letters
 * bar's twin, the whole bar the link, with × to dismiss it. Every page renders it first in its banner
 * host (Site's root, the product nav demos); the host's data-banner, set before first paint for a
 * saved value, opens it and pushes the page down. While it is on screen the host's fixed elements sit
 * below it through --banner-offset, and --banner-scroll follows the page's scroll so they rise as it
 * scrolls away. ⇧A or ⇧N turns the announcement on and off from any page (bringing back a dismissed
 * banner first), except while typing.
 */
export function SiteBanner() {
  const language = useLanguage()
  const i18n = useI18n()
  const announcementText = useArea("announcements", announcementsSource)
  const item = () => announcements.find((entry) => announcementCopy(entry) === message())
  // The chosen announcement in this locale; a custom Design mode message stays as typed.
  const parts = () => {
    const index = announcements.findIndex((entry) => announcementCopy(entry) === message())
    if (index < 0) return { text: message(), link: "" }
    return announcementText()[index]
  }
  const shown = () => [parts().text, parts().link].filter(Boolean).join(" ")
  let banner: HTMLDivElement | undefined

  const dismiss = () => {
    localStorage.setItem(dismissKey, message())
    setDismissed(message())
  }

  onMount(() => {
    setDismissed(localStorage.getItem(dismissKey) ?? undefined)
    const host = banner?.parentElement
    const link = banner?.querySelector("a")
    const scroll = () => {
      host?.style.setProperty("--banner-scroll", `${Math.min(window.scrollY, 200)}px`)
      setOnTop(window.scrollY < (link?.offsetHeight ?? 0))
    }
    const paint = () => setBlue(link ? getComputedStyle(link).backgroundColor : undefined)
    // The blue changes with the theme (the host's data-theme, or the system's when it follows it)
    // and Settings › Link blue and Dark blue.
    const colors = new MutationObserver(paint)
    if (host) colors.observe(host, { attributeFilter: ["data-theme", "data-blue", "data-dark-blue"] })
    const scheme = window.matchMedia("(prefers-color-scheme: dark)")
    scheme.addEventListener("change", paint)
    paint()
    const key = (event: KeyboardEvent) => {
      if (!["KeyA", "KeyN"].includes(event.code) || !event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)
        return
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return
      event.preventDefault()
      if (siteSettings.homeAnnouncement === "on" && dismissed() === message()) {
        localStorage.removeItem(dismissKey)
        return setDismissed(undefined)
      }
      setSiteSetting("homeAnnouncement", siteSettings.homeAnnouncement === "on" ? "off" : "on")
    }
    scroll()
    window.addEventListener("scroll", scroll, { passive: true })
    document.addEventListener("keydown", key)
    onCleanup(() => {
      window.removeEventListener("scroll", scroll)
      document.removeEventListener("keydown", key)
      colors.disconnect()
      scheme.removeEventListener("change", paint)
      host?.style.removeProperty("--banner-scroll")
    })
  })

  return (
    <div
      ref={banner}
      data-component="announcement-banner"
      data-label={siteSettings.bannerLabel}
      data-design="homeAnnouncement announcementStyle bannerLabel"
      inert={!bannerVisible()}
    >
      <a
        href={language.route(item()?.href ?? announcements[0].href)}
        aria-label={i18n.t("site.announcement.label", { message: shown() })}
      >
        <span data-slot="new" aria-hidden="true">
          {i18n.t("home.banner.badge")}
        </span>
        <span data-slot="body" aria-hidden="true">
          {/* Phones drop the link text ("See what's new in 2.2"); the whole bar is still the link. */}
          <span data-slot="message">
            {parts().text}
            <Show when={parts().link}>
              <span data-slot="link-text"> {parts().link}</span>
            </Show>
          </span>
          <ChevronRight />
        </span>
      </a>
      {/* A sibling of the link, so it never follows it. */}
      <button type="button" data-slot="dismiss" aria-label={i18n.t("site.announcement.dismiss")} onClick={dismiss}>
        <CloseIcon />
      </button>
    </div>
  )
}

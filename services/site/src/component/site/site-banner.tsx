import { useArea } from "~/i18n/content"
import { announcementsSource } from "~/i18n/content/areas/announcements"
import { useI18n } from "~/context/i18n"
import "./site-banner.css"
import { onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "~/context/language"
import { announcementCopy, announcements } from "./announcement"
import { bannerVisible, dismissed, dismissKey, message, setBlue, setDismissed, setOnTop } from "./site-banner-script"
import { ChevronRight, CloseIcon } from "./icons"
import { setSiteSetting, siteSettings } from "./settings"

/**
 * The announcement's "banner" style: a full-width blue bar above the whole page, the footer letters
 * bar's twin, the whole bar the link, with × to dismiss it. Every page renders it first in its banner
 * host (Site's root, the product nav demos); the host's data-banner, set before first paint for a
 * saved value, opens it and pushes the page down. While it is on screen the host's fixed elements sit
 * below it through --banner-offset, and --banner-scroll follows the page's scroll so they rise as it
 * scrolls away. On the development server, ⇧A or ⇧N turns the announcement on and off from any page
 * (bringing back a dismissed banner first), except while typing. Production renders the banner only
 * when the default settings turn it on (site.tsx).
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
    // Reads come before the write, and an unchanged value isn't written again: --banner-scroll sits on
    // the page's root, so each write restyles the whole page, and a read after it forced that at once.
    // Unset reads as 0px (site-banner.css's fallback), so a page loaded at the top writes nothing.
    let offset = "0px"
    const scroll = () => {
      const y = window.scrollY
      const top = y < (link?.offsetHeight ?? 0)
      const next = `${Math.min(y, 200)}px`
      if (next !== offset) host?.style.setProperty("--banner-scroll", (offset = next))
      setOnTop(top)
    }
    const paint = () => setBlue(link ? getComputedStyle(link).backgroundColor : undefined)
    // The blue changes with the theme (the host's data-theme, or the system's when it follows it)
    // and Settings › Link blue and Dark blue.
    const colors = new MutationObserver(paint)
    if (host) colors.observe(host, { attributeFilter: ["data-theme", "data-blue", "data-dark-blue"] })
    const scheme = window.matchMedia("(prefers-color-scheme: dark)")
    scheme.addEventListener("change", paint)
    paint()
    scroll()
    window.addEventListener("scroll", scroll, { passive: true })
    onCleanup(() => {
      window.removeEventListener("scroll", scroll)
      colors.disconnect()
      scheme.removeEventListener("change", paint)
      host?.style.removeProperty("--banner-scroll")
    })
    if (import.meta.env.DEV) {
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
      document.addEventListener("keydown", key)
      onCleanup(() => document.removeEventListener("keydown", key))
    }
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

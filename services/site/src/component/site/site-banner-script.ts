import { createSignal } from "solid-js"
import { announcementCopy, announcements } from "./announcement"
import { designCopy } from "./design-copy"
import { siteSettings } from "./settings"

// The banner's message as it was dismissed with ×, kept apart from the Announcement setting so a
// new message shows again. Read after hydration; bannerDismissScript applies it before first paint.
export const dismissKey = "opencode-announcement-dismissed"

// The message the banner will show as a script expression: Design mode's choice, as designCopy picks
// it, on the development server (its options for "home.announcement" are the announcements), and the
// page's own message in production, which has no Design mode.
const own = JSON.stringify(announcementCopy(announcements[0]))
const shown = import.meta.env.DEV
  ? `(()=>{const c=JSON.parse(localStorage.getItem("opencode-site-design-copy-v2")||"null")||{};const id="home.announcement";const i=(c.choice&&c.choice[id])||0;const o=${JSON.stringify(announcements.map(announcementCopy))}.concat((c.custom&&c.custom[id])||[]);return i===0?${own}:o[i-1]||${own}})()`
  : own

/**
 * Runs while the page is parsed, after the settings script has set data-banner: drops it again when
 * the message the banner will show was dismissed.
 */
export const bannerDismissScript = `(()=>{try{const r=document.currentScript.parentElement;if(!r.hasAttribute("data-banner"))return;const d=localStorage.getItem(${JSON.stringify(dismissKey)});if(!d)return;const m=${shown};if(d===m)r.removeAttribute("data-banner")}catch{}})()`

// The banner's state, which the page reads too (site.tsx) without loading the banner itself.
export const [dismissed, setDismissed] = createSignal<string>()

export const message = () => designCopy("home.announcement", announcementCopy(announcements[0]))

/** On when the announcement is on in the "banner" style (the other styles are home only) and its message wasn't dismissed. */
export const bannerVisible = () =>
  siteSettings.homeAnnouncement === "on" && siteSettings.announcementStyle === "banner" && dismissed() !== message()

// Whether the banner still covers the top of the screen (it scrolls away with the page), and its blue
// as painted, which follows the theme and the blue settings.
export const [onTop, setOnTop] = createSignal(true)
export const [blue, setBlue] = createSignal<string>()

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

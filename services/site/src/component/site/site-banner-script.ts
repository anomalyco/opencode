import { announcementCopy, announcements } from "./announcement"

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

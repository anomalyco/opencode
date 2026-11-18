import { afterLoad } from "./card-video"

/**
 * What a product hero's video does (HeroVideo in product-hero.tsx draws it, in the app and on the
 * static pages): nothing of it loads before the page has (preload="none" in the markup; its poster,
 * the same frame, shows meanwhile), then it plays, muted and looping, while the hero is on screen
 * and the tab is visible. With reduced motion it rests on that frame until `toggle` plays it, and
 * downloads nothing until then. No framework code. Returns the play button's toggle, `refresh` for
 * when the sources change (a theme change), and a stop.
 */
export function heroVideo(video: HTMLVideoElement) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
  // With reduced motion the video plays only after the button is pressed, and stops when pressed again.
  let wanted = false
  let visible = false
  let ready = false
  // The sources changed, or the browser chose among them before the theme script named them (and
  // found none): load again, but only to play, as a load fetches even with preload="none".
  let stale = false
  const sync = () => {
    if (!ready || !visible || document.hidden || (reduced && !wanted)) return video.pause()
    if (stale || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) video.load()
    stale = false
    void video.play().catch(() => {})
  }
  // The video may have loaded before this ran (a theme change reloads it too, and it plays again).
  const loaded = () => {
    video.setAttribute("data-loaded", "")
    sync()
  }
  if (video.readyState >= 2) loaded()
  video.addEventListener("loadeddata", loaded)
  const start = () => {
    ready = true
    if (!reduced) video.preload = "auto"
    sync()
  }
  afterLoad(start)
  const view = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    sync()
  })
  view.observe(video)
  document.addEventListener("visibilitychange", sync)
  return {
    toggle: () => {
      wanted = video.paused
      ready = true
      sync()
    },
    refresh: () => {
      stale = true
      if (!video.paused) sync()
    },
    stop: () => {
      window.removeEventListener("load", start)
      video.removeEventListener("loadeddata", loaded)
      view.disconnect()
      document.removeEventListener("visibilitychange", sync)
    },
  }
}

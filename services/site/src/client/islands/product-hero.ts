import { heroVideo } from "~/component/site/hero-video"
import { $, $$, site } from "../dom"

/**
 * A product hero (product-hero.tsx): its video plays once the page has loaded (hero-video.ts), and
 * with reduced motion its button plays and pauses it. A hero with files per theme had its inline
 * script pick the theme's before first paint; this keeps every source on the page's theme as the
 * theme switch or the system setting changes it.
 */
export default function productHero(hero: HTMLElement) {
  const video = $<HTMLVideoElement>("video", hero)
  const button = $('[data-slot="play"]', hero)
  const playing = video && heroVideo(video)
  if (video && playing) {
    // With reduced motion, its play and pause button: the label (the server's, then data-pause while
    // playing) and the icon follow the video.
    const play = button?.getAttribute("aria-label") ?? ""
    const label = () => {
      button?.setAttribute("aria-label", video.paused ? play : (button.dataset.pause ?? play))
      if (button)
        $("path", button)?.setAttribute("d", video.paused ? "M3 1.5v9l7.5-4.5z" : "M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z")
    }
    video.addEventListener("play", label)
    video.addEventListener("pause", label)
    button?.addEventListener("click", playing.toggle)
  }
  const system = matchMedia("(prefers-color-scheme: dark)")
  const sync = () => {
    // As media.tsx pageScheme() picks it.
    const theme = site.dataset.theme
    const scheme = theme === "light" || theme === "dark" ? theme : system.matches ? "dark" : "light"
    $$("picture [data-light-srcset]", hero).forEach((element) => {
      const srcset = element.dataset[`${scheme}Srcset`]
      const src = element.dataset[scheme]
      if (srcset) element.setAttribute("srcset", srcset)
      if (src) element.setAttribute("src", src)
    })
    const poster = video?.dataset[`${scheme}Poster`]
    if (!video || !poster || video.getAttribute("poster") === poster) return
    video.setAttribute("poster", poster)
    $$("source[data-light]", video).forEach((source) => source.setAttribute("src", source.dataset[scheme] ?? ""))
    playing?.refresh()
  }
  new MutationObserver(sync).observe(site, { attributes: true, attributeFilter: ["data-theme"] })
  system.addEventListener("change", sync)
}

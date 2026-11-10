import { Wordmark } from "~/component/site/marks"
import { siteSettings } from "~/component/site/settings"
import { $, html, site } from "../dom"
import { mount } from "../solid"
import { setBarColor } from "../theme"

/**
 * The footer's wordmark (site.tsx on the hydrated pages): rendered again in the browser as it comes
 * near, so it draws itself in and its letters can be dragged. While they are out of order the
 * "Like letters?" bar slides open at the page's end; filling the bottom of the screen, its blue runs
 * on to the screen's bottom edge (the page behind and the browser bar take it).
 */
export default function wordmark(root: HTMLElement) {
  const bar = $('[data-component="letters-bar"]')
  let shown = false
  let inView = false
  let atEnd = false
  let tint = false
  let opened = 0
  let timer = 0

  const update = () => {
    site.toggleAttribute("data-letters-bar", shown && inView)
    const bottom = shown && atEnd
    clearTimeout(timer)
    if (bottom) return setTint(true)
    // Until it has finished closing (or opening, while the page catches up with it), the bottom keeps its blue.
    const duration = bar ? parseFloat(getComputedStyle(bar).transitionDuration) * 1000 : 0
    const rest = shown ? opened + duration - performance.now() : duration
    if (rest <= 0) return setTint(false)
    timer = window.setTimeout(() => setTint(shown && atEnd), rest)
  }
  const setTint = (next: boolean) => {
    if (next === tint) return
    tint = next
    site.toggleAttribute("data-letters-end", tint)
    const link = $('[data-component="letters-bar"] a')
    const blue = tint && link ? getComputedStyle(link).backgroundColor : undefined
    setBarColor(blue)
    if (blue) html.style.backgroundColor = blue
    else html.style.removeProperty("background-color")
  }
  const order = (reordered: boolean) => {
    if (!bar || reordered === shown) return
    shown = reordered
    bar.toggleAttribute("data-shown", shown)
    bar.inert = !shown
    if (shown) {
      opened = performance.now()
      // Someone at the bottom stays at the bottom while the bar grows, so the page moves up with it.
      const grown = bar.getBoundingClientRect().height
      if (scrollY + innerHeight >= html.scrollHeight - grown - 4) {
        const until = performance.now() + 400
        const follow = () => {
          scrollTo(0, html.scrollHeight)
          if (performance.now() < until) requestAnimationFrame(follow)
        }
        requestAnimationFrame(follow)
      }
    }
    update()
  }
  if (bar)
    new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting
        atEnd = entry.intersectionRatio >= 0.98
        update()
      },
      { threshold: [0, 0.98] },
    ).observe(bar)

  void mount(
    () => (
      <Wordmark
        hatch={siteSettings.wordmarkHatch}
        nodes={siteSettings.wordmarkNodes === "on"}
        entrance={siteSettings.footerWordmark === "off" ? "off" : siteSettings.footerWordmarkAnimation}
        speed={siteSettings.footerWordmarkSpeed}
        play={siteSettings.footerWordmarkPlay === "drag"}
        onOrder={order}
      />
    ),
    root,
    true,
  )
}

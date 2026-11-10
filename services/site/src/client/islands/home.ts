import { consoleDots } from "~/component/site/console-dots"
import { onEntrance, revealMotion, washColumns, washItem, washStartTime, washStep } from "~/component/site/reveal"
import { siteSettings } from "~/component/site/settings"
import { spinReel } from "~/component/site/slot-stat"
import { $, $$, reducedMotion } from "../dom"

/**
 * The home page's motion (routes/index.tsx does the same in the app): the logo row, the open source
 * numbers that spin as they near the window and the contributors' avatars that wash in after them,
 * the tool and subscription tiles that wash in as they scroll into view (fetching their logos a
 * screen early), the Console section's dots, and the carousel's arrows for a mouse.
 */
export default function home() {
  const stats = $('[data-component="stats"]')
  const people = $('ul[data-slot="people"]')
  // When the numbers start, which the avatars wait for.
  let started: ((at: number) => void) | undefined
  const numbers = new Promise<number>((done) => (started = done))
  if (stats) openSourceStats(stats, started!)
  // Settings › Avatar and Tools animation.
  const same = (style: string) =>
    style === "same as logos" ? siteSettings.logoAnimation : (style as typeof siteSettings.logoAnimation)
  if (people) wash(people, same(siteSettings.avatarAnimation), siteSettings.avatarStagger, numbers)
  $$('ul[data-component="tools"][data-entrance]').forEach((grid) => {
    const near = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        grid.toggleAttribute("data-near", true)
        near.disconnect()
      },
      { rootMargin: "100% 0px" },
    )
    near.observe(grid)
    if (siteSettings.toolsAnimation !== "off") wash(grid, same(siteSettings.toolsAnimation), siteSettings.toolsStagger)
  })
  $$<HTMLElement>('[data-component="console-field"]').forEach((field) =>
    consoleDots(field, () => Number(field.dataset.dot) || 2),
  )
  // The logo row and, for a mouse, the carousel's arrows render in the browser, with the framework
  // (solid.tsx). Touch screens swipe the cards and never load the arrows.
  const wall = $('[data-component="logo-wall"]')
  if (wall) void import("./logo-wall").then((module) => module.default(wall))
  const carousel = $('[data-component="products"][data-layout="carousel"]')
  if (carousel && matchMedia("(pointer: fine)").matches)
    void import("./carousel").then((module) => module.default(carousel))
}

// The numbers start a fifth of a window early, so they already spin as they come into view; with
// reduced motion they simply show.
function openSourceStats(stats: HTMLElement, started: (at: number) => void) {
  if (reducedMotion()) return stats.toggleAttribute("data-visible", true)
  let first = true
  const observer = new IntersectionObserver(
    (entries) => {
      const initial = first
      first = false
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      const at = washStartTime(initial)
      started(at)
      setTimeout(() => stats.toggleAttribute("data-visible", true), Math.max(0, at - performance.now()))
      $$('[data-component="slot-stat"]', stats).forEach((stat, index) =>
        $$('[data-slot="strip"]', stat).forEach((strip, place) =>
          spinReel(strip, Number(strip.textContent), place, index, at),
        ),
      )
    },
    { rootMargin: "0px 0px 20% 0px" },
  )
  observer.observe(stats)
}

/**
 * A grid's entrance wash (use-wash.ts in the app): each tile arrives `stagger` ms after the one
 * before it in a diagonal from the top left, the first time the grid is in view, and no sooner than
 * 150ms after `after` (the numbers above the avatars); an avatar comes in once its picture has
 * decoded (washItem). Only the two rows of avatars on show stay in the page, and ones a wider window
 * shows later come straight in.
 */
function wash(
  grid: HTMLElement,
  animation: typeof siteSettings.logoAnimation,
  stagger: number,
  after?: Promise<number>,
) {
  grid.toggleAttribute("data-mounted", true)
  const items = $$(":scope > li", grid)
  const washed = new Set<HTMLElement>()
  let columns = washColumns(grid)
  let start: number | undefined
  const reveal = () => {
    const shown = items.filter((item) => !item.hidden)
    shown.forEach((item, index) => {
      const brand = $('[data-slot="brand"]', item)
      if (start === undefined || !brand || washed.has(item)) return
      washed.add(item)
      washItem(brand, start + washStep(index, columns, shown.length) * stagger, $<HTMLImageElement>("img", item))
    })
  }
  const fit = () => {
    columns = washColumns(grid)
    if (grid.matches('[data-slot="people"]')) items.forEach((item, index) => (item.hidden = index >= columns * 2))
    reveal()
  }
  fit()
  new ResizeObserver(fit).observe(grid)
  if (reducedMotion()) return
  grid.toggleAttribute("data-reveal", true)
  grid.toggleAttribute("data-armed", true)
  grid.dataset.animation = animation
  Object.entries(revealMotion(animation, siteSettings.logoTuning)).forEach(([name, value]) =>
    grid.style.setProperty(name, String(value)),
  )
  onEntrance(
    grid,
    (own) =>
      void (after ?? Promise.resolve(undefined)).then((first) => {
        start = first === undefined ? own : Math.max(own, first + 150)
        reveal()
      }),
  )
}

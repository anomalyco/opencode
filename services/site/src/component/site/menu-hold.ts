/**
 * The phone dropdowns under the sticky bars (the Contents bar, and the docs section row): while one
 * is open, the page holds still (data-menu-hold, on-this-page.css) and the open list is its own scroll
 * area, from under its row to the bottom of the visual viewport, so the row stays put and only the
 * list scrolls. Call it whenever one opens or closes; it reads which is open from the page. A list
 * that drops in the page's flow (not absolutely positioned) is left alone.
 */
export function holdOpenMenu() {
  const list = document.querySelector<HTMLElement>(
    '[data-component="contents-menu"][open] > ul, [data-component="section-nav"][data-open] [data-slot="section-body"]',
  )
  const held = !!list && getComputedStyle(list).position === "absolute"
  document.documentElement.toggleAttribute("data-menu-hold", held)
  document
    .querySelectorAll<HTMLElement>('[data-component="contents-menu"] > ul, [data-slot="section-body"]')
    .forEach((other) => other !== list && other.style.removeProperty("max-height"))
  if (!list || !held) return
  const view = window.visualViewport
  const bottom = view ? view.offsetTop + view.height : window.innerHeight
  // From where the list rests (its offset, so an opening animation's shift doesn't count).
  const top = (list.offsetParent?.getBoundingClientRect().top ?? 0) + list.offsetTop
  list.style.maxHeight = `${Math.max(0, bottom - top)}px`
}

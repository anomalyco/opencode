import type { SearchItem } from "./search-index"

// Where a search result goes on its page (search-palette.tsx), with no framework code, so the pages
// that never hydrate (src/client) reveal it too. A result on another page that opens with a full page
// load (a static page, or any page from one) is handed to that page through session storage.

type Target = SearchItem["target"]
const key = "opencode-search-reveal"

/** Hands a result's place to the next page, in case it opens with a full page load. */
export function handOff(path: string, target: Target) {
  if (!target) return
  try {
    sessionStorage.setItem(key, JSON.stringify({ path, target, at: Date.now() }))
  } catch {}
}

/** On a page that just loaded: reveals the place a search result handed to it, if any. */
export function revealHandedOff() {
  try {
    const value = sessionStorage.getItem(key)
    if (!value) return
    forget()
    const { path, target, at } = JSON.parse(value) as { path: string; target: Target; at: number }
    if (Date.now() - at < 10_000 && path === trim(window.location.pathname)) reveal(path, target)
  } catch {}
}

/**
 * Scrolls to a search result's place once its page is showing: an element ID, a heading with the
 * result's text, or a FAQ question (opened). Pages fade in after in-place navigation, so this waits
 * for the path and the element for up to three seconds.
 */
export function reveal(path: string, target: Target) {
  const started = performance.now()
  const step = () => {
    const ready = trim(window.location.pathname) === path
    const element = ready ? find(target) : undefined
    if (!element) {
      if (performance.now() - started < 3000) requestAnimationFrame(step)
      return
    }
    const trigger = target?.faq ? element.querySelector<HTMLElement>('[data-slot="faq-question"]') : undefined
    if (trigger && trigger.getAttribute("aria-expanded") !== "true") trigger.click()
    const bar = document.querySelector('[data-component="topbar"]')?.getBoundingClientRect()
    // The small-screen header is sticky, so the target lands below it.
    const offset = (bar && bar.height > 0 ? Math.max(bar.bottom, 0) : 0) + 24
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
    window.scrollTo({
      top: element.getBoundingClientRect().top + window.scrollY - offset,
      behavior: reduce ? "instant" : "smooth",
    })
    forget()
    const focusable = trigger ?? element
    if (!trigger && !element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1")
    focusable.focus({ preventScroll: true })
    element.setAttribute("data-search-target", "")
    setTimeout(() => element.removeAttribute("data-search-target"), 1600)
  }
  if (!target) return window.scrollTo({ top: 0 })
  requestAnimationFrame(step)
}

function find(target: Target): HTMLElement | undefined {
  if (!target) return
  const content = document.querySelector('[data-component="content"]') ?? document
  if (target.id) return document.getElementById(target.id) ?? undefined
  if (target.faq)
    return (
      [...content.querySelectorAll<HTMLElement>('[data-slot="faq-item"]')].find(
        (item) => item.querySelector('[data-slot="faq-question-text"]')?.textContent?.trim() === target.faq,
      ) ?? undefined
    )
  const text = target.text?.trim().toLowerCase()
  return (
    [...content.querySelectorAll<HTMLElement>("h1, h2, h3, h4, strong, dt")].find(
      (element) => element.textContent?.trim().toLowerCase() === text && element.getClientRects().length > 0,
    ) ?? undefined
  )
}

function forget() {
  try {
    sessionStorage.removeItem(key)
  } catch {}
}

export function trim(path: string) {
  return path.length > 1 ? path.replace(/\/$/, "") : path
}

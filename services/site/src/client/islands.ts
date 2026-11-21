import { $$ } from "./dom"

/**
 * The static pages' islands: parts of a page that need more than the shared script, each found by
 * its markup and loaded with its own code only when the page has it, either once it comes near the
 * window or once the page is idle. An island's module gets the element and does the rest; a `once`
 * island runs once for the whole page, given the first element that matched.
 */
const islands: {
  selector: string
  when: "near" | "idle"
  once?: boolean
  load: () => Promise<{ default: (root: HTMLElement) => void }>
}[] = [
  { selector: '[data-component="wordmark"]', when: "near", load: () => import("./islands/wordmark") },
  { selector: '[data-component="legal-body"]', when: "idle", load: () => import("./islands/legal") },
  {
    // The changelog's, a release's, and a product page's latest releases.
    selector: 'section:is([data-slot="timeline"], [data-slot="product-changelog"])',
    when: "near",
    load: () => import("./islands/changelog"),
  },
  { selector: '[data-site][data-page="press"]', when: "idle", load: () => import("./islands/press") },
  { selector: '[data-site][data-page="brand"]', when: "idle", load: () => import("./islands/brand") },
  { selector: '[data-slot="agent-rules"]', when: "idle", load: () => import("./islands/agent-rules") },
  { selector: '[data-component="product-hero"]', when: "idle", load: () => import("./islands/product-hero") },
  {
    selector: ':is([data-component="product-card"], [data-component="showcase"]) [data-slot="media"]:has(> video)',
    when: "near",
    load: () => import("./islands/card-video"),
  },
  {
    selector: '[data-desktop-download], button[data-funnel-copy]:is([data-slot="install"], [data-slot="row"])',
    when: "idle",
    once: true,
    load: () => import("./islands/product-action"),
  },
  {
    selector: '[data-slot="media"][data-product], [data-component="product-hero"][data-product]',
    when: "idle",
    once: true,
    load: () => import("./islands/card-morph"),
  },
  { selector: '[data-site][data-page="home"]', when: "idle", load: () => import("./islands/home") },
  {
    selector: '[data-slot="product-download"] > [data-slot="body"]',
    when: "near",
    load: () => import("./islands/download-list"),
  },
  // The font page's typewriter, then its plates as they come near (one module, islands/font.tsx).
  { selector: '[data-component="font-hero"]', when: "idle", load: () => import("./islands/font") },
  {
    selector: '[data-component="specimen"] > *, [data-plate="film"]',
    when: "near",
    load: () => import("./islands/font"),
  },
  { selector: '[data-component="arcade-404"]', when: "idle", load: () => import("./islands/arcade") },
]

export function startIslands() {
  const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 200))
  islands.forEach((island) =>
    $$(island.selector)
      .slice(0, island.once ? 1 : undefined)
      .forEach((root) => {
        const start = () => void island.load().then((module) => module.default(root))
        if (island.when === "idle") return idle(start)
        const near = new IntersectionObserver(
          (entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return
            near.disconnect()
            start()
          },
          { rootMargin: "50% 0px" },
        )
        near.observe(root)
      }),
  )
}

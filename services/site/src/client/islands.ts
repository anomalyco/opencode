import { $$ } from "./dom"

/**
 * The static pages' islands: parts of a page that need more than the shared script, each found by
 * its markup and loaded with its own code only when the page has it, either once it comes near the
 * window or once the page is idle. An island's module gets the element and does the rest.
 */
const islands: {
  selector: string
  when: "near" | "idle"
  load: () => Promise<{ default: (root: HTMLElement) => void }>
}[] = [
  { selector: '[data-component="wordmark"]', when: "near", load: () => import("./islands/wordmark") },
  { selector: '[data-component="legal-body"]', when: "idle", load: () => import("./islands/legal") },
  { selector: 'section[data-slot="timeline"]', when: "near", load: () => import("./islands/changelog") },
  { selector: '[data-site][data-page="press"]', when: "idle", load: () => import("./islands/press") },
  { selector: '[data-site][data-page="brand"]', when: "idle", load: () => import("./islands/brand") },
  { selector: '[data-slot="agent-rules"]', when: "idle", load: () => import("./islands/agent-rules") },
  { selector: '[data-component="product-hero"]', when: "idle", load: () => import("./islands/product-hero") },
  {
    selector: '[data-slot="product-download"] > [data-slot="body"]',
    when: "near",
    load: () => import("./islands/download-list"),
  },
]

export function startIslands() {
  const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 200))
  islands.forEach((island) =>
    $$(island.selector).forEach((root) => {
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

import { copied, copyUrl } from "../copy"
import { $, $$, on, target } from "../dom"
import { setFaq } from "../faq"

/**
 * The Press page (routes/press/index.tsx): the boilerplate accordion, the copy buttons (each
 * boilerplate, the Anomaly logo SVGs) and the media gallery's lightbox, which renders in the browser
 * on the first thumbnail click (press-lightbox.tsx).
 */
export default function press() {
  const list = $('[data-slot="boilerplate-accordion"]')
  if (list) accordion(list)

  on("click", (event) => {
    const label = target(event).closest<HTMLElement>('[data-component="boilerplate"] [data-slot="copy-label"]')
    const boilerplate = label?.closest<HTMLElement>('[data-component="boilerplate"]')
    if (label && boilerplate) {
      boilerplate.toggleAttribute("data-copied", true)
      return void copied(
        label,
        () => navigator.clipboard.writeText($('[data-slot="text"]', boilerplate)?.textContent ?? ""),
        $("[aria-live]", boilerplate),
      ).then(() => boilerplate.toggleAttribute("data-copied", label.dataset.state === "copied"))
    }
    const svg = target(event).closest<HTMLElement>('[data-component="logo-tiles"] [data-slot="copy-square"]')
    const file = svg?.parentElement?.querySelector<HTMLAnchorElement>('a[download$=".svg"]')
    if (svg && file)
      void copied(svg, () => copyUrl(file.href), svg.closest('[data-component="logo-tiles"]')?.nextElementSibling)
  })

  // The gallery's lightbox loads with its first use, the pointer or focus on a thumbnail.
  const load = () => import("./press-lightbox")
  const thumb = '[data-component="press-gallery"] [data-slot="thumb"]'
  for (const type of ["pointerover", "focusin"] as const)
    on(type, (event) => target(event).closest(thumb) && void load())
  on("click", (event) => {
    const button = target(event).closest<HTMLElement>(thumb)
    const gallery = button?.closest<HTMLElement>('[data-component="press-gallery"]')
    if (!button || !gallery) return
    const product = $$('[data-slot="group"]', gallery).indexOf(button.closest('[data-slot="group"]')!)
    void load().then((module) => module.show(gallery, { product, item: 0, from: button }))
  })
}

// The boilerplate accordion (faq.tsx, opened and closed by src/client/faq.ts), OpenCode's row open
// from the server. A row grows open only once one has been toggled (data-ready), so a row a link
// opens doesn't animate.
function accordion(list: HTMLElement) {
  for (const type of ["click", "beforematch"])
    list.addEventListener(type, () => list.toggleAttribute("data-ready", true), true)
  // A link to a closed row (#boilerplate-…, or anything inside one) opens it.
  const reveal = () => {
    const found = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null
    const row = found?.closest<HTMLElement>('[data-slot="boilerplate-accordion"] > li')
    const item = row && $('[data-slot="faq-item"]', row)
    if (!item) return
    setFaq(item, true)
    requestAnimationFrame(() => found?.scrollIntoView())
  }
  reveal()
  addEventListener("hashchange", reveal)
}

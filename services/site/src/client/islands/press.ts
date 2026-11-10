import { copied, copyUrl } from "../copy"
import { $, $$, on, target } from "../dom"

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

// The boilerplate accordion's rows (routes/press/index.tsx, in the FAQ's look), any number open:
// OpenCode open from the server. A row grows open, only once one has been toggled (data-ready), so a
// row a link opens doesn't animate; a closed one goes at once (faq.css) and is hidden="until-found"
// again, as the server writes it.
function accordion(list: HTMLElement) {
  const set = (row: HTMLElement, open: boolean) => {
    const item = $('[data-slot="faq-item"]', row)
    const button = $('[data-slot="faq-question"]', row)
    const answer = $('[data-slot="faq-answer"]', row)
    if (!item || !button || !answer || (button.getAttribute("aria-expanded") === "true") === open) return
    button.setAttribute("aria-expanded", String(open))
    for (const element of [item, button, answer]) {
      element.toggleAttribute("data-expanded", open)
      element.toggleAttribute("data-closed", !open)
    }
    if (!open) return answer.setAttribute("hidden", "until-found")
    answer.removeAttribute("hidden")
    answer.style.setProperty("--kb-collapsible-content-height", `${answer.scrollHeight}px`)
  }
  list.addEventListener("click", (event) => {
    const button = target(event).closest<HTMLElement>('[data-slot="faq-question"]')
    const row = button?.closest("li")
    if (!button || !row) return
    list.toggleAttribute("data-ready", true)
    set(row, button.getAttribute("aria-expanded") !== "true")
  })
  list.addEventListener(
    "beforematch",
    (event) => {
      const row = (event.target as HTMLElement).closest("li")
      if (!row) return
      list.toggleAttribute("data-ready", true)
      set(row, true)
    },
    true,
  )
  // A link to a closed row (#boilerplate-…, or anything inside one) opens it.
  const reveal = () => {
    const found = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null
    const row = found?.closest<HTMLElement>('[data-slot="boilerplate-accordion"] > li')
    if (!row) return
    set(row, true)
    requestAnimationFrame(() => found?.scrollIntoView())
  }
  reveal()
  addEventListener("hashchange", reveal)
}

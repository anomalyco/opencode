import { $$, site } from "../dom"

/**
 * A product hero with a still per theme (product-hero.tsx, Browse's page): its inline script picked
 * the theme's files before first paint; this keeps every source on the page's theme as the theme
 * switch or the system setting changes it.
 */
export default function productHero(hero: HTMLElement) {
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
  }
  new MutationObserver(sync).observe(site, { attributes: true, attributeFilter: ["data-theme"] })
  system.addEventListener("change", sync)
}

import { $, $$, on, target } from "./dom"

// The site's accordion rows on the static pages (faq.tsx: /product's questions, the home page's
// feature list on phones, Press's boilerplate). Each answer is in the page, hidden="until-found"
// while closed, as the server writes it, so find-in-page opens it too. It grows open (faq-open in
// site.css) and goes at once (faq.css). In the phone feature list (phone-features.tsx) one row opens
// at a time.

/** Opens or closes a row (`[data-slot="faq-item"]`). */
export function setFaq(item: HTMLElement, open: boolean) {
  const button = $('[data-slot="faq-question"]', item)
  const answer = $('[data-slot="faq-answer"]', item)
  if (!button || !answer || (button.getAttribute("aria-expanded") === "true") === open) return
  const list = open && item.closest('[data-slot="accordion"]')
  if (list) $$('[data-slot="faq-item"]', list).forEach((other) => other !== item && setFaq(other, false))
  button.setAttribute("aria-expanded", String(open))
  for (const element of [item, button, answer]) {
    element.toggleAttribute("data-expanded", open)
    element.toggleAttribute("data-closed", !open)
  }
  if (!open) return answer.setAttribute("hidden", "until-found")
  answer.removeAttribute("hidden")
  answer.style.setProperty("--kb-collapsible-content-height", `${answer.scrollHeight}px`)
}

export function startFaq() {
  on("click", (event) => {
    const button = target(event).closest<HTMLElement>('[data-slot="faq-question"]')
    const item = button?.closest<HTMLElement>('[data-slot="faq-item"]')
    if (button && item) setFaq(item, button.getAttribute("aria-expanded") !== "true")
  })
  document.addEventListener(
    "beforematch",
    (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('[data-slot="faq-item"]')
      if (item) setFaq(item, true)
    },
    true,
  )
}

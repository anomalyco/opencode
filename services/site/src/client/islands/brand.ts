import { startDrawings } from "~/component/site/brand-drawings"
import { copied, copyUrl } from "../copy"
import { $, $$, reducedMotion, target } from "../dom"

/**
 * The Brand page (routes/brand/index.tsx) on a static page: its copy buttons (Rules for agent has an
 * island of its own, agent-rules.ts), the badges' sizes and styles, and the drawings fitted around their
 * labels and kept on whole pixels.
 */
export default function brand(page: HTMLElement) {
  startDrawings()
  badges(page)
  page.addEventListener("click", (event) => {
    const button = target(event).closest<HTMLElement>("button")
    if (!button) return
    // A swatch's HEX, RGB or OKLCH value.
    if (button.matches('[data-slot="format"]'))
      return void copied(
        button,
        () => navigator.clipboard.writeText($('[data-slot="value"]', button)?.textContent ?? ""),
        $(":scope > [aria-live]", button),
      )
    // An asset's SVG.
    const url = button.matches('[data-slot="copy-square"]') && button.dataset.url
    if (url)
      void copied(button, () => copyUrl(url), $(":scope > [aria-live]", button.closest('[data-slot="actions"]')!))
  })
}

/**
 * The badges: one size and one style for every card in both groups, chosen with the size buttons in a
 * preview's corner and the style tabs (a tablist with a sliding underline), the arrow keys moving and
 * choosing in either. A change loads the files it will show first, then swaps every preview with a
 * short scale and fade; each card's download and Copy Markdown follow. Each card has its files and
 * labels in its markup with the style and size left out (BadgeCard).
 */
function badges(page: HTMLElement) {
  const tabs = $$('[data-slot="style-tabs"] [role="tab"]', page)
  if (!tabs.length) return
  const styles = $$('[role="tab"]', tabs[0].parentElement!).map((tab) => ({
    id: tab.dataset.id!,
    name: tab.textContent!.trim().toLowerCase(),
    sizes: tab.dataset.sizes!.split(" ").map(Number),
  }))
  const sizes = [20, 32, 44]
  const cards = $$('[data-component="badges"] [data-slot="badge-grid"] > li', page).map((card) => ({
    templates: card.dataset,
    preview: $('[data-slot="preview"]', card)!,
    sizes: $('[data-slot="sizes"]', card)!,
    image: $<HTMLImageElement>('[data-slot="preview"] img', card)!,
    zip: $<HTMLAnchorElement>('[data-slot="badge-actions"] a', card)!,
    copy: $('[data-slot="copy-square"]', card)!,
  }))
  const state = { size: 20, style: styles[0].id }
  const chosen = (style = state.style, size = state.size) => {
    const item = styles.find((each) => each.id === style)!
    return { ...item, size: item.sizes.includes(size) ? size : item.sizes[0] }
  }
  const fill = (template = "", style = chosen()) =>
    template
      .replaceAll("{{id}}", style.id)
      .replaceAll("{{style}}", style.name)
      .replaceAll("{{size}}", String(style.size))

  const show = () => {
    const style = chosen()
    cards.forEach((card) => {
      const src = fill(card.templates.src)
      const previous = { src: card.image.getAttribute("src"), size: Number(card.image.getAttribute("height")) }
      card.preview.dataset.badge = style.id
      // Only when it is out: moving it would take the focus off its buttons.
      if (style.sizes.length > 1 && !card.sizes.isConnected) card.preview.prepend(card.sizes)
      if (style.sizes.length < 2) card.sizes.remove()
      card.image.src = src
      card.image.setAttribute("height", String(style.size))
      card.image.alt = fill(card.templates.alt)
      card.zip.href = fill(card.templates.zip)
      card.zip.download = card.zip.pathname.split("/").pop()!
      card.zip.setAttribute("aria-label", fill(card.templates.zipLabel))
      card.copy.setAttribute("aria-label", fill(card.templates.copyLabel))
      if (previous.src === src || reducedMotion()) return
      card.image.animate(
        [
          { transform: `scale(${previous.size / style.size})`, opacity: 0.4 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      )
    })
    $$('[data-slot="sizes"]', page).forEach((group) =>
      $$("button", group).forEach((button, index) => {
        button.setAttribute("aria-pressed", String(sizes[index] === state.size))
        button.tabIndex = sizes[index] === state.size ? 0 : -1
      }),
    )
    tabs.forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.id === state.style))
      tab.tabIndex = tab.dataset.id === state.style ? 0 : -1
    })
    requestAnimationFrame(place)
  }
  // Loads every badge file the change will show before making it, so the swap never shows a blank
  // tile while a file downloads.
  const choose = async (next: { size?: number; style?: string }) => {
    await Promise.all(
      styles
        .filter((style) => !next.style || style.id === next.style)
        .flatMap((style) =>
          cards.map((card) => {
            const image = new Image()
            image.src = fill(card.templates.src, chosen(style.id, next.size ?? state.size))
            return image.decode().catch(() => undefined)
          }),
        ),
    )
    Object.assign(state, next)
    show()
  }
  // The "underline" style's line, under the chosen tab's text.
  const place = () =>
    $$('[data-slot="style-tabs"]', page).forEach((list) => {
      const tab = $('[aria-selected="true"]', list)
      const indicator = $('[data-slot="tab-indicator"]', list)
      if (!tab || !indicator) return
      indicator.style.width = `${tab.offsetWidth}px`
      indicator.style.transform = `translate(${tab.offsetLeft}px, ${tab.offsetTop + tab.offsetHeight - 2}px)`
    })
  // It also runs when it starts observing, which puts the line under the first style.
  const observer = new ResizeObserver(place)
  $$('[data-slot="style-tabs"]', page).forEach((list) => observer.observe(list))

  const control = '[data-slot="sizes"] button, [data-slot="style-tabs"] [role="tab"]'
  const pick = (button: HTMLElement, index: number) =>
    void choose(button.dataset.id ? { style: styles[index].id } : { size: sizes[index] })
  page.addEventListener("click", (event) => {
    const button = target(event).closest<HTMLElement>(control)
    if (button) return pick(button, $$("button", button.parentElement!).indexOf(button))
    // Copy Markdown: the card's badge as it shows.
    const card = cards.find((item) => item.copy.contains(target(event)))
    if (card)
      void copied(
        card.copy,
        () => navigator.clipboard.writeText(fill(card.templates.copyText)),
        $(":scope > [aria-live]", card.copy.parentElement!),
      )
  })
  page.addEventListener("keydown", (event) => {
    const button = target(event).closest<HTMLElement>(control)
    if (!button || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return
    event.preventDefault()
    // As inlineKey (lib/direction.ts), which this module doesn't import: it is in the app's shared chunk.
    const forward = (event.key === "ArrowRight") === (getComputedStyle(page).direction !== "rtl")
    const buttons = $$("button", button.parentElement!)
    const index = (buttons.indexOf(button) + (forward ? 1 : -1) + buttons.length) % buttons.length
    buttons[index].focus()
    pick(button, index)
  })
}

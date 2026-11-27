/**
 * Closing a tab with the mouse keeps the other tabs at their widths while the pointer stays on the strip, as Chrome
 * does, so the next tab's close button slides under the pointer. Closing the last tab widens the rest by its share
 * instead, which puts the new last tab's close button there. Leaving the strip, opening or moving a tab, or closing one
 * any other way lets the tabs fill the strip again.
 */
export const createTabStripWidths = (el: HTMLElement) => {
  let closing: { tab: Element; widths: Map<HTMLElement, number> } | undefined

  // Every child but the sticky "+" is a tab.
  const tabs = () =>
    Array.from(el.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && !child.classList.contains("sticky"),
    )

  const release = () => {
    closing = undefined
    tabs().forEach((tab) => tab.style.removeProperty("flex"))
  }

  // Measured before the close runs, while the closing tab is still laid out.
  const onClick = (event: MouseEvent) => {
    const target = event.target

    if (!(target instanceof Element)) return

    // A click the keyboard sent on a close button has no click count.
    const close =
      event.type === "auxclick"
        ? event.button === 1
        : event.detail > 0 && !!target.closest('[data-slot="tabs-trigger-close-button"]')

    if (!close) return

    const all = tabs()
    const tab = all.find((child) => child.contains(target))

    if (!tab) return

    const rest = all.filter((child) => child !== tab)
    const total = rest.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0)

    const extra =
      tab === all.at(-1) && total > 0
        ? tab.getBoundingClientRect().width + (Number.parseFloat(getComputedStyle(el).columnGap) || 0)
        : 0

    closing = {
      tab,
      widths: new Map(
        rest.map((child) => {
          const width = child.getBoundingClientRect().width

          return [child, width + (extra * width) / total]
        }),
      ),
    }
  }

  const observer = new MutationObserver((records) => {
    const added = records.some((record) => Array.from(record.addedNodes).some((node) => node instanceof Element))

    if (added || !closing || el.contains(closing.tab)) return release()

    closing.widths.forEach((width, tab) => tab.style.setProperty("flex", `0 0 ${width}px`))
    closing = undefined
  })

  el.addEventListener("click", onClick, { capture: true })
  el.addEventListener("auxclick", onClick, { capture: true })
  el.addEventListener("pointerleave", release)
  observer.observe(el, { childList: true })

  return () => {
    el.removeEventListener("click", onClick, { capture: true })
    el.removeEventListener("auxclick", onClick, { capture: true })
    el.removeEventListener("pointerleave", release)
    observer.disconnect()
  }
}

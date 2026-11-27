/**
 * Closing a tab with the mouse holds the strip at the tabs' width while the pointer stays on it, as Chrome does, so
 * the next tab's close button slides under the pointer. The hold is end padding that takes the closed tab's place;
 * closing the last tab keeps it as it is, so the tabs before it fill that place and the new last close button lands
 * under the pointer. Leaving the strip, resizing it, opening or moving a tab, or closing one any other way lets the
 * tabs fill the strip again. An overflowing strip scrolls instead, so it is never held.
 */
export const createTabStripWidths = (el: HTMLElement) => {
  let closing: { tab: Element; hold: number } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let width = el.offsetWidth

  const release = () => {
    closing = undefined
    el.style.removeProperty("padding-inline-end")
  }

  // Measured before the close runs, while the closing tab is still laid out.
  const onClick = (event: MouseEvent) => {
    const target = event.target

    // Only this click's close may apply a hold measured for it.
    closing = undefined

    if (!(target instanceof Element)) return

    // Touch and pen leave the strip before their click, which would hold it until the next mouse visit.
    if (event instanceof PointerEvent && event.pointerType !== "mouse") return

    // A click the keyboard sent on a close button has no click count.
    const close =
      event.type === "auxclick"
        ? event.button === 1
        : event.detail > 0 && !!target.closest('[data-slot="tabs-trigger-close-button"]')

    if (!close || el.scrollWidth > el.clientWidth) return

    // Every child but the sticky "+" is a tab.
    const tabs = Array.from(el.children).filter((child) => !child.classList.contains("sticky"))
    const tab = tabs.find((child) => child.contains(target))

    if (!tab) return

    const held = Number.parseFloat(el.style.paddingInlineEnd) || 0

    const freed =
      tab === tabs.at(-1)
        ? 0
        : tab.getBoundingClientRect().width + (Number.parseFloat(getComputedStyle(el).columnGap) || 0)

    closing = { tab, hold: Math.max(0, Math.floor(held + freed)) }

    // A click that closes nothing, such as a middle click on a pinned tab, holds nothing. The close and its mutation
    // record land before the next task.
    clearTimeout(timer)
    timer = setTimeout(() => (closing = undefined))
  }

  const observer = new MutationObserver((records) => {
    const added = records.some((record) => Array.from(record.addedNodes).some((node) => node instanceof Element))

    if (added || !closing || el.contains(closing.tab)) return release()

    el.style.setProperty("padding-inline-end", `${closing.hold}px`)
    closing = undefined
  })

  // The border box, so the hold's own padding never releases it.
  const resize = new ResizeObserver(() => {
    if (el.offsetWidth === width) return
    width = el.offsetWidth
    release()
  })

  el.addEventListener("click", onClick, { capture: true })
  el.addEventListener("auxclick", onClick, { capture: true })
  el.addEventListener("pointerleave", release)
  el.addEventListener("pointercancel", release)
  window.addEventListener("blur", release)
  observer.observe(el, { childList: true })
  resize.observe(el, { box: "border-box" })

  return () => {
    el.removeEventListener("click", onClick, { capture: true })
    el.removeEventListener("auxclick", onClick, { capture: true })
    el.removeEventListener("pointerleave", release)
    el.removeEventListener("pointercancel", release)
    window.removeEventListener("blur", release)
    observer.disconnect()
    resize.disconnect()
    clearTimeout(timer)
    release()
  }
}

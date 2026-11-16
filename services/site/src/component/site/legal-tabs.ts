// The legal pages' Document and History tabs, shared with the static pages' script
// (src/client/islands/legal.ts), which drives them there.

/** Whether an address fragment is History or one of its parts: a version, or what changed. */
export const inHistory = (hash: string) =>
  hash === "#history" || hash === "#history-changes" || hash.startsWith("#version-")

/**
 * Where the page scrolls to keep a pinned tab bar pinned with the view under it starting at its top,
 * or undefined when the bar is not pinned. The bar's place in the flow is read from the view after
 * it, since a pinned (sticky) bar reports where it is drawn.
 */
export function pinnedScroll(tabs: HTMLElement) {
  const panel = [...(tabs.parentElement?.children ?? [])].find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && !element.hidden && !!(tabs.compareDocumentPosition(element) & 4),
  )
  if (!panel) return undefined
  const style = getComputedStyle(tabs)
  const top = parseFloat(style.top)
  const flow = panel.getBoundingClientRect().top - parseFloat(style.marginBottom) - tabs.offsetHeight
  return flow < top - 0.5 ? flow + window.scrollY - top : undefined
}

/** Scrolls the tab row sideways, never the page, to show a tab cut off at its edges. */
export function revealTab(tab: HTMLElement) {
  const list = tab.parentElement
  if (!list) return
  const item = tab.getBoundingClientRect()
  const box = list.getBoundingClientRect()
  if (item.left < box.left) list.scrollLeft -= box.left - item.left
  if (item.right > box.right) list.scrollLeft += item.right - box.right
}

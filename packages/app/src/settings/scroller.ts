/** The element that scrolls a settings page: the whole settings view in the wide layout, the page's own panel in the narrow one. */
export function settingsScroller(panel: HTMLElement) {
  if (getComputedStyle(panel).overflowY !== "visible") return panel

  return panel.closest<HTMLElement>(".settings") ?? panel
}

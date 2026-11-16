// The search shortcut, with no Solid, so the hydrated pages (search.tsx, search-palette.tsx), the static
// pages (src/client/entry.ts) and the docs (src/docs/client.ts) open search on the same keys.

/** ⌘K or Ctrl+K anywhere, or "/" outside text fields. */
export function isSearchShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.repeat) return false
  const target = event.target as HTMLElement
  if (target.closest?.("[contenteditable]")) return false
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") return true
  return event.key === "/" && !event.metaKey && !event.ctrlKey && !target.closest?.("input, textarea, select")
}

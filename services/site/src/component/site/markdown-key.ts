/**
 * Session storage key: whether the reader has the Markdown view on, so a reload or the next page keeps
 * it. On its own, so the static pages' Markdown view (src/client/overlays/markdown.tsx) reads it
 * without use-markdown.ts's language context.
 */
export const markdownKey = "opencode-markdown-view"

/**
 * The keydown listener for the Markdown view's shortcut, "m" then "d" (Site, and src/client/entry.ts
 * on the static pages): "m" starts loading the view, and "d" within 600ms toggles it, reported to the
 * funnel's queue (lib/funnel.ts) as the switch reports its own clicks. Not while typing or with a
 * modifier.
 */
export function markdownShortcut(view: { prefetch: () => void; toggle: () => void; shown: () => boolean }) {
  let last = { key: "", time: 0 }
  return (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
    if ((event.target as Element).closest?.("input, textarea, select, [contenteditable]")) return
    const key = event.key.toLowerCase()
    if (key === "m") view.prefetch()
    const quick = last.key === "m" && event.timeStamp - last.time < 600
    last = { key, time: event.timeStamp }
    if (key !== "d" || !quick) return
    last = { key: "", time: 0 }
    window.__ocFunnel?.push({
      event: {
        name: "ui.clicked",
        action: "clicked",
        target: `markdown-view:${view.shown() ? "off" : "on"}`,
        properties: { via: "shortcut" },
      },
      at: performance.now(),
    })
    view.toggle()
  }
}

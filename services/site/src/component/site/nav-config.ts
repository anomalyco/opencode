import { siteLinks } from "./links"

// The primary nav's ordering and pre-paint rules, apart from nav-order.tsx (a component with its
// styles) so the pre-paint script (preload-settings.ts) and its test can import them.

type NavFlags = { id: string; company?: boolean }

/**
 * The items in the list's order. Settings › Nav groups "grouped" puts Anomaly's products after the
 * open source links. Returns the given items (the same objects), so a reorder moves them in place.
 * The pre-paint script inlines this function as source, so it may only use its arguments.
 */
export function navSequence<T extends NavFlags>(
  items: readonly T[],
  config: readonly { id: string }[],
  grouped: boolean,
) {
  const rank = (item: T) => {
    const index = config.findIndex((entry) => entry.id === item.id)
    return index < 0 ? config.length + items.indexOf(item) : index
  }
  const sorted = [...items].sort((a, b) => rank(a) - rank(b))
  if (!grouped) return sorted
  return [...sorted.filter((item) => !item.company), ...sorted.filter((item) => item.company)]
}

/**
 * The pre-paint rules for a saved list. The server renders every item in the default list, so this
 * sets each one's flex `order`, shows or hides it (or a removed one), numbers the shown ones (the numbers are drawn
 * from `data-n`, so CSS can set them) and swaps in a renamed label (a spare span that shows it).
 * The pre-paint script inlines this function as source, so it may only use its arguments.
 */
export function navConfigRules(
  normalize: (defaults: readonly { id: string; visible: boolean }[], saved: unknown) => NavEntryLike[],
  sequence: typeof navSequence,
  defaults: readonly { id: string; visible: boolean }[],
  items: readonly NavFlags[],
  s: { navConfig?: unknown; navGroups?: unknown },
) {
  const config = normalize(defaults, s.navConfig)
  const plain = defaults.map((item) => ({ id: item.id, visible: item.visible }))
  const same =
    config.length === plain.length &&
    config.every(
      (entry, index) =>
        entry.id === plain[index].id && entry.visible === plain[index].visible && !entry.label && !entry.removed,
    )
  if (same) return ""
  const grouped = s.navGroups === "grouped"
  const order = sequence(items, config, grouped)
  const entry = (id: string) => config.find((item) => item.id === id)
  const visible = (id: string) => !!entry(id)?.visible && !entry(id)?.removed
  const shown = order.filter((item) => visible(item.id))
  const scope = (id: string) => 'html [data-site] li[data-nav-id="' + id + '"]'
  // Renamed labels are English text, so they only replace the English labels.
  const english = (id: string) => 'html[data-locale="en"] [data-site] li[data-nav-id="' + id + '"]'
  const text = (value: string) => '"' + value.replace(/[\\"]/g, "\\$&").replace(/\n/g, " ") + '"'
  const group = order.findIndex((item) => item.company && visible(item.id))
  return (
    order
      .map((item, index) => {
        const current = entry(item.id)
        const show = visible(item.id)
        const label = current?.label
        return (
          scope(item.id) +
          "{order:" +
          (index * 2 + 2) +
          ";display:" +
          (show ? "list-item" : "none") +
          "}" +
          (show ? scope(item.id) + ' [data-slot="number"]::before{content:"' + (shown.indexOf(item) + 1) + '"}' : "") +
          (label
            ? english(item.id) +
              ' [data-slot="label"]{display:none}' +
              english(item.id) +
              ' [data-slot="label-preload"]{display:inline}' +
              english(item.id) +
              ' [data-slot="label-preload"]::before{content:' +
              text(label) +
              "}"
            : "")
        )
      })
      .join("") + (grouped && group >= 0 ? 'html [data-site] li[data-slot="group"]{order:' + (group * 2 + 1) + "}" : "")
  )
}

type NavEntryLike = { id: string; visible: boolean; label?: string; href?: string; removed?: boolean }

/** The nav items' ids and groups, for the pre-paint script (labels and links don't matter there). */
export const navFlags = siteLinks(
  (key) => key,
  (path) => path,
).nav.map((item) => ({ id: item.id, company: "company" in item }))

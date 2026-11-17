/**
 * Where a key moves the active row of the site list, which has `count` rows and shows `page` of them at once:
 * Up and Down by one, PageUp and PageDown by a page, Home and End to the ends. Moves stop at the ends, as a listbox's
 * do. Undefined for another key, or an empty list.
 */
export function siteListMove(key: string, index: number, count: number, page: number) {
  if (count === 0) return undefined
  const last = count - 1

  const target = new Map([
    ["ArrowDown", index + 1],
    ["ArrowUp", index - 1],
    ["PageDown", index + Math.max(1, page)],
    ["PageUp", index - Math.max(1, page)],
    ["Home", 0],
    ["End", last],
  ]).get(key)

  return target === undefined ? undefined : Math.min(last, Math.max(0, target))
}

/**
 * Type-ahead: the first site at or after `from` whose name starts with what was typed, wrapping to the top; undefined
 * when none does. A repeat of one letter steps through the sites that start with it, as a listbox's type-ahead does.
 */
export function siteTypeAhead(sites: readonly string[], from: number, typed: string) {
  const text = typed.toLowerCase()
  const repeated = text.length > 1 && [...text].every((letter) => letter === text[0])
  const prefix = repeated ? text[0] ?? "" : text
  const start = repeated || text.length === 1 ? from + 1 : from
  const order = [...sites.keys()].map((offset) => (start + offset) % Math.max(1, sites.length))
  const found = order.find((index) => sites[index]?.startsWith(prefix))

  return prefix ? found : undefined
}

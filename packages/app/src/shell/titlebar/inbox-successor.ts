/**
 * The row to open after `key` leaves the inbox: the nearest one below it in `keys`, the list as it showed before the
 * row left, or the nearest one above when nothing below is left.
 */
export function inboxSuccessor(keys: readonly string[], key: string, available: (key: string) => boolean) {
  const index = keys.indexOf(key)

  if (index === -1) return undefined

  return keys.slice(index + 1).find(available) ?? keys.slice(0, index).findLast(available)
}

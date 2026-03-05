/**
 * Whether the access list grants access to all Later employees.
 *
 * The wildcard "*" in the list means everyone has access.
 */
export function hasAllAccess(list: string[]): boolean {
  return list.includes("*")
}

/**
 * Returns a new list with the "*" wildcard added (if not already present).
 */
export function addAllAccess(list: string[]): string[] {
  if (list.includes("*")) return list
  return [...list, "*"]
}

/**
 * Returns a new list with the "*" wildcard removed.
 */
export function removeAllAccess(list: string[]): string[] {
  return list.filter((u) => u !== "*")
}

/**
 * Filters out the "*" wildcard so it does not render as a user chip.
 */
export function filterDisplayUsers(list: string[]): string[] {
  return list.filter((u) => u !== "*")
}

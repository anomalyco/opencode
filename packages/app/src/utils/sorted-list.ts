export const compareID = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export const compareByID = <T extends { id: string }>(a: T, b: T) => compareID(a.id, b.id)

export function mergeByID<T extends { id: string }>(current: readonly T[], incoming: readonly T[]) {
  return [...new Map([...current, ...incoming].map((item) => [item.id, item] as const)).values()].sort(compareByID)
}

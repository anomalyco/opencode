/** Find the longest common character prefix between two strings. */
export function commonPrefix(a: string, b: string) {
  const ac = Array.from(a)
  const bc = Array.from(b)
  let i = 0
  while (i < ac.length && i < bc.length && ac[i] === bc[i]) i++
  return {
    prefix: ac.slice(0, i).join(""),
    aSuffix: ac.slice(i).join(""),
    bSuffix: bc.slice(i).join(""),
  }
}

export function list<T>(value: T[] | undefined | null, fallback: T[]): T[] {
  if (Array.isArray(value)) return value
  return fallback
}

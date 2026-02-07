export namespace Binary {
  export function search<T>(array: T[], id: string, compare: (item: T) => string): { found: boolean; index: number } {
    let left = 0
    let right = array.length - 1

    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const midId = compare(array[mid])

      if (midId === id) {
        return { found: true, index: mid }
      } else if (midId < id) {
        left = mid + 1
      } else {
        right = mid - 1
      }
    }

    return { found: false, index: left }
  }

  export function insert<T>(array: T[], item: T, compare: (item: T) => string): T[] {
    const id = compare(item)
    let left = 0
    let right = array.length

    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      const midId = compare(array[mid])

      if (midId < id) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    array.splice(left, 0, item)
    return array
  }

  /**
   * Find the first index where array[index] >= target (lower bound).
   * For string arrays ordered lexicographically (e.g., ULIDs).
   */
  export function lowerBound(array: string[], target: string): number {
    let left = 0
    let right = array.length
    while (left < right) {
      const mid = (left + right) >>> 1
      if (array[mid] < target) left = mid + 1
      else right = mid
    }
    return left
  }
}

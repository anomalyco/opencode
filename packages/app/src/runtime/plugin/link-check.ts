import { createComputed, untrack, type Accessor } from "solid-js"

/**
 * Asks whether a link's file exists only while its timeline is selected. Plugins check links for the selected
 * session alone, so a hidden timeline's answer would be a false negative: a check asked while hidden, or one that
 * comes back negative after the timeline was hidden, even briefly, waits and asks again once it is selected.
 */
export function createLinkCheck(active: Accessor<boolean>, check: (href: string) => boolean | Promise<boolean>) {
  let waiting: (() => void)[] = []
  let hidden = 0

  createComputed(() => {
    if (!active()) {
      hidden++

      return
    }

    const ready = waiting
    waiting = []
    ready.forEach((resolve) => resolve())
  })

  const exists = (href: string): boolean | Promise<boolean> => {
    if (!untrack(active)) return new Promise<void>((resolve) => waiting.push(resolve)).then(() => exists(href))
    const started = hidden
    const result = untrack(() => check(href))

    if (result === true || result === false) return result

    return result.then((found) => (found || (untrack(active) && hidden === started) ? found : exists(href)))
  }

  return exists
}

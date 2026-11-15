export type SearchListMove = "next" | "previous" | "nextSection" | "previousSection" | "first" | "last"

/** The move a key asks of a search list, or nothing when the key belongs to the input. */
export function searchListMove(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">) {
  if (event.shiftKey || event.ctrlKey) return

  const section = event.metaKey || event.altKey

  if (event.key === "ArrowDown") return section ? "nextSection" : "next"

  if (event.key === "ArrowUp") return section ? "previousSection" : "previous"

  if (section) return

  if (event.key === "Home") return "first"

  if (event.key === "End") return "last"
}

/**
 * The row a move lands on, given each row's section key. Arrows wrap. A section move lands on a section's first row:
 * up goes to the start of the current section first, as a paragraph jump does, then to the previous one.
 */
export function searchListTarget(sections: string[], index: number, move: SearchListMove) {
  const count = sections.length

  if (count === 0) return -1

  if (move === "first") return 0

  if (move === "last") return count - 1

  if (move === "next") return (index + 1) % count

  if (move === "previous") return index <= 0 ? count - 1 : index - 1

  const start = (at: number) => {
    const found = sections.slice(0, at + 1).findLastIndex((key, i) => i === 0 || sections[i - 1] !== key)

    return Math.max(found, 0)
  }

  const current = start(Math.max(index, 0))

  if (move === "previousSection") {
    if (index > current) return current

    return current === 0 ? start(count - 1) : start(current - 1)
  }

  const next = sections.findIndex((key, i) => i > current && key !== sections[current])

  return next === -1 ? 0 : next
}

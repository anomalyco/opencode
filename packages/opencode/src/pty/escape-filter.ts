const CLEAR_SCROLLBACK = "\u001b[3J"

export function containsClearScrollbackSequence(data: string) {
  return data.includes(CLEAR_SCROLLBACK)
}

export function extractContentAfterClear(data: string) {
  const index = data.lastIndexOf(CLEAR_SCROLLBACK)
  if (index === -1) return data
  return data.slice(index + CLEAR_SCROLLBACK.length)
}

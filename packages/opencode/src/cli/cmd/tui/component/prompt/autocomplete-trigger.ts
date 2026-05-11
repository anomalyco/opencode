export function mentionTriggerIndex(text: string) {
  const idx = text.lastIndexOf("@")
  if (idx === -1) return

  const before = text.slice(0, idx)
  const between = text.slice(idx)
  if (between.match(/\s/)) return
  if (before && !before.match(/\s$/)) return

  return Bun.stringWidth(before)
}

export function adjacentTabKey(order: string[], current: string | undefined, offset: -1 | 1) {
  if (!current || order.length === 0) return
  const index = order.indexOf(current)
  if (index === -1) return
  return order[(index + offset + order.length) % order.length]
}

export function mergeVisibleTabOrder(all: string[], current: string[], next: string[]) {
  const visible = new Set(current)
  const reordered = next.values()
  return all.map((key) => (visible.has(key) ? (reordered.next().value ?? key) : key))
}

export function moveVisibleTab(all: string[], visible: string[], current: string | undefined, offset: -1 | 1) {
  if (!current) return
  const index = visible.indexOf(current)
  const nextIndex = index + offset
  if (index === -1 || nextIndex < 0 || nextIndex >= visible.length) return
  const reordered = [...visible]
  reordered.splice(index, 1)
  reordered.splice(nextIndex, 0, current)
  return mergeVisibleTabOrder(all, visible, reordered)
}

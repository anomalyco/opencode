export function resolveListSelection<T>(items: T[], activeKey: string | null, keyOf: (item: T) => string) {
  const selected = items.find((item) => keyOf(item) === activeKey)
  const index = selected ? items.indexOf(selected) : -1
  return { selected, index }
}

export function dispatchListKeyEvent<T>(
  event: KeyboardEvent,
  items: T[],
  activeKey: string | null,
  keyOf: (item: T) => string,
  onKeyEvent: ((event: KeyboardEvent, item: T | undefined) => void) | undefined,
) {
  const { selected, index } = resolveListSelection(items, activeKey, keyOf)
  onKeyEvent?.(event, selected)
  return { selected, index }
}

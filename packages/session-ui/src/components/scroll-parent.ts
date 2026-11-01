export function scrollParent(element: HTMLElement): HTMLElement | undefined {
  const parent = element.parentElement

  if (!parent) return

  if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent

  return scrollParent(parent)
}

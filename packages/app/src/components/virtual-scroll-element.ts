export function virtualScrollElement(root: HTMLElement | undefined) {
  if (!root?.isConnected) return null
  return root.closest<HTMLDivElement>(".scroll-view__viewport")
}

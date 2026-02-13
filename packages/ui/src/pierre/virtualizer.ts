type VirtualMetrics = {
  lineHeight: number
  hunkSeparatorHeight: number
  fileGap: number
}

export const virtualMetrics: Partial<VirtualMetrics> = {
  lineHeight: 24,
  hunkSeparatorHeight: 24,
  fileGap: 0,
}

export function acquireVirtualizer(_container: HTMLElement) {
  return
}

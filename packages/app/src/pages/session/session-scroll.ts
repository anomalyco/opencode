import type { SessionScroll } from "@/context/layout-scroll"

const DEFAULT_BOTTOM_THRESHOLD = 10

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

export function shouldResumeSessionAutoScroll(input: {
  locationHash: string
  messageId?: string
  pendingMessage?: string
  savedScroll?: SessionScroll
}) {
  if (input.locationHash) return false
  if (input.messageId || input.pendingMessage) return false
  return input.savedScroll === undefined
}

export function restoreSessionScrollPosition(input: {
  savedScroll?: SessionScroll
  clientWidth: number
  clientHeight: number
  scrollWidth: number
  scrollHeight: number
  bottomThreshold?: number
}) {
  const saved = input.savedScroll
  if (!saved) return undefined

  const maxX = Math.max(0, input.scrollWidth - input.clientWidth)
  const maxY = Math.max(0, input.scrollHeight - input.clientHeight)
  const x = clamp(saved.x, 0, maxX)
  const y = clamp(saved.y, 0, maxY)

  return {
    x,
    y,
    awayFromBottom: maxY - y > (input.bottomThreshold ?? DEFAULT_BOTTOM_THRESHOLD),
  }
}

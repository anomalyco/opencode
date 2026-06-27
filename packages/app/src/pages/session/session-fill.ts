/**
 * Determines whether the fill mechanism should trigger loading older messages.
 * Used when the scroll viewport is not fully filled with content.
 *
 * Returns true when:
 * - There is more history to load, AND
 * - Either the viewport is not full (scrollHeight <= clientHeight + 1), OR
 *   the message count is small (<= 2, to handle session switch scenarios)
 */
export function shouldFillLoad(input: {
  historyMore: boolean
  scrollHeight: number
  clientHeight: number
  messageCount: number
}): boolean {
  if (!input.historyMore) return false
  if (input.scrollHeight > input.clientHeight + 1 && input.messageCount > 2) return false
  return true
}

/**
 * Determines whether scrolling near the top of the timeline should trigger
 * loading older messages. Used as a guard in the scroll event handler.
 *
 * Returns true when:
 * - The scroll position is near the top (scrollTop < 200), AND
 * - There is more history to load, AND
 * - History is not currently loading
 */
export function shouldScrollLoad(input: {
  scrollTop: number
  historyMore: boolean
  historyLoading: boolean
}): boolean {
  if (input.scrollTop >= 200) return false
  if (!input.historyMore || input.historyLoading) return false
  return true
}
let scrollTo: ((messageID: string) => void) | undefined

export function setScrollToMessage(fn: ((messageID: string) => void) | undefined) {
  scrollTo = fn
}

export function scrollToMessage(messageID: string) {
  scrollTo?.(messageID)
}

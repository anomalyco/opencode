export function createHistoryPrepend(input: {
  sessionID: () => string
  more: (sessionID: string) => boolean
  loadMore: (sessionID: string) => Promise<void>
  height: () => number
  afterLayout: (continuation: () => void) => void
  active: (sessionID: string) => boolean
  scrollBy: (amount: number) => void
}) {
  let loading = false

  return (scrollBy = 0, continuation?: () => void) => {
    const sessionID = input.sessionID()
    if (loading || !input.more(sessionID)) return false
    loading = true
    const before = input.height()
    void input.loadMore(sessionID).then(
      () =>
        input.afterLayout(() => {
          loading = false
          if (!input.active(sessionID)) return
          input.scrollBy(input.height() - before + scrollBy)
          continuation?.()
        }),
      () => {
        loading = false
      },
    )
    return true
  }
}

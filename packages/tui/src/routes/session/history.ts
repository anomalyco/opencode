export function createHistoryPrepend(input: {
  sessionID: () => string
  more: (sessionID: string) => boolean
  loadMore: (sessionID: string) => Promise<void>
  height: () => number
  afterLayout: (continuation: () => void) => void
  active: (sessionID: string) => boolean
  scrollBy: (amount: number) => void
}) {
  let pending: { scrollBy: number; continuation?: () => void; after?: () => void } | undefined

  return Object.assign(
    (scrollBy = 0, continuation?: () => void) => {
      const sessionID = input.sessionID()
      if (pending) {
        if (continuation || (!pending.scrollBy && scrollBy)) {
          pending.scrollBy = scrollBy
          pending.continuation = continuation
          return true
        }
        return false
      }
      if (!input.more(sessionID)) return false
      const current = { scrollBy, continuation }
      pending = current
      const before = input.height()
      void input.loadMore(sessionID).then(
        () =>
          input.afterLayout(() => {
            if (pending !== current) return
            const after = pending.after
            pending = undefined
            if (!input.active(sessionID)) return
            input.scrollBy(input.height() - before + current.scrollBy)
            current.continuation?.()
            after?.()
          }),
        () => {
          if (pending !== current) return
          const after = pending.after
          pending = undefined
          if (input.active(sessionID)) after?.()
        },
      )
      return true
    },
    {
      cancel() {
        if (!pending) return
        pending.continuation = undefined
        pending.after = undefined
      },
      after(continuation: () => void) {
        if (!pending) return continuation()
        // A jump supersedes deferred scrolling, but must wait for anchor compensation.
        pending.scrollBy = 0
        pending.after = continuation
      },
    },
  )
}

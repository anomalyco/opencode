const WINDOW_MS = 2_000

export function createQuickUndo<T>() {
  let submitted: { messageID: string; value: T; time: number } | undefined
  let escapedAt: number | undefined

  return {
    submitted(messageID: string, value: T, time = Date.now()) {
      submitted = { messageID, value, time }
      escapedAt = undefined
    },
    escape(time = Date.now()) {
      if (!submitted || time - submitted.time > WINDOW_MS) return
      if (escapedAt === undefined || time - escapedAt > WINDOW_MS) {
        escapedAt = time
        return
      }

      const result = { messageID: submitted.messageID, value: submitted.value }
      submitted = undefined
      escapedAt = undefined
      return result
    },
  }
}

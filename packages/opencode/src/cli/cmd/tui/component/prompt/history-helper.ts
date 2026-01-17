export type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: any[]
}

const MAX_HISTORY_ENTRIES = 50

export function createPromptHistoryStoreForTest(initialHistory: PromptInfo[] = []) {
  const store: { index: number; history: PromptInfo[] } = {
    index: 0,
    history: initialHistory.slice(),
  }

  return {
    resetIndex() {
      store.index = 0
    },

    move(direction: 1 | -1, input: string) {
      if (!store.history.length) return undefined

      if (input && input.length) {
        let idx = store.index
        while (true) {
          const next = idx + direction
          if (Math.abs(next) > store.history.length) break
          // When going down and reaching index 0, return the prefix as the "last" item
          if (next >= 0) {
            if (direction === 1) {
              store.index = 0
              return { input: input, parts: [] }
            }
            break
          }
          const candidate = store.history.at(next)
          if (!candidate) {
            idx = next
            continue
          }
          if (candidate.input.startsWith(input)) {
            store.index = next
            return candidate
          }
          idx = next
        }
        return
      }

      const current = store.history.at(store.index)
      if (!current) return undefined
      const next = store.index + direction
      if (Math.abs(next) <= store.history.length && next <= 0) {
        store.index = next
      }
      if (store.index === 0)
        return {
          input: "",
          parts: [],
        }
      return store.history.at(store.index)
    },

    append(item: PromptInfo) {
      const entry = JSON.parse(JSON.stringify(item))
      store.history.push(entry)
      if (store.history.length > MAX_HISTORY_ENTRIES) {
        store.history = store.history.slice(-MAX_HISTORY_ENTRIES)
      }
      store.index = 0
    },
  }
}

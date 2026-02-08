import { createContext, useContext, onCleanup, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"

export type ProgressLog = { message: string; time: number }

export type ProgressSource = {
  logs: ProgressLog[]
  subscribe(handler: (log: ProgressLog) => void): () => void
}

type ProgressContextValue = {
  logs: ProgressLog[]
  addLog: (message: string) => void
}

const ProgressContext = createContext<ProgressContextValue>({
  logs: [],
  addLog: () => {},
})

export function ProgressProvider(props: { source?: ProgressSource; children: JSX.Element }) {
  const [store, setStore] = createStore<{ logs: ProgressLog[] }>({
    logs: [...(props.source?.logs ?? [])],
  })

  const addLog = (message: string) => {
    setStore(
      "logs",
      produce((draft) => {
        draft.push({ message, time: Date.now() })
      }),
    )
  }

  // Subscribe immediately (not in onMount) to avoid missing events
  // between initial render and mount
  if (props.source) {
    const unsub = props.source.subscribe((log) => {
      setStore(
        "logs",
        produce((draft) => {
          draft.push(log)
        }),
      )
    })
    onCleanup(unsub)
  }

  const value: ProgressContextValue = {
    get logs() {
      return store.logs
    },
    addLog,
  }

  return <ProgressContext.Provider value={value}>{props.children}</ProgressContext.Provider>
}

export function useProgress() {
  return useContext(ProgressContext)
}

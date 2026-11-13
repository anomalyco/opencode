import { createStore, produce } from "solid-js/store"
import type { PersistentPtyInfo } from "@opencode/client"
import type { Storage } from "@opencode/plugin/gui"

export const info = (id: string, title: string, sessionID = "ses_1"): PersistentPtyInfo => ({
  id,
  title,
  userTitle: null,
  command: "/bin/zsh",
  args: [],
  cwd: "/repo",
  status: "running",
  pid: 1,
  sessionID,
  foregroundProcess: null,
  size: { cols: 80, rows: 24 },
  output: { head: 0, tail: 0 },
})

/** The two stores the model owns: its server inventory and the selected terminal. */
export function terminalStorage(remove: Storage["remove"]): Storage {
  return {
    memory(_key, { initial }) {
      const [value, set] = createStore(initial)

      return [value, (mutate) => set(produce(mutate))] as const
    },
    store(_key, { initial }) {
      const [value, set] = createStore({ value: initial })

      return {
        get value() {
          return value.value
        },
        ready: () => true,
        set: (next) => set("value", () => next),
        update: () => undefined,
      }
    },
    remove,
  }
}

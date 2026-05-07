import { createStore } from "solid-js/store"

const [data, setData] = createStore({
  session: [] as Array<{ id: string; parentID?: string }>,
  permission: {} as Record<string, Array<{ id: string; sessionID: string; permission: string; patterns: string[] }>>,
  question: {} as Record<string, Array<{ id: string; questions: unknown[] }>>,
  session_diff: {} as Record<string, Array<{ file: string }>>,
  message: {
    "story-session": [] as Array<{ id: string; role: string }>,
  } as Record<string, Array<{ id: string; role: string }>>,
  session_status: {} as Record<string, { type: "idle" | "busy" }>,
  agent: [{ name: "build", mode: "task", hidden: false }],
  command: [{ name: "fix", description: "Run fix command", source: "project" }],
})

export function useSync() {
  return {
    data,
    set(...input: unknown[]) {
      ;(setData as (...args: unknown[]) => void)(...input)
    },
    session: {
      get(id: string) {
        return { id }
      },
      optimistic: {
        add() {},
        remove() {},
      },
    },
  }
}

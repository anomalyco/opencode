import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { persisted } from "@/utils/persist"

export type WorktreeSession = {
  directory: string
  project: string
  branch?: string
  name?: string
}

export const { use: useWorktree, provider: WorktreeProvider } = createSimpleContext({
  name: "Worktree",
  init: () => {
    const [store, setStore, _, ready] = persisted(
      "worktree.v1",
      createStore({
        session: {} as Record<string, WorktreeSession>,
      }),
    )

    return {
      ready,
      get(sessionID: string) {
        return store.session[sessionID]
      },
      directory(sessionID: string) {
        return store.session[sessionID]?.directory
      },
      project(sessionID: string) {
        return store.session[sessionID]?.project
      },
      list(project?: string) {
        const directories = new Set<string>()
        const result: Array<WorktreeSession & { sessionID: string }> = []
        for (const [sessionID, session] of Object.entries(store.session)) {
          if (project && session.project !== project) continue
          if (directories.has(session.directory)) continue
          directories.add(session.directory)
          result.push({ sessionID, ...session })
        }
        result.sort((a, b) => (a.name ?? a.directory).localeCompare(b.name ?? b.directory))
        return result
      },
      set(sessionID: string, value: WorktreeSession) {
        setStore("session", sessionID, value)
      },
    }
  },
})

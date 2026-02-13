import type { SetStoreFunction } from "solid-js/store"
import type { ClaxedoLayoutStore } from "./types"

export function createWorkspaceRecency(input: {
  store: ClaxedoLayoutStore
  setStore: SetStoreFunction<ClaxedoLayoutStore>
}) {
  const { store, setStore } = input

  return {
    getRecent(projectId: string, limit = 5): string[] {
      const recency = store.workspaceRecency[projectId] ?? []
      return recency.slice(0, limit)
    },

    recordAccess(projectId: string, workspaceDir: string) {
      const current = store.workspaceRecency[projectId] ?? []
      const filtered = current.filter((dir) => dir !== workspaceDir)
      const updated = [workspaceDir, ...filtered]
      setStore("workspaceRecency", projectId, updated)
    },

    cleanup(projectId: string, validWorkspaces: string[]) {
      const current = store.workspaceRecency[projectId] ?? []
      const validSet = new Set(validWorkspaces)
      const cleaned = current.filter((dir) => validSet.has(dir))
      if (cleaned.length !== current.length) {
        setStore("workspaceRecency", projectId, cleaned)
      }
    },
  }
}

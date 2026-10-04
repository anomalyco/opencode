import type { Project } from "@opencode/schema/project"
import { useStorage } from "../context/storage"

type RecentDirectory = {
  directory: string
  usedAt: number
}

type PersistedState = {
  projects: Record<string, RecentDirectory[]>
}

export function useDirectoryRecents() {
  const [store, updateStore] = useStorage().store<PersistedState>("directory-recents", {
    initial: { projects: {} },
    key: "directory",
  })

  return {
    list(projectID: Project.ID) {
      return (store.projects[projectID] ?? []).toSorted((a, b) => b.usedAt - a.usedAt)
    },
    touch(projectID: Project.ID, directory: string) {
      void updateStore((draft) => {
        draft.projects[projectID] = [
          { directory, usedAt: Date.now() },
          ...(draft.projects[projectID] ?? []).filter((item) => item.directory !== directory),
        ].slice(0, 10)
      }).catch((error) => console.error("Failed to persist directory recents", error))
    },
    remove(projectID: Project.ID, directory: string) {
      void updateStore((draft) => {
        draft.projects[projectID] = (draft.projects[projectID] ?? []).filter((item) => item.directory !== directory)
      }).catch((error) => console.error("Failed to remove directory recent", error))
    },
  }
}

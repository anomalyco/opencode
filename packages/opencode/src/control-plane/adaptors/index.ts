import { lazy } from "@/util/lazy"
import type { ProjectID } from "@/project/schema"
import type { WorkspaceAdaptor, WorkspaceAdaptorEntry } from "../types"

const BUILTIN: Record<string, () => Promise<WorkspaceAdaptor>> = {
  worktree: lazy(async () => (await import("./worktree")).WorktreeAdaptor),
}

const state = new Map<ProjectID, Map<string, WorkspaceAdaptor>>()

export async function getAdaptor(projectID: ProjectID, type: string): Promise<WorkspaceAdaptor> {
  const custom = state.get(projectID)?.get(type)
  if (custom) return custom

  const builtin = BUILTIN[type]
  if (builtin) return builtin()

  throw new Error(`Unknown workspace adaptor: ${type}`)
}

export async function listAdaptors(projectID: ProjectID): Promise<WorkspaceAdaptorEntry[]> {
  const builtin = await Promise.all(
    Object.entries(BUILTIN).map(async ([type, init]) => {
      const adaptor = await init()
      return {
        type,
        name: adaptor.name,
        description: adaptor.description,
      }
    }),
  )
  const custom = [...(state.get(projectID)?.entries() ?? [])].map(([type, adaptor]) => ({
    type,
    name: adaptor.name,
    description: adaptor.description,
  }))
  return [...builtin, ...custom]
}

// Plugins can be loaded per-project so we need to scope them. If you
// want to install a global one pass `ProjectID.global`
export function registerAdaptor(projectID: ProjectID, type: string, adaptor: WorkspaceAdaptor) {
  const adaptors = state.get(projectID) ?? new Map<string, WorkspaceAdaptor>()
  adaptors.set(type, adaptor)
  state.set(projectID, adaptors)
}

import type { ProjectID } from "@/project/schema"
import type { WorkspaceAdapter, WorkspaceAdapterEntry } from "../types"
import { WorktreeAdapter } from "./worktree"

const BUILTIN: Record<string, WorkspaceAdapter> = {
  worktree: WorktreeAdapter,
}

const state = new Map<ProjectID, Map<string, WorkspaceAdapter>>()

export function getAdapter(projectID: ProjectID, type: string): WorkspaceAdapter {
  const custom = state.get(projectID)?.get(type)
  if (custom) return custom

  const builtin = BUILTIN[type]
  if (builtin) return builtin

  throw new Error(`Unknown workspace adapter: ${type}`)
}

export async function listAdapters(projectID: ProjectID): Promise<WorkspaceAdapterEntry[]> {
  const builtin = await Promise.all(
    Object.entries(BUILTIN).map(async ([type, adapter]) => {
      return {
        type,
        name: adapter.name,
        description: adapter.description,
      }
    }),
  )
  const custom = [...(state.get(projectID)?.entries() ?? [])].map(([type, adapter]) => ({
    type,
    name: adapter.name,
    description: adapter.description,
  }))
  return [...builtin, ...custom]
}

// Plugins can be loaded per-project so we need to scope them. If you
// want to install a global one pass `ProjectID.global`
export function registerAdapter(projectID: ProjectID, type: string, adapter: WorkspaceAdapter) {
  const adapters = state.get(projectID) ?? new Map<string, WorkspaceAdapter>()
  adapters.set(type, adapter)
  state.set(projectID, adapters)
}

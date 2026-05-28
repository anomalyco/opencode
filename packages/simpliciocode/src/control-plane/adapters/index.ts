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

export function listAdapters(projectID: ProjectID): WorkspaceAdapterEntry[] {
  return registeredAdapters(projectID).map(([type, adapter]) => ({
    type,
    name: adapter.name,
    description: adapter.description,
  }))
}

export function registeredAdapters(projectID: ProjectID): [string, WorkspaceAdapter][] {
  const adapters = new Map(Object.entries(BUILTIN))
  for (const [type, adapter] of state.get(projectID)?.entries() ?? []) adapters.set(type, adapter)
  return [...adapters.entries()]
}

// Plugins can be loaded per-project so we need to scope them. If you
// want to install a global one pass `ProjectID.global`
export function registerAdapter(projectID: ProjectID, type: string, adapter: WorkspaceAdapter) {
  const adapters = state.get(projectID) ?? new Map<string, WorkspaceAdapter>()
  adapters.set(type, adapter)
  state.set(projectID, adapters)
}

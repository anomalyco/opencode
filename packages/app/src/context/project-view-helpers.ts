import type { UiProjectView } from "@opencode-ai/sdk/v2/client"
import { getFilename } from "@opencode-ai/core/util/path"
import { pathKey } from "@/utils/path-key"

export type ProjectViewDirectoryAliases = ReadonlyMap<string, string>

export function projectViewDirectoryKey(directory: string) {
  return pathKey(directory)
}

export function projectViewEntryForDirectory(
  view: UiProjectView | undefined,
  directory: string,
  aliases?: ProjectViewDirectoryAliases,
) {
  const key = projectViewDirectoryKey(directory)
  const direct = projectViewEntryForKey(view, key)
  if (direct) return direct
  const targetKey = aliases?.get(key)
  if (!targetKey) return undefined
  return projectViewEntryForKey(view, targetKey)
}

export function shouldOpenProjectViewDirectory(input: {
  view: UiProjectView | undefined
  directory: string
  inFlight: Set<string>
  aliases?: ProjectViewDirectoryAliases
}) {
  const key = projectViewDirectoryKey(input.directory)
  if (input.inFlight.has(key)) return false
  if (projectViewEntryForDirectory(input.view, input.directory, input.aliases)) return false
  return true
}

export function shouldTouchProjectViewDirectory(input: {
  view: UiProjectView | undefined
  directory: string
  inFlight: Set<string>
  aliases?: ProjectViewDirectoryAliases
}) {
  const key = projectViewDirectoryKey(input.directory)
  if (input.inFlight.has(key)) return false
  const lastProjectKey = input.view?.lastProject
    ? projectViewDirectoryKey(input.view.lastProject.worktree)
    : undefined
  if (lastProjectKey === key) return false
  if (lastProjectKey && input.aliases?.get(key) === lastProjectKey) return false
  return true
}

export function pruneProjectViewDirectoryAliases(view: UiProjectView | undefined, aliases: Map<string, string>) {
  const availableKeys = projectViewAvailableDirectoryKeys(view)
  aliases.forEach((targetKey, requestedKey) => {
    if (requestedKey === targetKey || !availableKeys.has(targetKey)) aliases.delete(requestedKey)
  })
}

export function projectViewResolvedEntryFromOpenResult(input: {
  preView: UiProjectView | undefined
  resultView: UiProjectView | undefined
  directory: string
  position?: number
}) {
  if (!input.resultView) return undefined
  if (projectViewEntryForDirectory(input.resultView, input.directory)) return undefined

  const position = input.position ?? 0
  const positioned = projectViewEntryAtPosition(input.resultView, position)
  const previousPositioned = projectViewEntryAtPosition(input.preView, position)
  const previousPositionedKey = previousPositioned && projectViewEntryKey(previousPositioned)
  if (positioned && projectViewEntryKey(positioned) !== previousPositionedKey) {
    return positioned
  }

  const previousKeys = projectViewEntryKeys(input.preView)
  const newEntries = (input.resultView.projects ?? []).filter((entry) =>
    !previousKeys.has(projectViewEntryKey(entry)),
  )
  if (newEntries.length === 1) return newEntries[0]
  return undefined
}

export function projectViewProjectDisplayName(
  project: { name?: string; worktree: string },
  aliases?: ProjectViewDirectoryAliases,
) {
  const name = project.name?.trim()
  if (name) return name

  const worktreeName = getFilename(project.worktree)
  if (worktreeName) return worktreeName

  const aliasName = projectViewAliasDisplayName(projectViewDirectoryKey(project.worktree), aliases)
  if (aliasName) return aliasName

  if (project.worktree) return project.worktree
  return undefined
}

function projectViewEntryForKey(view: UiProjectView | undefined, key: string) {
  return (view?.projects ?? []).find((entry) => projectViewDirectoryKey(entry.project.worktree) === key)
}

function projectViewEntryAtPosition(view: UiProjectView | undefined, position: number) {
  return (view?.projects ?? []).find((entry) => entry.position === position)
}

function projectViewEntryKey(entry: UiProjectView["projects"][number]) {
  return projectViewDirectoryKey(entry.project.worktree)
}

function projectViewEntryKeys(view: UiProjectView | undefined) {
  const keys = new Set<string>()
  for (const entry of view?.projects ?? []) {
    keys.add(projectViewEntryKey(entry))
  }
  return keys
}

function projectViewAvailableDirectoryKeys(view: UiProjectView | undefined) {
  const keys = new Set<string>()
  for (const entry of view?.projects ?? []) {
    keys.add(projectViewDirectoryKey(entry.project.worktree))
  }
  if (view?.lastProject) keys.add(projectViewDirectoryKey(view.lastProject.worktree))
  return keys
}

function projectViewAliasDisplayName(targetKey: string, aliases?: ProjectViewDirectoryAliases) {
  if (!aliases) return undefined
  for (const [requestedKey, aliasTargetKey] of aliases) {
    if (aliasTargetKey !== targetKey) continue
    const requestedName = getFilename(requestedKey)
    if (requestedName) return requestedName
    if (requestedKey) return requestedKey
  }
  return undefined
}

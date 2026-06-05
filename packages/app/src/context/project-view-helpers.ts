import type { UiProjectView } from "@opencode-ai/sdk/v2/client"
import { pathKey } from "@/utils/path-key"

export function projectViewDirectoryKey(directory: string) {
  return pathKey(directory)
}

export function projectViewEntryForDirectory(view: UiProjectView | undefined, directory: string) {
  const key = projectViewDirectoryKey(directory)
  return (view?.projects ?? []).find((entry) => projectViewDirectoryKey(entry.project.worktree) === key)
}

export function shouldOpenProjectViewDirectory(input: {
  view: UiProjectView | undefined
  directory: string
  inFlight: Set<string>
}) {
  const key = projectViewDirectoryKey(input.directory)
  if (input.inFlight.has(key)) return false
  if (projectViewEntryForDirectory(input.view, input.directory)) return false
  return true
}

export function shouldTouchProjectViewDirectory(input: {
  view: UiProjectView | undefined
  directory: string
  inFlight: Set<string>
}) {
  const key = projectViewDirectoryKey(input.directory)
  if (input.inFlight.has(key)) return false
  if (input.view?.lastProject && projectViewDirectoryKey(input.view.lastProject.worktree) === key) return false
  return true
}

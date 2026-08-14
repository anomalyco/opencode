import { createMemo } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import {
  isWorkspaceDirectory,
  isWorkspaceSelection,
  sameDirectory,
  workspaceDefaultSelection,
  workspaceDirectories,
} from "@/utils/workspace"

export function resolveNewSessionWorktree(input: {
  enabled: boolean
  selected?: string
  directory: string
  projectWorktree?: string
  fallback?: string
}) {
  if (!input.enabled) return "main"
  if (input.selected) return input.selected
  if (input.projectWorktree && !sameDirectory(input.directory, input.projectWorktree)) return input.directory
  return input.fallback ?? "main"
}

export function normalizeNewSessionWorktree(value: string, directory: string, projectWorktree?: string) {
  if (value === "main" && projectWorktree && !sameDirectory(directory, projectWorktree)) return projectWorktree
  return value
}

export function resolveNewSessionBranch(input: {
  worktree: string
  local?: string
  worktreeBranch: (worktree: string) => string | undefined
}) {
  if (input.worktree === "main" || input.worktree === "create") return input.local
  return input.worktreeBranch(input.worktree) ?? input.local
}

export function createNewSessionWorkspaceController(input: {
  selected: () => string | undefined
  setSelected: (worktree: string | undefined) => void
  onViewAll: () => void
}) {
  const sdk = useSDK()
  const sync = useSync()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const settings = useSettings()
  const visible = createMemo(() => sync().project?.vcs === "git")
  const selected = createMemo(() => {
    const project = sync().project
    const worktree = input.selected()
    if (!project || !worktree) return
    return isWorkspaceSelection(project, worktree) ? worktree : undefined
  })
  const fallback = createMemo(() => {
    const project = sync().project
    if (!project) return "main"
    return workspaceDefaultSelection(
      settings.workspaces.defaultDestination(),
      settings.workspaces.lastUsed(serverSDK.scope, project.id),
    )
  })
  const value = createMemo(() =>
    resolveNewSessionWorktree({
      enabled: visible(),
      selected: selected(),
      directory: sdk().directory,
      projectWorktree: sync().project?.worktree,
      fallback: fallback(),
    }),
  )
  const projectRoot = createMemo(() => sync().project?.worktree ?? sdk().directory)
  const localBranch = createMemo(() => serverSync.child(projectRoot())[0].vcs?.branch)
  const branch = createMemo(() =>
    resolveNewSessionBranch({
      worktree: value(),
      local: localBranch(),
      worktreeBranch: (worktree) => serverSync.child(worktree)[0].vcs?.branch,
    }),
  )
  const remember = (worktree = value()) => {
    const project = sync().project
    if (!project) return
    const local = worktree === "main" || sameDirectory(worktree, project.worktree)
    settings.workspaces.setLastUsed(serverSDK.scope, project.id, local ? "local" : "workspace")
  }

  return {
    selection: {
      value,
      workspace: createMemo(() => {
        const project = sync().project
        const current = value()
        return current === "create" || (!!project && isWorkspaceDirectory(project, current))
      }),
      reset: () => input.setSelected(undefined),
      remember,
      set: (worktree: string) => {
        input.setSelected(normalizeNewSessionWorktree(worktree, sdk().directory, sync().project?.worktree))
        remember(worktree)
      },
    },
    project: {
      root: projectRoot,
      workspaces: () => {
        const project = sync().project
        return project ? workspaceDirectories(project) : []
      },
      git: () => sync().project?.vcs === "git",
      openAll: input.onViewAll,
    },
    bar: {
      visible,
      branch,
    },
  }
}

export type NewSessionWorkspaceController = ReturnType<typeof createNewSessionWorkspaceController>

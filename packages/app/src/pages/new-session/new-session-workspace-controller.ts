import { createEffect, createMemo } from "solid-js"
import { useWorkspaceLocation } from "@/context/location"
import { useServerSDK } from "@/context/server-sdk"
import { useData } from "@/context/server"
import { useSettings } from "@/context/settings"
import { normalizeProjectInfo } from "@/context/global-sync/utils"
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

export function resolveNewSessionGit(input: { projectVcs?: string; branch?: string }) {
  return input.projectVcs === "git" || input.branch !== undefined
}

export function createNewSessionWorkspaceController(input: {
  selected: () => string | undefined
  setSelected: (worktree: string | undefined) => void
  onViewAll: () => void
}) {
  const sdk = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const data = useData()
  const settings = useSettings()
  const currentProject = createMemo(() => {
    const projectID = data.location.info({ directory: sdk().directory })?.project.id
    const current = projectID ? data.project.get(projectID) : undefined
    return current ? normalizeProjectInfo(current) : undefined
  })
  const visible = createMemo(() =>
    resolveNewSessionGit({
      projectVcs: currentProject()?.vcs,
      branch: data.location.vcs.info({ directory: sdk().directory })?.branch.current,
    }),
  )
  const selected = createMemo(() => {
    const project = currentProject()
    const worktree = input.selected()
    if (!project || !worktree) return
    return isWorkspaceSelection(project, worktree) ? worktree : undefined
  })
  const fallback = createMemo(() => {
    const project = currentProject()
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
      projectWorktree: currentProject()?.worktree,
      fallback: fallback(),
    }),
  )
  const projectRoot = createMemo(() => currentProject()?.worktree ?? sdk().directory)
  createEffect(() => {
    void Promise.all([data.location.syncInfo({ directory: sdk().directory }), data.project.sync()]).catch(() => undefined)
    const project = currentProject()
    const directories = project ? [project.worktree, ...workspaceDirectories(project)] : [sdk().directory]
    directories.forEach((directory) => void data.location.vcs.sync({ directory }).catch(() => undefined))
  })
  const localBranch = createMemo(() => data.location.vcs.info({ directory: projectRoot() })?.branch.current)
  const branch = createMemo(() =>
    resolveNewSessionBranch({
      worktree: value(),
      local: localBranch(),
      worktreeBranch: (worktree) => data.location.vcs.info({ directory: worktree })?.branch.current,
    }),
  )
  const remember = (worktree = value()) => {
    const project = currentProject()
    if (!project) return
    const local = worktree === "main" || sameDirectory(worktree, project.worktree)
    settings.workspaces.setLastUsed(serverSDK.scope, project.id, local ? "local" : "workspace")
  }

  return {
    selection: {
      value,
      workspace: createMemo(() => {
        const project = currentProject()
        const current = value()
        return current === "create" || (!!project && isWorkspaceDirectory(project, current))
      }),
      reset: () => input.setSelected(undefined),
      remember,
      set: (worktree: string) => {
        input.setSelected(normalizeNewSessionWorktree(worktree, sdk().directory, currentProject()?.worktree))
        remember(worktree)
      },
    },
    project: {
      root: projectRoot,
      workspaces: () => {
        const project = currentProject()
        return project ? workspaceDirectories(project) : []
      },
      git: visible,
      openAll: input.onViewAll,
    },
    bar: {
      visible,
      branch,
    },
  }
}

export type NewSessionWorkspaceController = ReturnType<typeof createNewSessionWorkspaceController>

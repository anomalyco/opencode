import { debounce } from "@solid-primitives/scheduled"
import { createEffect, createMemo, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { useSettings } from "@/settings/model"
import { useTabs } from "@/shell/tabs/tabs"
import { ServerConnection } from "@/runtime/server/registry"
import { normalizeProjectInfo } from "@/runtime/server/global-sync/utils"
import {
  isWorkspaceDirectory,
  isWorkspaceSelection,
  sameDirectory,
  workspaceDefaultSelection,
  workspaceDirectories,
  workspaceSelectionDestination,
} from "@/workspaces/paths"

export function resolveNewSessionWorktree(input: {
  enabled: boolean
  selected?: string
  directory: string
  projectWorktree?: string
  fallback?: string
}) {
  if (!input.enabled) return "main"
  if (input.selected) return input.selected
  return normalizeNewSessionWorktree(input.fallback ?? "main", input.directory, input.projectWorktree)
}

export function normalizeNewSessionWorktree(value: string, directory: string, projectWorktree?: string) {
  if (value === "main" && projectWorktree && !sameDirectory(directory, projectWorktree)) return projectWorktree
  return value
}

export function resolveNewSessionBranch(input: {
  worktree: string
  directory: string
  createBranch?: string
  worktreeBranch: (worktree: string) => string | undefined
}) {
  if (input.worktree === "create" && input.createBranch) return input.createBranch
  const directory = input.worktree === "main" || input.worktree === "create" ? input.directory : input.worktree
  return input.worktreeBranch(directory)
}

export function resolveNewSessionGit(input: { projectVcs?: string; branch?: string }) {
  return input.projectVcs === "git" || input.branch !== undefined
}

export function createNewSessionWorkspaceController(input: {
  selectedWorktree: () => string | undefined
  selectedBranch: () => string | undefined
  setSelectedWorktree: (worktree: string | undefined) => void
  setSelectedBranch: (branch: string | undefined) => void
  onViewAll: () => void
}) {
  const sdk = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const data = useData()
  const settings = useSettings()
  const tabs = useTabs()
  const [state, setState] = createStore({ search: "" })
  const searchBranches = debounce((search: string) => setState("search", search.trim()), 100)
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
    const worktree = input.selectedWorktree()
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
  const [branches] = createResource(
    () => (visible() ? { directory: projectRoot(), search: state.search } : undefined),
    ({ directory, search }) =>
      serverSDK.api.vcs
        .branches({ location: { directory }, search, limit: 50 })
        .then((response) => ({ directory, search, data: response.data }))
        .catch(() => ({ directory, search, data: [] })),
  )
  createEffect(() => {
    void Promise.all([data.location.syncInfo({ directory: sdk().directory }), data.project.sync()]).catch(
      () => undefined,
    )
    const project = currentProject()
    const directories = project ? [project.worktree, ...workspaceDirectories(project)] : [sdk().directory]
    directories.forEach((directory) => void data.location.vcs.sync({ directory }).catch(() => undefined))
  })
  const branch = createMemo(() =>
    resolveNewSessionBranch({
      worktree: value(),
      directory: sdk().directory,
      createBranch: input.selectedBranch(),
      worktreeBranch: (worktree) => data.location.vcs.info({ directory: worktree })?.branch.current,
    }),
  )
  const remember = (worktree = value()) => {
    const project = currentProject()
    if (!project) return
    tabs.initializeDraftWorktrees(ServerConnection.key(serverSDK.server), sdk().directory, fallback())
    const local = workspaceSelectionDestination(worktree, project.worktree) === "main"
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
      reset: () => {
        input.setSelectedWorktree(undefined)
        input.setSelectedBranch(undefined)
      },
      remember,
      set: (worktree: string) => {
        input.setSelectedBranch(undefined)
        input.setSelectedWorktree(normalizeNewSessionWorktree(worktree, sdk().directory, currentProject()?.worktree))
        remember(worktree)
      },
      create: (branch: string) => {
        input.setSelectedBranch(branch)
        input.setSelectedWorktree("create")
        remember("create")
      },
    },
    project: {
      root: projectRoot,
      workspaces: () => {
        const project = currentProject()
        return project ? workspaceDirectories(project) : []
      },
      git: visible,
      branches: () => {
        const current = data.location.vcs.info({ directory: sdk().directory })?.branch.current
        const loaded = branches.latest
        const list = loaded?.directory === projectRoot() ? loaded.data : []
        return [
          ...new Set([
            ...list,
            ...(current && current.toLowerCase().includes(state.search.toLowerCase()) ? [current] : []),
          ]),
        ].slice(0, 50)
      },
      searchBranches,
      openAll: input.onViewAll,
    },
    bar: {
      visible,
      branch,
    },
  }
}

export type NewSessionWorkspaceController = ReturnType<typeof createNewSessionWorkspaceController>

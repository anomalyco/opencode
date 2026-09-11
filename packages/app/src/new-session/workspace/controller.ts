import { debounce } from "@solid-primitives/scheduled"
import { createEffect, createMemo, createResource, onCleanup } from "solid-js"
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
  workspaceSelectionDestination,
} from "@/workspaces/paths"

export function resolveNewSessionWorktree(input: { enabled: boolean; selected?: string; fallback?: string }) {
  if (!input.enabled) return "main"
  if (input.selected) return input.selected
  return input.fallback ?? "main"
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
  const worktreeSource = createMemo(
    () => {
      const project = currentProject()
      return project ? { projectID: project.id, directory: project.worktree } : undefined
    },
    undefined,
    { equals: (a, b) => a?.projectID === b?.projectID && a?.directory === b?.directory },
  )
  const [worktrees, worktreeActions] = createResource(worktreeSource, async (source) => ({
    projectID: source.projectID,
    items: await serverSDK.api.worktree
      .list({ location: { directory: source.directory } })
      .catch(() => (currentProject()?.id === source.projectID ? currentProject()?.worktrees : undefined) ?? []),
  }))
  onCleanup(
    serverSDK.event.listen((event) => {
      if (event.type === "worktree.updated") void worktreeActions.refetch()
    }),
  )
  // `latest` only skips Suspense once the resource has resolved at least once. Before that it
  // behaves like a plain read, which holds the transition that opens the New Session tab until
  // the worktree list returns.
  const worktreesLoaded = () => worktrees.state === "ready" || worktrees.state === "refreshing"
  const worktreeItems = createMemo(() => {
    const project = currentProject()
    if (!project) return []
    if (!worktreesLoaded()) return project.worktrees
    const loaded = worktrees.latest
    return loaded?.projectID === project.id ? loaded.items : project.worktrees
  })
  const worktreeDirectories = createMemo(() => {
    const project = currentProject()
    if (!project) return []
    const directories = [
      ...worktreeItems().map((item) => item.directory),
      ...project.worktrees.map((item) => item.directory),
      ...(project.sandboxes ?? []),
    ]
    return directories
      .filter((directory) => !sameDirectory(project.worktree, directory))
      .filter((directory, index, items) => items.findIndex((item) => sameDirectory(item, directory)) === index)
  })
  const managedWorktrees = createMemo(() => {
    const project = currentProject()
    if (!project) return 0
    return worktreeItems().filter(
      (item) => item.strategy !== undefined && !sameDirectory(project.worktree, item.directory),
    ).length
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
    if (isWorkspaceSelection(project, worktree)) return worktree
    // A saved choice may only exist in the server inventory. Keep it until the list can confirm it,
    // otherwise the selector falls back to Local while loading and a submit would target the wrong directory.
    if (!worktreesLoaded()) return worktree
    return worktreeDirectories().some((item) => sameDirectory(item, worktree)) ? worktree : undefined
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
    void Promise.all([
      data.location.syncInfo({ directory: sdk().directory }),
      data.project.sync(),
      data.location.vcs.sync({ directory: sdk().directory }),
    ]).catch(() => undefined)
  })
  // Only the selected worktree feeds the branch label. Syncing every worktree in the inventory boots
  // each one on the server, which then emits `agent.updated` and makes the client run the full
  // catalog fan-out for every directory.
  createEffect(() => {
    const selection = value()
    if (selection === "main" || selection === "create") return
    void data.location.vcs.sync({ directory: selection }).catch(() => undefined)
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
        if (current === "create") return true
        if (current === "main" || !project) return false
        if (isWorkspaceDirectory(project, current) || !worktreesLoaded()) return true
        return worktreeDirectories().some((item) => sameDirectory(item, current))
      }),
      reset: () => {
        input.setSelectedWorktree(undefined)
        input.setSelectedBranch(undefined)
      },
      remember,
      set: (worktree: string) => {
        input.setSelectedBranch(undefined)
        input.setSelectedWorktree(worktree)
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
      workspaces: worktreeDirectories,
      managed: managedWorktrees,
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

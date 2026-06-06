import { createSimpleContext } from "@opencode-ai/ui/context"
import type { Project, UiProjectView } from "@opencode-ai/sdk/v2/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createMemo, onCleanup } from "solid-js"
import { useServerSDK } from "./server-sdk"
import {
  projectViewDirectoryKey,
  projectViewEntryForDirectory,
  projectViewProjectDisplayName,
  projectViewResolvedEntryFromOpenResult,
  projectViewWithLastProjectFromServer,
  pruneProjectViewDirectoryAliases,
  shouldOpenProjectViewDirectory,
  shouldTouchProjectViewDirectory,
} from "./project-view-helpers"

const EMPTY_VIEW: UiProjectView = { projects: [] }

export type ProjectViewProject = Partial<Project> & { worktree: string; expanded: boolean; displayName?: string }

type OpenProjectInput = { directory: string; expanded?: boolean; position?: number; preView: UiProjectView }

function pendingProject(directory: string): Project {
  return {
    id: "",
    worktree: directory,
    time: { created: 0, updated: 0 },
    sandboxes: [],
  }
}

export const { use: useProjectView, provider: ProjectViewProvider } = createSimpleContext({
  name: "ProjectView",
  init: () => {
    const serverSDK = useServerSDK()
    const queryClient = useQueryClient()
    const queryKey = () => ["ui", "project-view", serverSDK.url] as const
    const openRequests = new Set<string>()
    const lastProjectRequests = new Set<string>()
    const directoryAliases = new Map<string, string>()

    const query = useQuery(() => ({
      queryKey: queryKey(),
      queryFn: () => serverSDK.client.ui.projectView.get().then((x) => x.data ?? EMPTY_VIEW),
    }))

    const currentView = () => {
      const view = queryClient.getQueryData<UiProjectView>(queryKey()) ?? query.data ?? EMPTY_VIEW
      pruneProjectViewDirectoryAliases(view, directoryAliases)
      return view
    }

    const update = (fn: (view: UiProjectView) => UiProjectView) => {
      queryClient.setQueryData<UiProjectView>(queryKey(), (current) => {
        const view = fn(current ?? query.data ?? EMPTY_VIEW)
        pruneProjectViewDirectoryAliases(view, directoryAliases)
        return view
      })
    }

    const applyServerView = (view: UiProjectView | undefined) => {
      if (!view) return
      pruneProjectViewDirectoryAliases(view, directoryAliases)
      queryClient.setQueryData<UiProjectView>(queryKey(), view)
    }

    const aliasDirectory = (directory: string | undefined, worktree: string | undefined) => {
      if (!directory || !worktree) return
      const key = projectViewDirectoryKey(directory)
      const targetKey = projectViewDirectoryKey(worktree)
      if (key === targetKey) {
        directoryAliases.delete(key)
        return
      }
      directoryAliases.set(key, targetKey)
    }

    const refetch = () => {
      void queryClient.invalidateQueries({ queryKey: queryKey() })
    }

    const unsub = serverSDK.event.on("global", (event) => {
      if (event.type !== "ui.project_view.updated") return
      if (event.properties.viewID !== "default") return
      refetch()
    })
    onCleanup(unsub)

    const openMutation = useMutation(() => ({
      mutationFn: (input: OpenProjectInput) =>
        serverSDK.client.ui.projectView.openProjects.open({
          uiProjectViewOpenProjectInput: {
            directory: input.directory,
            expanded: input.expanded,
            position: input.position,
          },
        }),
      onSuccess: (result, input) => {
        if (result.data) {
          const entry = projectViewResolvedEntryFromOpenResult({
            preView: input.preView,
            resultView: result.data,
            directory: input.directory,
            position: input.position,
          })
          aliasDirectory(input.directory, entry?.project.worktree)
        }
        applyServerView(result.data)
      },
      onError: refetch,
    }))

    const closeMutation = useMutation(() => ({
      mutationFn: (input: { projectID: string; directory: string }) =>
        serverSDK.client.ui.projectView.openProjects.close({ projectID: input.projectID, directory: input.directory }),
      onSuccess: (result) => applyServerView(result.data),
      onError: refetch,
    }))

    const replaceMutation = useMutation(() => ({
      mutationFn: (projects: { projectID: string; directory: string; expanded?: boolean }[]) =>
        serverSDK.client.ui.projectView.openProjects.replace({
          uiProjectViewReplaceOpenProjectsInput: { projects },
        }),
      onSuccess: (result) => applyServerView(result.data),
      onError: refetch,
    }))

    const updateMutation = useMutation(() => ({
      mutationFn: (input: { projectID: string; directory: string; expanded?: boolean; position?: number }) =>
        serverSDK.client.ui.projectView.openProjects.update({
          projectID: input.projectID,
          uiProjectViewUpdateOpenProjectInput: {
            directory: input.directory,
            expanded: input.expanded,
            position: input.position,
          },
        }),
      onSuccess: (result) => applyServerView(result.data),
      onError: refetch,
    }))

    const lastProjectMutation = useMutation(() => ({
      mutationFn: (input: { projectID?: string; directory?: string }) =>
        serverSDK.client.ui.projectView.lastProject.set({ uiProjectViewLastProjectInput: input }),
      onSuccess: (result, input) => {
        aliasDirectory(input.directory, result.data?.lastProject?.worktree)
        update((view) => projectViewWithLastProjectFromServer(view, result.data))
      },
      onError: refetch,
    }))

    const projects = createMemo(() =>
      (query.data?.projects ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((entry) => ({
          ...entry.project,
          worktree: entry.directory ?? entry.project.worktree,
          expanded: entry.expanded,
          displayName: projectViewProjectDisplayName(
            { name: entry.project.name, worktree: entry.directory ?? entry.project.worktree },
            directoryAliases,
          ),
        })),
    )

    const entryForDirectory = (directory: string) =>
      projectViewEntryForDirectory(currentView(), directory, directoryAliases)

    const projectForDirectory = (directory: string) => entryForDirectory(directory)?.project

    return {
      ready: createMemo(() => !query.isLoading),
      refetch,
      projects: {
        list: projects,
        open(directory: string) {
          const key = projectViewDirectoryKey(directory)
          const preView = currentView()
          if (
            !shouldOpenProjectViewDirectory({
              view: preView,
              directory,
              inFlight: openRequests,
              aliases: directoryAliases,
            })
          )
            return
          openRequests.add(key)
          update((view) => ({
            ...view,
            projects: [
              { project: pendingProject(directory), directory, position: 0, expanded: true },
              ...view.projects.map((entry) => ({ ...entry, position: entry.position + 1 })),
            ],
          }))
          openMutation.mutate(
            { directory, expanded: true, position: 0, preView },
            { onSettled: () => openRequests.delete(key) },
          )
        },
        close(directory: string) {
          const key = projectViewDirectoryKey(directory)
          const project = projectForDirectory(directory)
          update((view) => ({
            ...view,
            projects: view.projects
              .filter((entry) => projectViewDirectoryKey(entry.directory ?? entry.project.worktree) !== key)
              .map((entry, position) => ({ ...entry, position })),
            lastProject:
              (view.lastProjectDirectory
                ? projectViewDirectoryKey(view.lastProjectDirectory)
                : view.lastProject
                  ? projectViewDirectoryKey(view.lastProject.worktree)
                  : undefined) === key
                ? undefined
                : view.lastProject,
            lastProjectDirectory:
              view.lastProjectDirectory && projectViewDirectoryKey(view.lastProjectDirectory) === key
                ? undefined
                : view.lastProjectDirectory,
          }))
          if (!project?.id) {
            refetch()
            return
          }
          closeMutation.mutate({ projectID: project.id, directory })
        },
        expand(directory: string) {
          const project = projectForDirectory(directory)
          const key = projectViewDirectoryKey(directory)
          update((view) => ({
            ...view,
            projects: view.projects.map((entry) =>
              projectViewDirectoryKey(entry.directory ?? entry.project.worktree) === key ? { ...entry, expanded: true } : entry,
            ),
          }))
          if (!project?.id) return
          updateMutation.mutate({ projectID: project.id, directory, expanded: true })
        },
        collapse(directory: string) {
          const project = projectForDirectory(directory)
          const key = projectViewDirectoryKey(directory)
          update((view) => ({
            ...view,
            projects: view.projects.map((entry) =>
              projectViewDirectoryKey(entry.directory ?? entry.project.worktree) === key ? { ...entry, expanded: false } : entry,
            ),
          }))
          if (!project?.id) return
          updateMutation.mutate({ projectID: project.id, directory, expanded: false })
        },
        move(directory: string, toIndex: number) {
          const key = projectViewDirectoryKey(directory)
          const current = currentView()
            .projects.slice()
            .sort((a, b) => a.position - b.position)
          const fromIndex = current.findIndex(
            (entry) => projectViewDirectoryKey(entry.directory ?? entry.project.worktree) === key,
          )
          if (fromIndex === -1 || fromIndex === toIndex) return
          const next = current.slice()
          const [item] = next.splice(fromIndex, 1)
          if (!item) return
          next.splice(toIndex, 0, item)
          update((view) => ({ ...view, projects: next.map((entry, position) => ({ ...entry, position })) }))
          const projects = next.flatMap((entry) =>
            entry.project.id
              ? [{ projectID: entry.project.id, directory: entry.directory ?? entry.project.worktree, expanded: entry.expanded }]
              : [],
          )
          if (projects.length !== next.length) {
            refetch()
            return
          }
          replaceMutation.mutate(projects)
        },
        last() {
          return query.data?.lastProjectDirectory ?? query.data?.lastProject?.worktree
        },
        touch(directory: string) {
          const key = projectViewDirectoryKey(directory)
          if (
            !shouldTouchProjectViewDirectory({
              view: currentView(),
              directory,
              inFlight: lastProjectRequests,
              aliases: directoryAliases,
            })
          )
            return
          const project = projectForDirectory(directory)
          lastProjectRequests.add(key)
          update((view) => ({ ...view, lastProject: project ?? pendingProject(directory), lastProjectDirectory: directory }))
          lastProjectMutation.mutate(project?.id ? { projectID: project.id, directory } : { directory }, {
            onSettled: () => lastProjectRequests.delete(key),
          })
        },
      },
    }
  },
})

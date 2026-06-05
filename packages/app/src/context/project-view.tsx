import { createSimpleContext } from "@opencode-ai/ui/context"
import type { Project, UiProjectView } from "@opencode-ai/sdk/v2/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createMemo, onCleanup } from "solid-js"
import { useServerSDK } from "./server-sdk"
import {
  projectViewDirectoryKey,
  projectViewEntryForDirectory,
  shouldOpenProjectViewDirectory,
  shouldTouchProjectViewDirectory,
} from "./project-view-helpers"

const EMPTY_VIEW: UiProjectView = { projects: [] }

export type ProjectViewProject = Partial<Project> & { worktree: string; expanded: boolean }

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

    const query = useQuery(() => ({
      queryKey: queryKey(),
      queryFn: () => serverSDK.client.ui.projectView.get().then((x) => x.data ?? EMPTY_VIEW),
    }))

    const currentView = () => queryClient.getQueryData<UiProjectView>(queryKey()) ?? query.data ?? EMPTY_VIEW

    const update = (fn: (view: UiProjectView) => UiProjectView) => {
      queryClient.setQueryData<UiProjectView>(queryKey(), (current) => fn(current ?? query.data ?? EMPTY_VIEW))
    }

    const applyServerView = (view: UiProjectView | undefined) => {
      if (!view) return
      queryClient.setQueryData<UiProjectView>(queryKey(), view)
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
      mutationFn: (input: { directory: string; expanded?: boolean; position?: number }) =>
        serverSDK.client.ui.projectView.openProjects.open({
          uiProjectViewOpenProjectInput: input,
        }),
      onSuccess: (result) => applyServerView(result.data),
      onError: refetch,
    }))

    const closeMutation = useMutation(() => ({
      mutationFn: (projectID: string) => serverSDK.client.ui.projectView.openProjects.close({ projectID }),
      onSuccess: (result) => applyServerView(result.data),
      onError: refetch,
    }))

    const replaceMutation = useMutation(() => ({
      mutationFn: (projects: { projectID: string; expanded?: boolean }[]) =>
        serverSDK.client.ui.projectView.openProjects.replace({
          uiProjectViewReplaceOpenProjectsInput: { projects },
        }),
      onSuccess: (result) => applyServerView(result.data),
      onError: refetch,
    }))

    const updateMutation = useMutation(() => ({
      mutationFn: (input: { projectID: string; expanded?: boolean; position?: number }) =>
        serverSDK.client.ui.projectView.openProjects.update({
          projectID: input.projectID,
          uiProjectViewUpdateOpenProjectInput: { expanded: input.expanded, position: input.position },
        }),
      onSuccess: (result) => applyServerView(result.data),
      onError: refetch,
    }))

    const lastProjectMutation = useMutation(() => ({
      mutationFn: (input: { projectID?: string; directory?: string }) =>
        serverSDK.client.ui.projectView.lastProject.set({ uiProjectViewLastProjectInput: input }),
      onSuccess: (result) => applyServerView(result.data),
      onError: refetch,
    }))

    const projects = createMemo(() =>
      (query.data?.projects ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((entry) => ({ ...entry.project, expanded: entry.expanded })),
    )

    const entryForDirectory = (directory: string) => projectViewEntryForDirectory(currentView(), directory)

    const projectForDirectory = (directory: string) => entryForDirectory(directory)?.project

    return {
      ready: createMemo(() => !query.isLoading),
      refetch,
      projects: {
        list: projects,
        open(directory: string) {
          const key = projectViewDirectoryKey(directory)
          if (!shouldOpenProjectViewDirectory({ view: currentView(), directory, inFlight: openRequests })) return
          openRequests.add(key)
          update((view) => ({
            ...view,
            projects: [
              { project: pendingProject(directory), position: 0, expanded: true },
              ...view.projects.map((entry) => ({ ...entry, position: entry.position + 1 })),
            ],
          }))
          openMutation.mutate(
            { directory, expanded: true, position: 0 },
            { onSettled: () => openRequests.delete(key) },
          )
        },
        close(directory: string) {
          const key = projectViewDirectoryKey(directory)
          const project = projectForDirectory(directory)
          update((view) => ({
            ...view,
            projects: view.projects
              .filter((entry) => projectViewDirectoryKey(entry.project.worktree) !== key)
              .map((entry, position) => ({ ...entry, position })),
            lastProject:
              view.lastProject && projectViewDirectoryKey(view.lastProject.worktree) === key ? undefined : view.lastProject,
          }))
          if (!project?.id) {
            refetch()
            return
          }
          closeMutation.mutate(project.id)
        },
        expand(directory: string) {
          const key = projectViewDirectoryKey(directory)
          const project = projectForDirectory(directory)
          update((view) => ({
            ...view,
            projects: view.projects.map((entry) =>
              projectViewDirectoryKey(entry.project.worktree) === key ? { ...entry, expanded: true } : entry,
            ),
          }))
          if (!project?.id) return
          updateMutation.mutate({ projectID: project.id, expanded: true })
        },
        collapse(directory: string) {
          const key = projectViewDirectoryKey(directory)
          const project = projectForDirectory(directory)
          update((view) => ({
            ...view,
            projects: view.projects.map((entry) =>
              projectViewDirectoryKey(entry.project.worktree) === key ? { ...entry, expanded: false } : entry,
            ),
          }))
          if (!project?.id) return
          updateMutation.mutate({ projectID: project.id, expanded: false })
        },
        move(directory: string, toIndex: number) {
          const key = projectViewDirectoryKey(directory)
          const current = currentView()
            .projects.slice()
            .sort((a, b) => a.position - b.position)
          const fromIndex = current.findIndex((entry) => projectViewDirectoryKey(entry.project.worktree) === key)
          if (fromIndex === -1 || fromIndex === toIndex) return
          const next = current.slice()
          const [item] = next.splice(fromIndex, 1)
          if (!item) return
          next.splice(toIndex, 0, item)
          update((view) => ({ ...view, projects: next.map((entry, position) => ({ ...entry, position })) }))
          const projects = next.flatMap((entry) =>
            entry.project.id ? [{ projectID: entry.project.id, expanded: entry.expanded }] : [],
          )
          if (projects.length !== next.length) {
            refetch()
            return
          }
          replaceMutation.mutate(projects)
        },
        last() {
          return query.data?.lastProject?.worktree
        },
        touch(directory: string) {
          const key = projectViewDirectoryKey(directory)
          if (!shouldTouchProjectViewDirectory({ view: currentView(), directory, inFlight: lastProjectRequests })) return
          const project = projectForDirectory(directory)
          lastProjectRequests.add(key)
          update((view) => ({ ...view, lastProject: project ?? pendingProject(directory) }))
          lastProjectMutation.mutate(project?.id ? { projectID: project.id } : { directory }, {
            onSettled: () => lastProjectRequests.delete(key),
          })
        },
      },
    }
  },
})

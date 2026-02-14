/**
 * ClaxedoLayout - Custom layout component for Rail + Tab UI
 *
 * This replaces the default Layout when registered via the extension system.
 * It provides the Rail sidebar and Tab bar UI with Project > Workspace > Session hierarchy.
 *
 * Note: ClaxedoLayout is at app level (outside DirectoryLayout/SDKProvider),
 * so it cannot directly access terminal context. Terminal creation is coordinated
 * via signals in the claxedo context, with TerminalContentWrapper (at directory level)
 * handling the actual creation.
 */

import "./claxedo-layout.css"
import { createSignal, createMemo, createEffect, on, onMount, Show, type ParentProps } from "solid-js"
import { produce } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { getExtensions } from "@opencode-ai/app-shared"
import type { Session } from "@opencode-ai/sdk/v2"
import {
  useLayout,
  type LocalProject,
  useGlobalSync,
  useGlobalSDK,
  usePlatform,
  Titlebar,
  DialogSettings,
  useLanguage,
} from "@opencode-ai/claxedo-app"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Toast, showToast } from "@opencode-ai/ui/toast"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { base64Decode, base64Encode } from "@opencode-ai/util/encode"
import { getFilename } from "@opencode-ai/util/path"
import { validWorktree } from "@claxedo/utils/worktree"

// Import directly from source files to avoid circular dependency
// (index.tsx exports ClaxedoLayout, so we can't import from index here)
import { RailLayoutInner } from "./layouts/rail-layout"
import type { ProjectItem, SessionItem, WorkspaceItem } from "./layouts/rail-sidebar"
import { useClaxedoLayout, ClaxedoLayoutProvider, type TabItem } from "./context/claxedo-layout"
import { DialogDeleteSession, DialogDeleteWorkspace } from "./components/dialogs"
import { DialogBackend } from "./components/dialog-backend"
import { useBackend, BackendProvider } from "../context/backend"
import { useCommand } from "@/context/command"
import { DialogCreateCloudProject } from "../components/dialog-create-cloud-project"
import { DialogNewProject } from "../components/dialog-new-project"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { useConfigOptional } from "../context/config"
import { getAuthToken } from "../utils/auth-client"

import { useAgentHooks } from "../agent-hooks/listener"
import { shouldShowLocalSetup, DialogLocalSetup } from "../components/dialog-local-setup"

function message(err: unknown) {
  if (typeof err === "string") return err
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: unknown }).data
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message?: unknown }).message === "string"
    ) {
      return (data as { message: string }).message
    }
  }
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    return (err as { message: string }).message
  }
  if (err instanceof Error) return err.message
  return "Request failed"
}

function decodeDir(encoded: string | undefined) {
  if (!encoded) return
  try {
    const decoded = base64Decode(encoded)
    if (!validWorktree(decoded)) return
    return decoded
  } catch {
    return
  }
}

/**
 * Convert upstream LocalProject to Claxedo ProjectItem
 */
function projectToProjectItem(project: LocalProject): ProjectItem {
  return {
    id: project.id ?? project.worktree,
    worktree: project.worktree,
    name: project.name,
    icon: project.icon,
    expanded: project.expanded,
    sandboxes: project.sandboxes,
    commands: project.commands,
  }
}

/**
 * Bridge component that syncs upstream state with Claxedo state
 */
function ClaxedoStateBridge(props: ParentProps) {
  const claxedo = useClaxedoLayout()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const params = useParams()
  const navigate = useNavigate()

  // Set up agent lifecycle listeners for tab status indicators
  useAgentHooks()

  const workspaceId = createMemo(() => decodeDir(params.dir))
  const sessionId = createMemo(() => params.id)

  const attempted = new Set<string>()

  const isDefaultTitle = (value: string) =>
    /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)

  const sessionTitle = createMemo(() => {
    const wsId = workspaceId()
    const id = sessionId()
    if (!wsId || !id) return ""
    const [store] = globalSync.child(wsId)
    const session = store.session.find((s: Session) => s.id === id && s.directory === wsId)
    return session?.title ?? ""
  })

  const sessionBadge = createMemo(() => {
    const wsId = workspaceId()
    const id = sessionId()
    if (!wsId || !id) return undefined
    const [store] = globalSync.child(wsId)
    const session = store.session.find((s: Session) => s.id === id && s.directory === wsId)
    const summary = session?.summary
    if (!summary) return undefined
    return {
      additions: summary.additions ?? 0,
      deletions: summary.deletions ?? 0,
    }
  })

  // Combined effect to handle workspace and session sync together
  createEffect(
    on(
      () => [workspaceId(), sessionId(), sessionTitle(), sessionBadge()] as const,
      ([wsId, id, title, badge]) => {
        if (!wsId) return

        // Ensure sync is bootstrapped for this directory.
        globalSync.child(wsId)

        if (!id) {
          // If there's a "new" session tab for this workspace, don't redirect —
          // the user intentionally wants a fresh session (e.g. clicked "New Session").
          const hasNewTab = claxedo.topTabs
            .orderedItems()
            .some((t) => t.type === "session" && t.directory === wsId && t.sessionId === "new")
          if (hasNewTab) return

          const tab = claxedo.topTabs
            .orderedItems()
            .find((t) => t.type === "session" && t.directory === wsId && t.sessionId && t.sessionId !== "new")
          if (!tab?.sessionId) return
          queueMicrotask(() => navigate(`/${base64Encode(wsId)}/session/${tab.sessionId}`, { replace: true }))
          return
        }

        const existingTitle = claxedo.topTabs.findSession(wsId, id)?.title

        const desired = existingTitle && !isDefaultTitle(existingTitle) ? existingTitle : undefined
        const shouldPersist = isDefaultTitle(title) && !!desired && !attempted.has(`${wsId}:${id}`)
        if (shouldPersist) {
          attempted.add(`${wsId}:${id}`)
          void globalSDK.client.session
            .update({ directory: wsId, sessionID: id, title: desired })
            .catch(() => undefined)
        }

        // Add or activate session tab for this directory
        const nextTitle = isDefaultTitle(title) && desired ? desired : title || "New Session"
        const tabId = claxedo.topTabs.addSession(wsId, id, nextTitle, badge)
        if (tabId && claxedo.topTabs.activeId() !== tabId) claxedo.topTabs.setActive(tabId)

        // If we just added a real session, close the "new" tab if it exists
        if (id !== "new") {
          const tab = claxedo.topTabs.findSession(wsId, "new")
          if (tab) claxedo.topTabs.close(tab.id)
        }
      },
    ),
  )

  return <>{props.children}</>
}

/**
 * ClaxedoLayoutContent - The actual layout content
 */
function ClaxedoLayoutContent(props: ParentProps) {
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const platform = usePlatform()
  const params = useParams()
  const navigate = useNavigate()
  const claxedo = useClaxedoLayout()
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const backend = useBackend()
  const command = useCommand()
  const language = useLanguage()

  // Register backend switcher command
  command.register(() => [
    {
      id: "backend.list",
      title: "Switch backend",
      description: `Currently: ${backend.label}`,
      category: "Backend",
      keybind: "mod+shift+b",
      onSelect: () => {
        dialog.show(() => <DialogBackend />)
      },
    },
  ])

  // Auto-detect remote deployment with broken local proxy
  const [showSetup, setShowSetup] = createSignal(false)
  {
    const config = useConfigOptional()
    onMount(() => {
      void shouldShowLocalSetup(config?.sandboxEnabled).then((show) => {
        if (show) setShowSetup(true)
      })
    })
  }

  // Convert projects to ProjectItems
  const projects = createMemo(() => {
    const projectList = layout.projects.list()
    return projectList.map(projectToProjectItem)
  })

  const activeTab = createMemo(() => claxedo.topTabs.active())

  // Get active workspace ID (current directory)
  const activeWorkspaceId = createMemo(() => {
    if (!params.dir) return undefined
    return decodeDir(params.dir)
  })

  // Get active project (the project that contains the current workspace)
  const activeProjectId = createMemo(() => {
    const dir = activeWorkspaceId()
    if (!dir) return undefined

    const project = layout.projects.list().find((p) => p.worktree === dir || p.sandboxes?.includes(dir))
    return project?.worktree
  })

  // Per-group layout for focused group (file tree + review panel are per-group)
  const focusedGroupLayout = createMemo(() => claxedo.groupLayout(claxedo.split.focusedId()!))

  // Active tab type for focused group — used to hide filetree/review buttons on terminal tabs
  const focusedTabType = createMemo(() => {
    const focusedId = claxedo.split.focusedId()
    return focusedId ? claxedo.groupTabs(focusedId).active()?.type : undefined
  })

  // Initialize sync for the active workspace eagerly (no wait for globalSync)
  createEffect(() => {
    const dir = activeWorkspaceId()
    if (!dir) return
    globalSync.child(dir)
  })

  // Auto-open project when navigating to a workspace that isn't in the sidebar yet.
  // Must wait for globalSync.ready so rootFor() can resolve sandboxes to their parent project
  // — otherwise a sandbox directory gets added as a top-level project.
  createEffect(() => {
    if (!globalSync.ready) return
    const dir = activeWorkspaceId()
    if (!dir) return
    const existing = layout.projects.list().find((p) => p.worktree === dir || p.sandboxes?.includes(dir))
    if (existing) return
    layout.projects.open(dir)
  })

  // Auto-select main workspace when no workspace is selected.
  // Uses on() so the callback body is untracked — store reads inside
  // setPinned/setDefault/child don't become dependencies of this effect.
  createEffect(
    on(
      () => ({ dir: params.dir, projects: layout.projects.list() }),
      ({ dir, projects }) => {
        if (dir) return
        if (!projects.length) return
        const mainWorktree = projects[0].worktree
        if (!mainWorktree) return

        claxedo.worktree.setPinned(null)
        claxedo.worktree.setDefault(mainWorktree)
        globalSync.child(mainWorktree)
        queueMicrotask(() => navigate(`/${base64Encode(mainWorktree)}/session`, { replace: true }))
      },
    ),
  )

  // Sidebar selection should be driven by the active tab, not the URL.
  // When non-session tabs (terminal/file) are active, we intentionally clear the session highlight.
  const activeSessionId = createMemo(() => {
    const tab = activeTab()
    if (!tab) return params.id
    if (tab.type === "session" || tab.type === "review") {
      if (!tab.sessionId) return undefined
      if (tab.sessionId === "new") return undefined
      return tab.sessionId
    }
    return undefined
  })

  // Ensure we always have an active tab when a directory route is open.
  createEffect(() => {
    const dir = activeWorkspaceId()
    if (!dir) return
    if (claxedo.topTabs.activeId()) return
    if (params.id) return
    const id = claxedo.topTabs.addSession(dir, "new", "New Session")
    if (id) claxedo.topTabs.setActive(id)
  })

  // Sync active tab state to URL (Tabs -> URL)
  createEffect(() => {
    const tab = activeTab()
    // if (!tab) return <--- This was the bug: returning early left stale URL params
    if (!globalSync.ready) return

    const cur = activeWorkspaceId()
    const curId = params.id

    // If focused group is empty (no active tab), but URL has a session ID, clear it.
    // This prevents ClaxedoStateBridge from "resurrecting" the stale session ID into the empty group.
    if (!tab) {
      if (cur && curId) {
        queueMicrotask(() => navigate(`/${base64Encode(cur)}/session`))
      }
      return
    }

    const dir = tab.directory
    if (!dir) return

    if (dir !== cur) {
      if (tab.type === "session" && tab.sessionId && tab.sessionId !== "new") {
        queueMicrotask(() => navigate(`/${base64Encode(dir)}/session/${tab.sessionId}`))
        return
      }
      queueMicrotask(() => navigate(`/${base64Encode(dir)}/session`))
      return
    }

    if ((tab.type === "session" || tab.type === "review") && tab.sessionId) {
      if (tab.sessionId === "new") {
        if (curId) queueMicrotask(() => navigate(`/${base64Encode(dir)}/session`))
        return
      }
      if (tab.sessionId !== curId) queueMicrotask(() => navigate(`/${base64Encode(dir)}/session/${tab.sessionId}`))
    }
  })

  // Helper: Find project containing a workspace directory
  const findProjectForWorkspace = (workspaceDir: string): ProjectItem | undefined => {
    return projects().find((p) => p.worktree === workspaceDir || p.sandboxes?.includes(workspaceDir))
  }

  // Handlers

  // Handler for project selection - no-op since projects are always expanded
  const handleProjectSelect = (_project: ProjectItem) => {
    // Projects are always expanded now, so clicking the project header does nothing
  }

  // Handler for workspace selection
  const handleWorkspaceSelect = (project: ProjectItem, workspaceDir: string) => {
    // Record workspace recency
    claxedo.workspaceRecency.recordAccess(project.id, workspaceDir)

    // Set as default worktree
    claxedo.worktree.setPinned(null)
    claxedo.worktree.setDefault(workspaceDir)

    // Initialize sync for the workspace
    globalSync.child(workspaceDir)

    // Add a new session tab and navigate
    const id = claxedo.topTabs.addSession(workspaceDir, "new", "New Session")
    if (id) claxedo.topTabs.setActive(id)
    navigate(`/${base64Encode(workspaceDir)}/session`)
  }

  const handleSessionSelect = (workspaceDir: string, sessionId: string) => {
    // Record workspace recency for the session's project
    const project = findProjectForWorkspace(workspaceDir)
    if (project) {
      claxedo.workspaceRecency.recordAccess(project.id, workspaceDir)
    }

    // Navigate to the session
    navigate(`/${base64Encode(workspaceDir)}/session/${sessionId}`)

    // Get session title and add tab
    const [store] = globalSync.child(workspaceDir)
    const session = store.session?.find((s: Session) => s.id === sessionId && s.directory === workspaceDir)
    const title = session?.title || "Session"
    const summary = session?.summary

    const id = claxedo.topTabs.addSession(
      workspaceDir,
      sessionId,
      title,
      summary ? { additions: summary.additions ?? 0, deletions: summary.deletions ?? 0 } : undefined,
    )
    if (id) claxedo.topTabs.setActive(id)
  }

  const handleNewProject = () => {
    const config = useConfigOptional()

    // Handler for when a project directory is selected (local or cloud)
    const handleProjectSelected = (workspaceDir: string) => {
      if (!validWorktree(workspaceDir)) {
        showToast({
          title: "Invalid project path",
          description: workspaceDir,
          variant: "error",
        })
        return
      }
      // Add project to sidebar list
      layout.projects.open(workspaceDir)
      // Initialize sync for the new workspace
      globalSync.child(workspaceDir)
      // Set default worktree and open a new session tab
      claxedo.worktree.setPinned(null)
      claxedo.worktree.setDefault(workspaceDir)
      const id = claxedo.topTabs.addSession(workspaceDir, "new", "New Session")
      if (id) claxedo.topTabs.setActive(id)
      navigate(`/${base64Encode(workspaceDir)}/session`)
      dialog.close()
    }

    // Show local directory selector
    const showLocalDialog = () => {
      dialog.show(() => (
        <DialogSelectDirectory
          onSelect={(dir) => {
            if (typeof dir === "string") {
              handleProjectSelected(dir)
            }
          }}
        />
      ))
    }

    // Show cloud project creator
    const showCloudDialog = () => {
      dialog.show(() => (
        <DialogCreateCloudProject
          onSelect={(workspaceDir) => {
            if (typeof workspaceDir === "string") {
              handleProjectSelected(workspaceDir)
            }
          }}
        />
      ))
    }

    // If sandbox is enabled, show choice dialog
    if (config?.sandboxEnabled) {
      dialog.show(() => (
        <DialogNewProject
          onLocal={() => showLocalDialog()}
          onCloud={() => showCloudDialog()}
          onClose={() => dialog.close()}
        />
      ))
    } else {
      // Local only - go straight to directory selector
      showLocalDialog()
    }
  }

  const handleNewWorkspace = async (
    project: ProjectItem,
  ): Promise<import("./layouts/top-tab-bar").WorkspaceBarItem | undefined> => {
    const ext = getExtensions()
    const worktree = project.worktree

    const onWorktreeCreated = (created: string, name: string) => {
      // Initialize sync for new workspace
      globalSync.child(created)

      // Record recency for the new workspace
      claxedo.workspaceRecency.recordAccess(project.id, created)

      // Set newly created worktree as default (no pin)
      claxedo.worktree.setPinned(null)
      claxedo.worktree.setDefault(created)

      // Create a new session tab so the workspace appears in the workspace bar
      const tabId = claxedo.topTabs.addSession(created, "new", "New Session")
      if (tabId) claxedo.topTabs.setActive(tabId)

      // Navigate to the new session
      navigate(`/${base64Encode(created)}/session`)

      return {
        id: created,
        directory: created,
        name,
        projectWorktree: worktree,
        canDelete: true,
      }
    }

    const handleError = (err: unknown) => {
      if (
        err &&
        typeof err === "object" &&
        "name" in err &&
        (err as { name?: unknown }).name === "WorktreeNotGitError"
      ) {
        showToast({
          title: "Worktrees require a git project",
          description: message(err),
          variant: "error",
        })
        return
      }
      showToast({
        title: "Failed to create worktree",
        description: message(err),
        variant: "error",
      })
    }

    // Use extension's createWorkspace if available
    if (ext.app.createWorkspace) {
      try {
        const created = await ext.app.createWorkspace(worktree)
        if (created) return onWorktreeCreated(created, getFilename(created))
      } catch (err) {
        handleError(err)
      }
      return
    }

    try {
      const result = await globalSDK.client.worktree.create({ directory: worktree, worktreeCreateInput: {} })
      const created = result.data?.directory
      const name = result.data?.name
      if (created) return onWorktreeCreated(created, name ?? getFilename(created))
    } catch (err) {
      handleError(err)
    }
    return
  }

  const handleSettings = () => {
    dialog.show(() => <DialogSettings />)
  }

  const handleHelp = () => {
    platform.openLink("https://opencode.ai/docs")
  }

  const handleNewSession = (workspaceDir: string) => {
    // Navigate to new session
    navigate(`/${base64Encode(workspaceDir)}/session`)
    // Find the group whose worktree matches workspaceDir, falling back to focused group.
    // This ensures sidebar-triggered sessions land in the correct split panel.
    const targetGroup = claxedo.split.groups().find(
      (g) => claxedo.groupWorktree(g.id).default() === workspaceDir,
    )
    const tabs = targetGroup ? claxedo.groupTabs(targetGroup.id) : claxedo.topTabs
    const id = tabs.addSession(workspaceDir, "new", "New Session")
    if (id) tabs.setActive(id)
  }

  const handleDeleteSession = (sessionItem: SessionItem) => {
    const directory = sessionItem.directory
    if (!directory) return

    const [store, setStore] = globalSync.child(directory)
    const session = store.session?.find((s: Session) => s.id === sessionItem.id)
    if (!session) return

    dialog.show(() => (
      <DialogDeleteSession
        session={session}
        onDelete={async (s) => {
          try {
            await globalSDK.client.session.delete({ directory: s.directory, sessionID: s.id })

            // Manually remove from local store to prevent zombie sessions (sync lag)
            setStore(
              produce((draft: any) => {
                if (draft.session) {
                  draft.session = draft.session.filter((item: Session) => item.id !== s.id)
                }
              }),
            )

            // Close tab if open
            const tab = claxedo.topTabs.findSession(s.directory, s.id)
            if (tab) claxedo.topTabs.close(tab.id)
          } catch (error) {
            showToast({
              title: "Error deleting session",
              description: message(error),
              variant: "error",
            })
          }
        }}
        onClose={() => dialog.close()}
      />
    ))
  }

  const handleArchiveSession = async (sessionItem: SessionItem) => {
    const directory = sessionItem.directory
    if (!directory) return

    const [store, setStore] = globalSync.child(directory)
    const session = store.session?.find((s: Session) => s.id === sessionItem.id)
    if (!session) return

    try {
      await globalSDK.client.session.update({
        directory: session.directory,
        sessionID: session.id,
        time: { archived: Date.now() },
      })

      // Optimistic local update — remove from store so sidebar updates immediately
      setStore(
        produce((draft: any) => {
          if (draft.session) {
            draft.session = draft.session.filter((item: Session) => item.id !== session.id)
          }
        }),
      )

      // Close tab if open
      const tab = claxedo.topTabs.findSession(session.directory, session.id)
      if (tab) claxedo.topTabs.close(tab.id)

      showToast({
        title: "Session archived",
        description: `Session "${session.title}" has been archived.`,
        variant: "success",
        duration: 3000,
      })
    } catch (error) {
      showToast({
        title: "Error archiving session",
        description: message(error),
        variant: "error",
      })
    }
  }

  const handleDeleteWorkspace = (workspace: WorkspaceItem) => {
    dialog.show(() => (
      <DialogDeleteWorkspace
        directory={workspace.directory}
        isMain={workspace.isMain}
        isCloud={workspace.isCloud}
        onDelete={async (dir) => {
          const purge = () => {
            // Close all tabs for this workspace
            const tabs = claxedo.topTabs.items().filter((t) => t.directory === dir)
            for (const tab of tabs) {
              claxedo.topTabs.close(tab.id)
            }
            const [_, setChild] = globalSync.child(dir, { bootstrap: false })
            setChild("session", [])
            setChild("sessionTotal", 0)
            setChild("message", {})
            setChild("part", {})

            // Clean up workspace recency - remove deleted workspace from project's recency list
            const project = findProjectForWorkspace(dir)
            if (project) {
              const allWorkspaces = [project.worktree, ...(project.sandboxes ?? [])]
              const validWorkspaces = allWorkspaces.filter((ws) => ws !== dir)
              claxedo.workspaceRecency.cleanup(project.id, validWorkspaces)
            }
          }

          // Only destroy cloud sandbox when it's the main workspace of a cloud project
          if (workspace.isMain && workspace.isCloud) {
            // Main workspace deletion -> Destroy Sandbox
            const token = await getAuthToken()
            const headers: Record<string, string> = {}
            if (token) {
              headers["Authorization"] = `Bearer ${token}`
            }

            const res = await fetch(`/api/experimental/sandbox?directory=${encodeURIComponent(dir)}`, {
              method: "DELETE",
              headers,
            })
            if (!res.ok) {
              const err = await res.json().catch(() => ({}))
              throw new Error(err.error || "Failed to destroy sandbox")
            }

            purge()

            // Remove the project from the sidebar list
            // Use remove() for cloud since close() is a no-op for non-local servers
            layout.projects.remove(dir)

            navigate("/")
            showToast({
              title: "Sandbox Destroyed",
              description: "The sandbox has been destroyed.",
              variant: "success",
              duration: 3000,
            })
            return
          }

          const projectWorktree = workspace.projectWorktree ?? activeProjectId()
          if (!projectWorktree) return

          await globalSDK.client.worktree.remove({
            directory: projectWorktree,
            worktreeRemoveInput: { directory: dir },
          })

          purge()

          // Update project data to remove deleted sandbox
          const projectIndex = globalSync.data.project.findIndex((p) => p.worktree === projectWorktree)
          if (projectIndex !== -1) {
            const project = globalSync.data.project[projectIndex]
            if (project.sandboxes?.includes(dir)) {
              globalSync.set(
                "project",
                projectIndex,
                "sandboxes",
                project.sandboxes.filter((s) => s !== dir),
              )
            }
          }

          // Clear pinned state if deleted workspace was pinned
          if (claxedo.worktree.pinned() === dir) {
            claxedo.worktree.setPinned(null)
          }

          // Reset default to project's main worktree if deleted workspace was the default
          if (claxedo.worktree.default() === dir) {
            claxedo.worktree.setDefault(projectWorktree)
          }

          // Navigate away if current
          if (activeWorkspaceId() === dir) {
            navigate("/")
          }
        }}
        onClose={() => dialog.close()}
      />
    ))
  }

  const handleRemoveProject = (project: ProjectItem) => {
    const current = activeProjectId()

    // Just close it from the sidebar list
    layout.projects.close(project.worktree)

    if (current === project.worktree) {
      navigate("/")
    }
  }

  const handleNewTerminal = (workspaceDir: string, command?: string, title?: string) => {
    // Navigate to the workspace so the route-level TerminalProvider (and its
    // TerminalContentWrapperInner) has sdk.directory === workspaceDir.
    // Without this, the pending-create check (pendingDir !== dir) silently
    // drops the request when the workspace bar selected a different worktree
    // than the one in the URL.
    navigate(`/${base64Encode(workspaceDir)}/session`)
    claxedo.terminal.requestCreate(workspaceDir, command, title, claxedo.split.focusedId())
  }

  const handleTabSelect = (tab: TabItem) => {
    // For terminal tabs, just set active (content switches via TerminalContentWrapper)
    if (tab.type === "terminal") {
      // Terminal content is shown by TerminalContentWrapper, no navigation needed
      return
    }

    // Navigate based on tab type
    const workspaceDir = activeWorkspaceId()
    if (!workspaceDir) return

    if (tab.type === "session" && tab.sessionId) {
      // Navigate to the session
      if (tab.sessionId === "new") {
        navigate(`/${base64Encode(workspaceDir)}/session`)
      } else {
        navigate(`/${base64Encode(workspaceDir)}/session/${tab.sessionId}`)
      }
    } else if (tab.type === "review" && tab.sessionId) {
      // Navigate to session with review view
      navigate(`/${base64Encode(workspaceDir)}/session/${tab.sessionId}`)
    }
  }

  // Render empty state when no route content
  const renderEmpty = () => (
    <div class="flex flex-col items-center justify-center gap-4 h-full">
      <span class="text-16-medium text-text-strong">Welcome to Claxedo</span>
      <span class="text-14-regular text-text-weak">Select a project or create a new one to get started</span>
    </div>
  )

  return (
    <>
      <RailLayoutInner
        projects={projects()}
        activeProjectId={activeProjectId()}
        activeWorkspaceId={activeWorkspaceId()}
        activeSessionId={activeSessionId()}
        homedir={globalSync.data.path.home}
        onProjectSelect={handleProjectSelect}
        onWorkspaceSelect={handleWorkspaceSelect}
        onSessionSelect={handleSessionSelect}
        onNewProject={handleNewProject}
        onNewWorkspace={handleNewWorkspace}
        onSettings={handleSettings}
        onHelp={handleHelp}
        onNewSession={handleNewSession}
        onNewTerminal={handleNewTerminal}
        onTabSelect={handleTabSelect}
        onDeleteSession={handleDeleteSession}
        onArchiveSession={handleArchiveSession}
        onDeleteWorkspace={handleDeleteWorkspace}
        onRemoveProject={handleRemoveProject}
        // titlebar={<Titlebar />}
        topBarRight={
          <div class="flex items-center gap-3">
            <Show when={!backend.isNative}>
              <div
                class="flex items-center gap-1.5 rounded-sm h-[24px] py-1.5 px-2 text-12-medium bg-surface-info-base/20 text-text-accent"
                title={`${backend.label} via sandbox-agent`}
              >
                {backend.label}
              </div>
            </Show>
            <Show when={params.dir && focusedTabType() !== "terminal"}>
              <TooltipKeybind title={language.t("command.review.toggle")} keybind={command.keybind("review.toggle")}>
                <Button
                  variant="ghost"
                  class="group/review-toggle size-6 p-0"
                  onClick={() => {
                    const gl = focusedGroupLayout()
                    gl.reviewPanel.setOpened(!gl.reviewPanel.opened())
                  }}
                  aria-label={language.t("command.review.toggle")}
                  aria-expanded={focusedGroupLayout().reviewPanel.opened()}
                  aria-controls="review-panel"
                >
                  <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                    <Icon
                      size="small"
                      name={focusedGroupLayout().reviewPanel.opened() ? "layout-right-full" : "layout-right"}
                      class="group-hover/review-toggle:hidden"
                    />
                    <Icon
                      size="small"
                      name="layout-right-partial"
                      class="hidden group-hover/review-toggle:inline-block"
                    />
                    <Icon
                      size="small"
                      name={focusedGroupLayout().reviewPanel.opened() ? "layout-right" : "layout-right-full"}
                      class="hidden group-active/review-toggle:inline-block"
                    />
                  </div>
                </Button>
              </TooltipKeybind>
            </Show>
            <Show when={params.dir && focusedTabType() !== "terminal"}>
              <TooltipKeybind
                title={language.t("command.fileTree.toggle")}
                keybind={command.keybind("fileTree.toggle")}
              >
                <Button
                  variant="ghost"
                  class="group/file-tree-toggle size-6 p-0"
                  onClick={() => {
                    const gl = focusedGroupLayout()
                    gl.fileTree.setOpened(!gl.fileTree.opened())
                  }}
                  aria-label={language.t("command.fileTree.toggle")}
                  aria-expanded={focusedGroupLayout().fileTree.opened()}
                  aria-controls="file-tree-panel"
                >
                  <div class="relative flex items-center justify-center size-4">
                    <Icon
                      size="small"
                      name="bullet-list"
                      classList={{
                        "text-icon-strong": focusedGroupLayout().fileTree.opened(),
                        "text-icon-weak": !focusedGroupLayout().fileTree.opened(),
                      }}
                    />
                  </div>
                </Button>
              </TooltipKeybind>
            </Show>
          </div>
        }
      >
        {props.children}
      </RailLayoutInner>
      <Show when={showSetup()}>
        <DialogLocalSetup onDismiss={() => setShowSetup(false)} />
      </Show>
    </>
  )
}

/**
 * ClaxedoLayout - Main layout component for extension system
 *
 * Register this as `layoutComponent` in the app extensions.
 *
 * Note: TerminalProvider is NOT added here because ClaxedoLayout is at app level
 * (outside SDKProvider). Terminal context is provided via directoryProviders extension
 * point, which injects TerminalProvider at directory level.
 */
export function ClaxedoLayout(props: ParentProps) {
  return (
    <ClaxedoLayoutProvider>
      <Toast.Region />
      <BackendProvider>
        <ClaxedoStateBridge>
          <ClaxedoLayoutContent>{props.children}</ClaxedoLayoutContent>
        </ClaxedoStateBridge>
      </BackendProvider>
    </ClaxedoLayoutProvider>
  )
}

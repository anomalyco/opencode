import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  ParentProps,
  Show,
  Switch,
  untrack,
  type JSX,
} from "solid-js"
import { A, useNavigate, useParams } from "@solidjs/router"
import { useLayout, getAvatarColors, LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { Persist, persisted } from "@/utils/persist"
import { base64Decode, base64Encode } from "@opencode-ai/util/encode"
import { Avatar } from "@opencode-ai/ui/avatar"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { HoverCard } from "@opencode-ai/ui/hover-card"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { Spinner } from "@opencode-ai/ui/spinner"
import { getFilename } from "@opencode-ai/util/path"
import { Session } from "@opencode-ai/sdk/v2/client"
import { usePlatform } from "@/context/platform"
import { createStore, produce, reconcile } from "solid-js/store"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  createSortable,
} from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useProviders } from "@/hooks/use-providers"
import { showToast, Toast, toaster } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { Binary } from "@opencode-ai/util/binary"
import { retry } from "@opencode-ai/util/retry"

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useCommand, type CommandOption } from "@/context/command"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { navStart } from "@/utils/perf"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogEditProject } from "@/components/dialog-edit-project"
import { Titlebar } from "@/components/titlebar"
import { useServer } from "@/context/server"

export default function Layout(props: ParentProps) {
  const [store, setStore, , ready] = persisted(
    Persist.global("layout.page", ["layout.page.v1"]),
    createStore({
      lastSession: {} as { [directory: string]: string },
      activeProject: undefined as string | undefined,
      activeWorkspace: undefined as string | undefined,
      workspaceOrder: {} as Record<string, string[]>,
      workspaceExpanded: {} as Record<string, boolean>,
    }),
  )

  const pageReady = createMemo(() => ready())

  let scrollContainerRef: HTMLDivElement | undefined
  const xlQuery = window.matchMedia("(min-width: 1280px)")
  const [isLargeViewport, setIsLargeViewport] = createSignal(xlQuery.matches)
  const handleViewportChange = (e: MediaQueryListEvent) => setIsLargeViewport(e.matches)
  xlQuery.addEventListener("change", handleViewportChange)
  onCleanup(() => xlQuery.removeEventListener("change", handleViewportChange))

  const params = useParams()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const layoutReady = createMemo(() => layout.ready())
  const platform = usePlatform()
  const server = useServer()
  const notification = useNotification()
  const permission = usePermission()
  const navigate = useNavigate()
  const providers = useProviders()
  const dialog = useDialog()
  const command = useCommand()
  const theme = useTheme()
  const availableThemeEntries = createMemo(() => Object.entries(theme.themes()))
  const colorSchemeOrder: ColorScheme[] = ["system", "light", "dark"]
  const colorSchemeLabel: Record<ColorScheme, string> = {
    system: "System",
    light: "Light",
    dark: "Dark",
  }

  function cycleTheme(direction = 1) {
    const ids = availableThemeEntries().map(([id]) => id)
    if (ids.length === 0) return
    const currentIndex = ids.indexOf(theme.themeId())
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + ids.length) % ids.length
    const nextThemeId = ids[nextIndex]
    theme.setTheme(nextThemeId)
    const nextTheme = theme.themes()[nextThemeId]
    showToast({
      title: "Theme switched",
      description: nextTheme?.name ?? nextThemeId,
    })
  }

  function cycleColorScheme(direction = 1) {
    const current = theme.colorScheme()
    const currentIndex = colorSchemeOrder.indexOf(current)
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + direction + colorSchemeOrder.length) % colorSchemeOrder.length
    const next = colorSchemeOrder[nextIndex]
    theme.setColorScheme(next)
    showToast({
      title: "Color scheme",
      description: colorSchemeLabel[next],
    })
  }

  onMount(() => {
    if (!platform.checkUpdate || !platform.update || !platform.restart) return

    let toastId: number | undefined

    async function pollUpdate() {
      const { updateAvailable, version } = await platform.checkUpdate!()
      if (updateAvailable && toastId === undefined) {
        toastId = showToast({
          persistent: true,
          icon: "download",
          title: "Update available",
          description: `A new version of OpenCode (${version}) is now available to install.`,
          actions: [
            {
              label: "Install and restart",
              onClick: async () => {
                await platform.update!()
                await platform.restart!()
              },
            },
            {
              label: "Not yet",
              onClick: "dismiss",
            },
          ],
        })
      }
    }

    pollUpdate()
    const interval = setInterval(pollUpdate, 10 * 60 * 1000)
    onCleanup(() => clearInterval(interval))
  })

  onMount(() => {
    const alerts = {
      "permission.asked": {
        title: "Permission required",
        icon: "checklist" as const,
        description: (sessionTitle: string, projectName: string) =>
          `${sessionTitle} in ${projectName} needs permission`,
      },
      "question.asked": {
        title: "Question",
        icon: "bubble-5" as const,
        description: (sessionTitle: string, projectName: string) => `${sessionTitle} in ${projectName} has a question`,
      },
    }

    const toastBySession = new Map<string, number>()
    const alertedAtBySession = new Map<string, number>()
    const cooldownMs = 5000

    const unsub = globalSDK.event.listen((e) => {
      if (e.details?.type !== "permission.asked" && e.details?.type !== "question.asked") return
      const config = alerts[e.details.type]
      const directory = e.name
      const props = e.details.properties
      if (e.details.type === "permission.asked" && permission.autoResponds(e.details.properties, directory)) return

      const [store] = globalSync.child(directory)
      const session = store.session.find((s) => s.id === props.sessionID)
      const sessionKey = `${directory}:${props.sessionID}`

      const sessionTitle = session?.title ?? "New session"
      const projectName = getFilename(directory)
      const description = config.description(sessionTitle, projectName)
      const href = `/${base64Encode(directory)}/session/${props.sessionID}`

      const now = Date.now()
      const lastAlerted = alertedAtBySession.get(sessionKey) ?? 0
      if (now - lastAlerted < cooldownMs) return
      alertedAtBySession.set(sessionKey, now)

      void platform.notify(config.title, description, href)

      const currentDir = params.dir ? base64Decode(params.dir) : undefined
      const currentSession = params.id
      if (directory === currentDir && props.sessionID === currentSession) return
      if (directory === currentDir && session?.parentID === currentSession) return

      const existingToastId = toastBySession.get(sessionKey)
      if (existingToastId !== undefined) toaster.dismiss(existingToastId)

      const toastId = showToast({
        persistent: true,
        icon: config.icon,
        title: config.title,
        description,
        actions: [
          {
            label: "Go to session",
            onClick: () => navigate(href),
          },
          {
            label: "Dismiss",
            onClick: "dismiss",
          },
        ],
      })
      toastBySession.set(sessionKey, toastId)
    })
    onCleanup(unsub)

    createEffect(() => {
      const currentDir = params.dir ? base64Decode(params.dir) : undefined
      const currentSession = params.id
      if (!currentDir || !currentSession) return
      const sessionKey = `${currentDir}:${currentSession}`
      const toastId = toastBySession.get(sessionKey)
      if (toastId !== undefined) {
        toaster.dismiss(toastId)
        toastBySession.delete(sessionKey)
        alertedAtBySession.delete(sessionKey)
      }
      const [store] = globalSync.child(currentDir)
      const childSessions = store.session.filter((s) => s.parentID === currentSession)
      for (const child of childSessions) {
        const childKey = `${currentDir}:${child.id}`
        const childToastId = toastBySession.get(childKey)
        if (childToastId !== undefined) {
          toaster.dismiss(childToastId)
          toastBySession.delete(childKey)
          alertedAtBySession.delete(childKey)
        }
      }
    })
  })

  function sortSessions(a: Session, b: Session) {
    const now = Date.now()
    const oneMinuteAgo = now - 60 * 1000
    const aUpdated = a.time.updated ?? a.time.created
    const bUpdated = b.time.updated ?? b.time.created
    const aRecent = aUpdated > oneMinuteAgo
    const bRecent = bUpdated > oneMinuteAgo
    if (aRecent && bRecent) return a.id.localeCompare(b.id)
    if (aRecent && !bRecent) return -1
    if (!aRecent && bRecent) return 1
    return bUpdated - aUpdated
  }

  function scrollToSession(sessionId: string) {
    if (!scrollContainerRef) return
    const element = scrollContainerRef.querySelector(`[data-session-id="${sessionId}"]`)
    if (element) {
      element.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  }

  const currentProject = createMemo(() => {
    const directory = params.dir ? base64Decode(params.dir) : undefined
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })

  const workspaceSetting = createMemo(() => {
    const project = currentProject()
    if (!project) return false
    return layout.sidebar.workspaces(project.worktree)()
  })

  createEffect(() => {
    if (!pageReady()) return
    if (!layoutReady()) return
    const project = currentProject()
    if (!project) return

    const dirs = [project.worktree, ...(project.sandboxes ?? [])]
    const existing = store.workspaceOrder[project.worktree]
    if (!existing) {
      setStore("workspaceOrder", project.worktree, dirs)
      return
    }

    const keep = existing.filter((d) => dirs.includes(d))
    const missing = dirs.filter((d) => !existing.includes(d))
    const merged = [...keep, ...missing]

    if (merged.length !== existing.length) {
      setStore("workspaceOrder", project.worktree, merged)
      return
    }

    if (merged.some((d, i) => d !== existing[i])) {
      setStore("workspaceOrder", project.worktree, merged)
    }
  })

  createEffect(() => {
    if (!pageReady()) return
    if (!layoutReady()) return
    for (const [directory, expanded] of Object.entries(store.workspaceExpanded)) {
      if (layout.sidebar.workspaces(directory)()) continue
      if (!expanded) continue
      setStore("workspaceExpanded", directory, false)
    }
  })

  const currentSessions = createMemo(() => {
    const project = currentProject()
    if (!project) return [] as Session[]
    if (workspaceSetting()) {
      const dirs = workspaceIds(project)
      const result: Session[] = []
      for (const dir of dirs) {
        const [dirStore] = globalSync.child(dir)
        const dirSessions = dirStore.session
          .filter((session) => session.directory === dirStore.path.directory)
          .filter((session) => !session.parentID)
          .toSorted(sortSessions)
        result.push(...dirSessions)
      }
      return result
    }
    const [projectStore] = globalSync.child(project.worktree)
    return projectStore.session
      .filter((session) => session.directory === projectStore.path.directory)
      .filter((session) => !session.parentID)
      .toSorted(sortSessions)
  })

  type PrefetchQueue = {
    inflight: Set<string>
    pending: string[]
    pendingSet: Set<string>
    running: number
  }

  const prefetchChunk = 200
  const prefetchConcurrency = 1
  const prefetchPendingLimit = 6
  const prefetchToken = { value: 0 }
  const prefetchQueues = new Map<string, PrefetchQueue>()

  createEffect(() => {
    params.dir
    globalSDK.url

    prefetchToken.value += 1
    for (const q of prefetchQueues.values()) {
      q.pending.length = 0
      q.pendingSet.clear()
    }
  })

  const queueFor = (directory: string) => {
    const existing = prefetchQueues.get(directory)
    if (existing) return existing

    const created: PrefetchQueue = {
      inflight: new Set(),
      pending: [],
      pendingSet: new Set(),
      running: 0,
    }
    prefetchQueues.set(directory, created)
    return created
  }

  async function prefetchMessages(directory: string, sessionID: string, token: number) {
    const [, setStore] = globalSync.child(directory)

    return retry(() => globalSDK.client.session.messages({ directory, sessionID, limit: prefetchChunk }))
      .then((messages) => {
        if (prefetchToken.value !== token) return

        const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
        const next = items
          .map((x) => x.info)
          .filter((m) => !!m?.id)
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))

        batch(() => {
          setStore("message", sessionID, reconcile(next, { key: "id" }))

          for (const message of items) {
            setStore(
              "part",
              message.info.id,
              reconcile(
                message.parts
                  .filter((p) => !!p?.id)
                  .slice()
                  .sort((a, b) => a.id.localeCompare(b.id)),
                { key: "id" },
              ),
            )
          }
        })
      })
      .catch(() => undefined)
  }

  const pumpPrefetch = (directory: string) => {
    const q = queueFor(directory)
    if (q.running >= prefetchConcurrency) return

    const sessionID = q.pending.shift()
    if (!sessionID) return

    q.pendingSet.delete(sessionID)
    q.inflight.add(sessionID)
    q.running += 1

    const token = prefetchToken.value

    void prefetchMessages(directory, sessionID, token).finally(() => {
      q.running -= 1
      q.inflight.delete(sessionID)
      pumpPrefetch(directory)
    })
  }

  const prefetchSession = (session: Session, priority: "high" | "low" = "low") => {
    const directory = session.directory
    if (!directory) return

    const [store] = globalSync.child(directory)
    if (store.message[session.id] !== undefined) return

    const q = queueFor(directory)
    if (q.inflight.has(session.id)) return
    if (q.pendingSet.has(session.id)) return

    if (priority === "high") q.pending.unshift(session.id)
    if (priority !== "high") q.pending.push(session.id)
    q.pendingSet.add(session.id)

    while (q.pending.length > prefetchPendingLimit) {
      const dropped = q.pending.pop()
      if (!dropped) continue
      q.pendingSet.delete(dropped)
    }

    pumpPrefetch(directory)
  }

  createEffect(() => {
    const sessions = currentSessions()
    const id = params.id

    if (!id) {
      const first = sessions[0]
      if (first) prefetchSession(first)

      const second = sessions[1]
      if (second) prefetchSession(second)
      return
    }

    const index = sessions.findIndex((s) => s.id === id)
    if (index === -1) return

    const next = sessions[index + 1]
    if (next) prefetchSession(next)

    const prev = sessions[index - 1]
    if (prev) prefetchSession(prev)
  })

  function navigateSessionByOffset(offset: number) {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const sessionIndex = params.id ? sessions.findIndex((s) => s.id === params.id) : -1

    let targetIndex: number
    if (sessionIndex === -1) {
      targetIndex = offset > 0 ? 0 : sessions.length - 1
    } else {
      targetIndex = (sessionIndex + offset + sessions.length) % sessions.length
    }

    const session = sessions[targetIndex]
    if (!session) return

    const next = sessions[(targetIndex + 1) % sessions.length]
    const prev = sessions[(targetIndex - 1 + sessions.length) % sessions.length]

    if (offset > 0) {
      if (next) prefetchSession(next, "high")
      if (prev) prefetchSession(prev)
    }

    if (offset < 0) {
      if (prev) prefetchSession(prev, "high")
      if (next) prefetchSession(next)
    }

    if (import.meta.env.DEV) {
      navStart({
        dir: base64Encode(session.directory),
        from: params.id,
        to: session.id,
        trigger: offset > 0 ? "alt+arrowdown" : "alt+arrowup",
      })
    }
    navigateToSession(session)
    queueMicrotask(() => scrollToSession(session.id))
  }

  async function archiveSession(session: Session) {
    const [store, setStore] = globalSync.child(session.directory)
    const sessions = store.session ?? []
    const index = sessions.findIndex((s) => s.id === session.id)
    const nextSession = sessions[index + 1] ?? sessions[index - 1]

    await globalSDK.client.session.update({
      directory: session.directory,
      sessionID: session.id,
      time: { archived: Date.now() },
    })
    setStore(
      produce((draft) => {
        const match = Binary.search(draft.session, session.id, (s) => s.id)
        if (match.found) draft.session.splice(match.index, 1)
      }),
    )
    if (session.id === params.id) {
      if (nextSession) {
        navigate(`/${params.dir}/session/${nextSession.id}`)
      } else {
        navigate(`/${params.dir}/session`)
      }
    }
  }

  command.register(() => {
    const commands: CommandOption[] = [
      {
        id: "sidebar.toggle",
        title: "Toggle sidebar",
        category: "View",
        keybind: "mod+b",
        onSelect: () => layout.sidebar.toggle(),
      },
      {
        id: "project.open",
        title: "Open project",
        category: "Project",
        keybind: "mod+o",
        onSelect: () => chooseProject(),
      },
      {
        id: "provider.connect",
        title: "Connect provider",
        category: "Provider",
        onSelect: () => connectProvider(),
      },
      {
        id: "server.switch",
        title: "Switch server",
        category: "Server",
        onSelect: () => openServer(),
      },
      {
        id: "session.previous",
        title: "Previous session",
        category: "Session",
        keybind: "alt+arrowup",
        onSelect: () => navigateSessionByOffset(-1),
      },
      {
        id: "session.next",
        title: "Next session",
        category: "Session",
        keybind: "alt+arrowdown",
        onSelect: () => navigateSessionByOffset(1),
      },
      {
        id: "session.archive",
        title: "Archive session",
        category: "Session",
        keybind: "mod+shift+backspace",
        disabled: !params.dir || !params.id,
        onSelect: () => {
          const session = currentSessions().find((s) => s.id === params.id)
          if (session) archiveSession(session)
        },
      },
      {
        id: "theme.cycle",
        title: "Cycle theme",
        category: "Theme",
        keybind: "mod+shift+t",
        onSelect: () => cycleTheme(1),
      },
    ]

    for (const [id, definition] of availableThemeEntries()) {
      commands.push({
        id: `theme.set.${id}`,
        title: `Use theme: ${definition.name ?? id}`,
        category: "Theme",
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewTheme(id)
          return () => theme.cancelPreview()
        },
      })
    }

    commands.push({
      id: "theme.scheme.cycle",
      title: "Cycle color scheme",
      category: "Theme",
      keybind: "mod+shift+s",
      onSelect: () => cycleColorScheme(1),
    })

    for (const scheme of colorSchemeOrder) {
      commands.push({
        id: `theme.scheme.${scheme}`,
        title: `Use color scheme: ${colorSchemeLabel[scheme]}`,
        category: "Theme",
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewColorScheme(scheme)
          return () => theme.cancelPreview()
        },
      })
    }

    return commands
  })

  function connectProvider() {
    dialog.show(() => <DialogSelectProvider />)
  }

  function openServer() {
    dialog.show(() => <DialogSelectServer />)
  }

  function navigateToProject(directory: string | undefined) {
    if (!directory) return
    const lastSession = store.lastSession[directory]
    navigate(`/${base64Encode(directory)}${lastSession ? `/session/${lastSession}` : ""}`)
    layout.mobileSidebar.hide()
  }

  function navigateToSession(session: Session | undefined) {
    if (!session) return
    navigate(`/${base64Encode(session.directory)}/session/${session.id}`)
    layout.mobileSidebar.hide()
  }

  function openProject(directory: string, navigate = true) {
    layout.projects.open(directory)
    if (navigate) navigateToProject(directory)
  }

  function closeProject(directory: string) {
    const index = layout.projects.list().findIndex((x) => x.worktree === directory)
    const next = layout.projects.list()[index + 1]
    layout.projects.close(directory)
    if (next) navigateToProject(next.worktree)
    else navigate("/")
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory, false)
        }
        navigateToProject(result[0])
      } else if (result) {
        openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: "Open project",
        multiple: true,
      })
      resolve(result)
    } else {
      dialog.show(
        () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
        () => resolve(null),
      )
    }
  }

  createEffect(() => {
    if (!pageReady()) return
    if (!params.dir || !params.id) return
    const directory = base64Decode(params.dir)
    const id = params.id
    setStore("lastSession", directory, id)
    notification.session.markViewed(id)
    untrack(() => setStore("workspaceExpanded", directory, (value) => value ?? true))
    requestAnimationFrame(() => scrollToSession(id))
  })

  createEffect(() => {
    const project = currentProject()
    if (!project) return

    if (workspaceSetting()) {
      const dirs = [project.worktree, ...(project.sandboxes ?? [])]
      for (const directory of dirs) {
        globalSync.project.loadSessions(directory)
      }
      return
    }

    globalSync.project.loadSessions(project.worktree)
  })

  createEffect(() => {
    if (isLargeViewport()) {
      const sidebarWidth = layout.sidebar.opened() ? layout.sidebar.width() : 64
      document.documentElement.style.setProperty("--dialog-left-margin", `${sidebarWidth}px`)
      return
    }
    document.documentElement.style.setProperty("--dialog-left-margin", "0px")
  })

  function getDraggableId(event: unknown): string | undefined {
    if (typeof event !== "object" || event === null) return undefined
    if (!("draggable" in event)) return undefined
    const draggable = (event as { draggable?: { id?: unknown } }).draggable
    if (!draggable) return undefined
    return typeof draggable.id === "string" ? draggable.id : undefined
  }

  function handleDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeProject", id)
  }

  function handleDragOver(event: DragEvent) {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const projects = layout.projects.list()
      const fromIndex = projects.findIndex((p) => p.worktree === draggable.id.toString())
      const toIndex = projects.findIndex((p) => p.worktree === droppable.id.toString())
      if (fromIndex !== toIndex && toIndex !== -1) {
        layout.projects.move(draggable.id.toString(), toIndex)
      }
    }
  }

  function handleDragEnd() {
    setStore("activeProject", undefined)
  }

  function workspaceIds(project: LocalProject | undefined) {
    if (!project) return []
    const dirs = [project.worktree, ...(project.sandboxes ?? [])]
    const existing = store.workspaceOrder[project.worktree]
    if (!existing) return dirs

    const keep = existing.filter((d) => dirs.includes(d))
    const missing = dirs.filter((d) => !existing.includes(d))
    return [...keep, ...missing]
  }

  function handleWorkspaceDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeWorkspace", id)
  }

  function handleWorkspaceDragOver(event: DragEvent) {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const project = currentProject()
    if (!project) return

    const ids = workspaceIds(project)
    const fromIndex = ids.findIndex((dir) => dir === draggable.id.toString())
    const toIndex = ids.findIndex((dir) => dir === droppable.id.toString())
    if (fromIndex === -1 || toIndex === -1) return
    if (fromIndex === toIndex) return

    const result = ids.slice()
    const [item] = result.splice(fromIndex, 1)
    if (!item) return
    result.splice(toIndex, 0, item)
    setStore("workspaceOrder", project.worktree, result)
  }

  function handleWorkspaceDragEnd() {
    setStore("activeWorkspace", undefined)
  }

  const ProjectIcon = (props: { project: LocalProject; class?: string; notify?: boolean }): JSX.Element => {
    const notification = useNotification()
    const notifications = createMemo(() => notification.project.unseen(props.project.worktree))
    const hasError = createMemo(() => notifications().some((n) => n.type === "error"))
    const name = createMemo(() => props.project.name || getFilename(props.project.worktree))
    const mask = "radial-gradient(circle 6px at calc(100% - 3px) 3px, transparent 6px, black 6.5px)"
    const opencode = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

    return (
      <div class={`relative size-8 shrink-0 rounded ${props.class ?? ""}`}>
        <div class="size-full rounded overflow-clip">
          <Avatar
            fallback={name()}
            src={props.project.id === opencode ? "https://opencode.ai/favicon.svg" : props.project.icon?.url}
            {...getAvatarColors(props.project.icon?.color)}
            class="size-full rounded"
            style={
              notifications().length > 0 && props.notify
                ? { "-webkit-mask-image": mask, "mask-image": mask }
                : undefined
            }
          />
        </div>
        <Show when={notifications().length > 0 && props.notify}>
          <div
            classList={{
              "absolute -top-px -right-px size-2 rounded-full z-10": true,
              "bg-icon-critical-base": hasError(),
              "bg-text-interactive-base": !hasError(),
            }}
          />
        </Show>
      </div>
    )
  }

  const SessionItem = (props: { session: Session; slug: string; mobile?: boolean; dense?: boolean }): JSX.Element => {
    const notification = useNotification()
    const notifications = createMemo(() => notification.session.unseen(props.session.id))
    const hasError = createMemo(() => notifications().some((n) => n.type === "error"))
    const [sessionStore] = globalSync.child(props.session.directory)
    const hasPermissions = createMemo(() => {
      const permissions = sessionStore.permission?.[props.session.id] ?? []
      if (permissions.length > 0) return true
      const childSessions = sessionStore.session.filter((s) => s.parentID === props.session.id)
      for (const child of childSessions) {
        const childPermissions = sessionStore.permission?.[child.id] ?? []
        if (childPermissions.length > 0) return true
      }
      return false
    })
    const isWorking = createMemo(() => {
      if (hasPermissions()) return false
      const status = sessionStore.session_status[props.session.id]
      return status?.type === "busy" || status?.type === "retry"
    })

    const tint = createMemo(() => {
      const messages = sessionStore.message[props.session.id]
      if (!messages) return undefined
      const user = messages
        .slice()
        .reverse()
        .find((m) => m.role === "user")
      if (!user?.agent) return undefined

      const agent = sessionStore.agent.find((a) => a.name === user.agent)
      return agent?.color
    })

    return (
      <div
        data-session-id={props.session.id}
        class="group/session relative w-full rounded-md cursor-default transition-colors pl-2 pr-3
               hover:bg-surface-raised-base-hover focus-within:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active"
      >
        <Tooltip placement={props.mobile ? "bottom" : "right"} value={props.session.title} gutter={16} openDelay={1000}>
          <A
            href={`${props.slug}/session/${props.session.id}`}
            class={`flex items-center justify-between gap-3 min-w-0 text-left w-full focus:outline-none transition-[padding] group-hover/session:pr-7 group-focus-within/session:pr-7 group-active/session:pr-7 ${props.dense ? "py-0.5" : "py-1"}`}
            onMouseEnter={() => prefetchSession(props.session, "high")}
            onFocus={() => prefetchSession(props.session, "high")}
          >
            <div class="flex items-center gap-1 w-full">
              <div
                class="shrink-0 size-6 flex items-center justify-center"
                style={{ color: tint() ?? "var(--icon-interactive-base)" }}
              >
                <Switch fallback={<Icon name="dash" size="small" class="text-icon-weak" />}>
                  <Match when={isWorking()}>
                    <Spinner class="size-[15px]" />
                  </Match>
                  <Match when={hasPermissions()}>
                    <div class="size-1.5 rounded-full bg-surface-warning-strong" />
                  </Match>
                  <Match when={hasError()}>
                    <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
                  </Match>
                  <Match when={notifications().length > 0}>
                    <div class="size-1.5 rounded-full bg-text-interactive-base" />
                  </Match>
                </Switch>
              </div>
              <span class="text-14-regular text-text-strong grow-1 min-w-0 overflow-hidden text-ellipsis truncate">
                {props.session.title}
              </span>
              <Show when={props.session.summary}>
                {(summary) => (
                  <div class="group-hover/session:hidden group-active/session:hidden group-focus-within/session:hidden">
                    <DiffChanges changes={summary()} />
                  </div>
                )}
              </Show>
            </div>
          </A>
        </Tooltip>
        <div
          class={`hidden group-hover/session:flex group-active/session:flex group-focus-within/session:flex text-text-base gap-1 items-center absolute ${props.dense ? "top-0.5 right-0.5" : "top-1 right-1"}`}
        >
          <TooltipKeybind
            placement={props.mobile ? "bottom" : "right"}
            title="Archive session"
            keybind={command.keybind("session.archive")}
            gutter={8}
          >
            <IconButton icon="archive" variant="ghost" onClick={() => archiveSession(props.session)} />
          </TooltipKeybind>
        </div>
      </div>
    )
  }

  const SessionSkeleton = (props: { count?: number }): JSX.Element => {
    const items = Array.from({ length: props.count ?? 4 }, (_, index) => index)
    return (
      <div class="flex flex-col gap-1">
        <For each={items}>
          {() => <div class="h-8 w-full rounded-md bg-surface-raised-base opacity-60 animate-pulse" />}
        </For>
      </div>
    )
  }

  const SortableProject = (props: { project: LocalProject; mobile?: boolean }): JSX.Element => {
    const sortable = createSortable(props.project.worktree)
    const selected = createMemo(() => {
      const current = params.dir ? base64Decode(params.dir) : ""
      return props.project.worktree === current || props.project.sandboxes?.includes(current)
    })

    const workspaces = createMemo(() => workspaceIds(props.project).slice(0, 2))
    const workspaceEnabled = createMemo(() => layout.sidebar.workspaces(props.project.worktree)())
    const label = (directory: string) => {
      const [data] = globalSync.child(directory)
      const kind = directory === props.project.worktree ? "local" : "sandbox"
      const name = data.vcs?.branch ?? getFilename(directory)
      return `${kind} : ${name}`
    }

    const sessions = (directory: string) => {
      const [data] = globalSync.child(directory)
      return data.session
        .filter((session) => session.directory === data.path.directory)
        .filter((session) => !session.parentID)
        .toSorted(sortSessions)
        .slice(0, 2)
    }

    const projectSessions = () => {
      const [data] = globalSync.child(props.project.worktree)
      return data.session
        .filter((session) => session.directory === data.path.directory)
        .filter((session) => !session.parentID)
        .toSorted(sortSessions)
        .slice(0, 2)
    }

    const trigger = (
      <button
        type="button"
        classList={{
          "flex items-center justify-center size-10 p-1 rounded-lg overflow-hidden transition-colors cursor-default": true,
          "bg-transparent border-2 border-icon-strong-base hover:bg-surface-base-hover": selected(),
          "bg-transparent border border-transparent hover:bg-surface-base-hover hover:border-border-weak-base":
            !selected(),
        }}
        onClick={() => navigateToProject(props.project.worktree)}
      >
        <ProjectIcon project={props.project} notify />
      </button>
    )

    return (
      // @ts-ignore
      <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
        <HoverCard openDelay={0} closeDelay={0} placement="right-start" gutter={8} trigger={trigger}>
          <div class="-m-3 flex flex-col w-72">
            <div class="px-3 py-2 text-12-medium text-text-weak">Recent sessions</div>
            <div class="px-2 pb-2 flex flex-col gap-2">
              <Show
                when={workspaceEnabled()}
                fallback={
                  <For each={projectSessions()}>
                    {(session) => (
                      <SessionItem
                        session={session}
                        slug={base64Encode(props.project.worktree)}
                        dense
                        mobile={props.mobile}
                      />
                    )}
                  </For>
                }
              >
                <For each={workspaces()}>
                  {(directory) => (
                    <div class="flex flex-col gap-1">
                      <div class="px-2 py-0.5 flex items-center gap-1 min-w-0">
                        <div class="shrink-0 size-6 flex items-center justify-center">
                          <Icon name="branch" size="small" class="text-icon-base" />
                        </div>
                        <span class="truncate text-14-medium text-text-base">{label(directory)}</span>
                      </div>
                      <For each={sessions(directory)}>
                        {(session) => (
                          <SessionItem session={session} slug={base64Encode(directory)} dense mobile={props.mobile} />
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </Show>
            </div>
            <Show when={!selected()}>
              <div class="px-2 py-2 border-t border-border-weak-base">
                <Button
                  variant="ghost"
                  class="flex w-full text-left justify-start text-text-base px-2 hover:bg-transparent active:bg-transparent"
                  onClick={() => {
                    layout.sidebar.open()
                    navigateToProject(props.project.worktree)
                  }}
                >
                  View all sessions
                </Button>
              </div>
            </Show>
          </div>
        </HoverCard>
      </div>
    )
  }

  const ProjectDragOverlay = (): JSX.Element => {
    const project = createMemo(() => layout.projects.list().find((p) => p.worktree === store.activeProject))
    return (
      <Show when={project()}>
        {(p) => (
          <div class="bg-background-base rounded-xl p-1">
            <ProjectIcon project={p()} />
          </div>
        )}
      </Show>
    )
  }

  const WorkspaceDragOverlay = (): JSX.Element => {
    const label = createMemo(() => {
      const project = currentProject()
      if (!project) return
      const directory = store.activeWorkspace
      if (!directory) return

      const [workspaceStore] = globalSync.child(directory)
      const kind = directory === project.worktree ? "local" : "sandbox"
      const name = workspaceStore.vcs?.branch ?? getFilename(directory)
      return `${kind} : ${name}`
    })

    return (
      <Show when={label()}>
        {(value) => (
          <div class="bg-background-base rounded-md px-2 py-1 text-14-medium text-text-strong">{value()}</div>
        )}
      </Show>
    )
  }

  const SortableWorkspace = (props: { directory: string; project: LocalProject; mobile?: boolean }): JSX.Element => {
    const sortable = createSortable(props.directory)
    const [workspaceStore, setWorkspaceStore] = globalSync.child(props.directory)
    const slug = createMemo(() => base64Encode(props.directory))
    const sessions = createMemo(() =>
      workspaceStore.session
        .filter((session) => session.directory === workspaceStore.path.directory)
        .filter((session) => !session.parentID)
        .toSorted(sortSessions),
    )
    const local = createMemo(() => props.directory === props.project.worktree)
    const title = createMemo(() => {
      const kind = local() ? "local" : "sandbox"
      const name = workspaceStore.vcs?.branch ?? getFilename(props.directory)
      return `${kind} : ${name}`
    })
    const open = createMemo(() => store.workspaceExpanded[props.directory] ?? true)
    const loading = createMemo(() => open() && workspaceStore.status !== "complete" && sessions().length === 0)
    const hasMore = createMemo(() => local() && workspaceStore.sessionTotal > workspaceStore.session.length)
    const loadMore = async () => {
      if (!local()) return
      setWorkspaceStore("limit", (limit) => limit + 5)
      await globalSync.project.loadSessions(props.directory)
    }

    return (
      // @ts-ignore
      <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
        <Collapsible
          variant="ghost"
          open={open()}
          class="shrink-0"
          onOpenChange={(value) => setStore("workspaceExpanded", props.directory, value)}
        >
          <div class="px-2 py-1">
            <div class="group/trigger relative">
              <Collapsible.Trigger class="flex items-center justify-between w-full pl-2 pr-16 py-1.5 rounded-md hover:bg-surface-raised-base-hover">
                <div class="flex items-center gap-1 min-w-0">
                  <div class="flex items-center justify-center shrink-0 size-6">
                    <Icon name="branch" size="small" />
                  </div>
                  <span class="truncate text-14-medium text-text-base">{title()}</span>
                  <Icon
                    name={open() ? "chevron-down" : "chevron-right"}
                    size="small"
                    class="shrink-0 text-icon-base opacity-0 transition-opacity group-hover/trigger:opacity-100 group-focus-within/trigger:opacity-100"
                  />
                </div>
              </Collapsible.Trigger>
              <div class="absolute right-1 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 pointer-events-none group-hover/trigger:flex group-focus-within/trigger:flex">
                <IconButton icon="dot-grid" variant="ghost" class="size-6 rounded-md pointer-events-auto" />
                <TooltipKeybind
                  class="pointer-events-auto"
                  placement="right"
                  title="New session"
                  keybind={command.keybind("session.new")}
                >
                  <IconButton
                    icon="plus-small"
                    variant="ghost"
                    class="size-6 rounded-md"
                    onClick={() => navigate(`/${slug()}/session`)}
                  />
                </TooltipKeybind>
              </div>
            </div>
          </div>
          <Collapsible.Content>
            <nav class="flex flex-col gap-1 px-2">
              <Button
                as={A}
                href={`${slug()}/session`}
                variant="ghost"
                size="large"
                icon="edit"
                class="hidden _flex w-full text-left justify-start text-text-base rounded-md px-3"
              >
                New session
              </Button>
              <Show when={loading()}>
                <SessionSkeleton />
              </Show>
              <For each={sessions()}>
                {(session) => <SessionItem session={session} slug={slug()} mobile={props.mobile} />}
              </For>
              <Show when={hasMore()}>
                <div class="relative w-full py-1">
                  <Button
                    variant="ghost"
                    class="flex w-full text-left justify-start text-14-regular text-text-weak px-10"
                    size="large"
                    onClick={(e: MouseEvent) => {
                      loadMore()
                      ;(e.currentTarget as HTMLButtonElement).blur()
                    }}
                  >
                    Load more
                  </Button>
                </div>
              </Show>
            </nav>
          </Collapsible.Content>
        </Collapsible>
      </div>
    )
  }

  const LocalWorkspace = (props: { project: LocalProject; mobile?: boolean }): JSX.Element => {
    const [workspaceStore, setWorkspaceStore] = globalSync.child(props.project.worktree)
    const slug = createMemo(() => base64Encode(props.project.worktree))
    const sessions = createMemo(() =>
      workspaceStore.session
        .filter((session) => session.directory === workspaceStore.path.directory)
        .filter((session) => !session.parentID)
        .toSorted(sortSessions),
    )
    const loading = createMemo(() => workspaceStore.status !== "complete" && sessions().length === 0)
    const hasMore = createMemo(() => workspaceStore.sessionTotal > workspaceStore.session.length)
    const loadMore = async () => {
      setWorkspaceStore("limit", (limit) => limit + 5)
      await globalSync.project.loadSessions(props.project.worktree)
    }

    return (
      <div
        ref={(el) => {
          if (!props.mobile) scrollContainerRef = el
        }}
        class="size-full flex flex-col py-2 overflow-y-auto no-scrollbar"
      >
        <nav class="flex flex-col gap-1 px-2">
          <Show when={loading()}>
            <SessionSkeleton />
          </Show>
          <For each={sessions()}>
            {(session) => <SessionItem session={session} slug={slug()} mobile={props.mobile} />}
          </For>
          <Show when={hasMore()}>
            <div class="relative w-full py-1">
              <Button
                variant="ghost"
                class="flex w-full text-left justify-start text-14-regular text-text-weak px-10"
                size="large"
                onClick={(e: MouseEvent) => {
                  loadMore()
                  ;(e.currentTarget as HTMLButtonElement).blur()
                }}
              >
                Load more
              </Button>
            </div>
          </Show>
        </nav>
      </div>
    )
  }

  const SidebarContent = (sidebarProps: { mobile?: boolean }) => {
    const expanded = () => sidebarProps.mobile || layout.sidebar.opened()

    const sync = useGlobalSync()
    const project = createMemo(() => currentProject())
    const projectName = createMemo(() => {
      const current = project()
      if (!current) return ""
      return current.name || getFilename(current.worktree)
    })
    const workspaces = createMemo(() => workspaceIds(project()))

    const errorMessage = (err: unknown) => {
      if (err && typeof err === "object" && "data" in err) {
        const data = (err as { data?: { message?: string } }).data
        if (data?.message) return data.message
      }
      if (err instanceof Error) return err.message
      return "Request failed"
    }

    const createWorkspace = async () => {
      const current = project()
      if (!current) return

      const created = await globalSDK.client.worktree
        .create({ directory: current.worktree })
        .then((x) => x.data)
        .catch((err) => {
          showToast({
            title: "Failed to create workspace",
            description: errorMessage(err),
          })
          return undefined
        })

      if (!created?.directory) return

      globalSync.child(created.directory)
      navigate(`/${base64Encode(created.directory)}/session`)
    }

    const homedir = createMemo(() => sync.data.path.home)

    return (
      <div class="flex h-full w-full overflow-hidden">
        <div class="w-16 shrink-0 bg-background-base flex flex-col items-center overflow-hidden">
          <div class="flex-1 min-h-0 w-full">
            <DragDropProvider
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              collisionDetector={closestCenter}
            >
              <DragDropSensors />
              <ConstrainDragXAxis />
              <div class="h-full w-full flex flex-col items-center gap-3 px-3 py-2 overflow-y-auto no-scrollbar">
                <SortableProvider ids={layout.projects.list().map((p) => p.worktree)}>
                  <For each={layout.projects.list()}>
                    {(project) => <SortableProject project={project} mobile={sidebarProps.mobile} />}
                  </For>
                </SortableProvider>
                <Tooltip
                  placement={sidebarProps.mobile ? "bottom" : "right"}
                  value={
                    <div class="flex items-center gap-2">
                      <span>Open project</span>
                      <Show when={!sidebarProps.mobile}>
                        <span class="text-icon-base text-12-medium">{command.keybind("project.open")}</span>
                      </Show>
                    </div>
                  }
                >
                  <IconButton icon="plus" variant="ghost" size="large" onClick={chooseProject} />
                </Tooltip>
              </div>
              <DragOverlay>
                <ProjectDragOverlay />
              </DragOverlay>
            </DragDropProvider>
          </div>
          <div class="shrink-0 w-full pt-3 pb-3 flex flex-col items-center gap-2">
            <Tooltip placement={sidebarProps.mobile ? "bottom" : "right"} value="Settings">
              <IconButton disabled icon="settings-gear" variant="ghost" size="large" />
            </Tooltip>
            <Tooltip placement={sidebarProps.mobile ? "bottom" : "right"} value="Help">
              <IconButton
                icon="help"
                variant="ghost"
                size="large"
                onClick={() => platform.openLink("https://opencode.ai/desktop-feedback")}
              />
            </Tooltip>
          </div>
        </div>

        <Show when={expanded()}>
          <div
            classList={{
              "flex flex-col min-h-0 bg-background-stronger border border-b-0 border-border-weak-base rounded-tl-sm": true,
              "flex-1 min-w-0": sidebarProps.mobile,
            }}
            style={{ width: sidebarProps.mobile ? undefined : `${Math.max(layout.sidebar.width() - 64, 0)}px` }}
          >
            <Show when={project()} keyed>
              {(p) => (
                <>
                  <div class="shrink-0 px-2 py-1">
                    <div class="group/project flex items-start justify-between gap-2 p-2 pr-1">
                      <div class="flex flex-col min-w-0">
                        <span class="text-16-medium text-text-strong truncate">{projectName()}</span>
                        <Tooltip placement="right" value={project()?.worktree} class="shrink-0">
                          <span class="text-12-regular text-text-base truncate">
                            {project()?.worktree.replace(homedir(), "~")}
                          </span>
                        </Tooltip>
                      </div>
                      <DropdownMenu>
                        <DropdownMenu.Trigger
                          as={IconButton}
                          icon="dot-grid"
                          variant="ghost"
                          class="shrink-0 size-6 rounded-md opacity-0 group-hover/project:opacity-100 data-[expanded]:opacity-100 data-[expanded]:bg-surface-base-active"
                        />
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content class="mt-1">
                            <DropdownMenu.Item onSelect={() => dialog.show(() => <DialogEditProject project={p} />)}>
                              <DropdownMenu.ItemLabel>Edit</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item onSelect={() => layout.sidebar.toggleWorkspaces(p.worktree)}>
                              <DropdownMenu.ItemLabel>
                                {layout.sidebar.workspaces(p.worktree)() ? "Disable workspaces" : "Enable workspaces"}
                              </DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator />
                            <DropdownMenu.Item onSelect={() => closeProject(p.worktree)}>
                              <DropdownMenu.ItemLabel>Close</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu>
                    </div>
                  </div>

                  <Show
                    when={layout.sidebar.workspaces(p.worktree)()}
                    fallback={
                      <>
                        <div class="py-4 px-3">
                          <Button
                            size="large"
                            icon="plus-small"
                            class="w-full"
                            onClick={() => {
                              navigate(`/${base64Encode(p.worktree)}/session`)
                              layout.mobileSidebar.hide()
                            }}
                          >
                            New session
                          </Button>
                        </div>
                        <div class="flex-1 min-h-0">
                          <LocalWorkspace project={p} mobile={sidebarProps.mobile} />
                        </div>
                      </>
                    }
                  >
                    <>
                      <div class="py-4 px-3">
                        <Button size="large" icon="plus-small" class="w-full" onClick={createWorkspace}>
                          New workspace
                        </Button>
                      </div>
                      <div class="flex-1 min-h-0">
                        <DragDropProvider
                          onDragStart={handleWorkspaceDragStart}
                          onDragEnd={handleWorkspaceDragEnd}
                          onDragOver={handleWorkspaceDragOver}
                          collisionDetector={closestCenter}
                        >
                          <DragDropSensors />
                          <ConstrainDragXAxis />
                          <div
                            ref={(el) => {
                              if (!sidebarProps.mobile) scrollContainerRef = el
                            }}
                            class="size-full flex flex-col py-2 gap-4 overflow-y-auto no-scrollbar"
                          >
                            <SortableProvider ids={workspaces()}>
                              <For each={workspaces()}>
                                {(directory) => (
                                  <SortableWorkspace directory={directory} project={p} mobile={sidebarProps.mobile} />
                                )}
                              </For>
                            </SortableProvider>
                          </div>
                          <DragOverlay>
                            <WorkspaceDragOverlay />
                          </DragOverlay>
                        </DragDropProvider>
                      </div>
                    </>
                  </Show>
                </>
              )}
            </Show>
            <Show when={providers.all().length > 0 && providers.paid().length === 0}>
              <div class="shrink-0 px-2 py-3 border-t border-border-weak-base">
                <div class="rounded-md bg-background-base shadow-xs-border-base">
                  <div class="p-3 flex flex-col gap-2">
                    <div class="text-12-medium text-text-strong">Getting started</div>
                    <div class="text-text-base">OpenCode includes free models so you can start immediately.</div>
                    <div class="text-text-base">Connect any provider to use models, inc. Claude, GPT, Gemini etc.</div>
                  </div>
                  <Button
                    class="flex w-full text-left justify-start text-12-medium text-text-strong stroke-[1.5px] rounded-md rounded-t-none shadow-none border-t border-border-weak-base px-3"
                    size="large"
                    icon="plus"
                    onClick={connectProvider}
                  >
                    Connect provider
                  </Button>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    )
  }

  return (
    <div class="relative bg-background-base flex-1 min-h-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
      <Titlebar />
      <div class="flex-1 min-h-0 flex">
        <div
          classList={{
            "hidden xl:block": true,
            "relative shrink-0": true,
          }}
          style={{ width: layout.sidebar.opened() ? `${layout.sidebar.width()}px` : "64px" }}
        >
          <div class="@container w-full h-full contain-strict">
            <SidebarContent />
          </div>
          <Show when={layout.sidebar.opened()}>
            <ResizeHandle
              direction="horizontal"
              size={layout.sidebar.width()}
              min={214}
              max={window.innerWidth * 0.3 + 64}
              collapseThreshold={144}
              onResize={layout.sidebar.resize}
              onCollapse={layout.sidebar.close}
            />
          </Show>
        </div>
        <div class="xl:hidden">
          <div
            classList={{
              "fixed inset-x-0 top-10 bottom-0 z-40 transition-opacity duration-200": true,
              "opacity-100 pointer-events-auto": layout.mobileSidebar.opened(),
              "opacity-0 pointer-events-none": !layout.mobileSidebar.opened(),
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) layout.mobileSidebar.hide()
            }}
          />
          <div
            classList={{
              "@container fixed top-10 bottom-0 left-0 z-50 w-72 bg-background-base transition-transform duration-200 ease-out": true,
              "translate-x-0": layout.mobileSidebar.opened(),
              "-translate-x-full": !layout.mobileSidebar.opened(),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent mobile />
          </div>
        </div>

        <main
          classList={{
            "size-full overflow-x-hidden flex flex-col items-start contain-strict border-t border-border-weak-base": true,
            "xl:border-l xl:rounded-tl-sm": !layout.sidebar.opened(),
          }}
        >
          {props.children}
        </main>
      </div>
      <Toast.Region />
    </div>
  )
}

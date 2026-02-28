import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  ParentProps,
  Show,
  untrack,
  type JSX,
} from "solid-js"
import { A, useNavigate, useParams } from "@solidjs/router"
import { useLayout, LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { Persist, persisted } from "@/utils/persist"
import { base64Encode } from "@opencode-ai/util/encode"
import { decode64 } from "@/utils/base64"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Dialog } from "@opencode-ai/ui/dialog"
import { getFilename } from "@opencode-ai/util/path"
import { Session, type Message } from "@opencode-ai/sdk/v2/client"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { createStore, produce, reconcile } from "solid-js/store"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useProviders } from "@/hooks/use-providers"
import { showToast, Toast, toaster } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { clearWorkspaceTerminals } from "@/context/terminal"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { Binary } from "@opencode-ai/util/binary"
import { retry } from "@opencode-ai/util/retry"
import { playSound, soundSrc } from "@/utils/sound"
import { createAim } from "@/utils/aim"
import { Worktree as WorktreeState } from "@/utils/worktree"

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { DialogSettings } from "@/components/dialog-settings"
import { useCommand, type CommandOption } from "@/context/command"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogEditProject } from "@/components/dialog-edit-project"
import { Titlebar } from "@/components/titlebar"
import { useServer } from "@/context/server"
import { useLanguage, type Locale } from "@/context/language"
import {
  childMapByParent,
  displayName,
  errorMessage,
  getDraggableId,
  latestRootSession,
  sortedRootSessions,
  syncWorkspaceOrder,
  workspaceKey,
} from "./layout/helpers"
import { collectOpenProjectDeepLinks, deepLinkEvent, drainPendingDeepLinks } from "./layout/deep-links"
import { createInlineEditorController } from "./layout/inline-editor"
import {
  LocalWorkspace,
  SortableWorkspace,
  WorkspaceDragOverlay,
  type WorkspaceSidebarContext,
} from "./layout/sidebar-workspace"
import { workspaceOpenState } from "./layout/sidebar-workspace-helpers"
import { ProjectDragOverlay, SortableProject, type ProjectSidebarContext } from "./layout/sidebar-project"
import { SidebarContent } from "./layout/sidebar-shell"

export default function Layout(props: ParentProps) {
  const [store, setStore, , ready] = persisted(
    Persist.global("layout.page", ["layout.page.v1"]),
    createStore({
      lastProjectSession: {} as { [directory: string]: { directory: string; id: string; at: number } },
      activeProject: undefined as string | undefined,
      activeWorkspace: undefined as string | undefined,
      workspaceOrder: {} as Record<string, string[]>,
      workspaceName: {} as Record<string, string>,
      workspaceBranchName: {} as Record<string, Record<string, string>>,
      workspaceExpanded: {} as Record<string, boolean>,
    }),
  )

  const pageReady = createMemo(() => ready())

  let scrollContainerRef: HTMLDivElement | undefined

  const params = useParams()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const layoutReady = createMemo(() => layout.ready())
  const platform = usePlatform()
  const settings = useSettings()
  const server = useServer()
  const notification = useNotification()
  const permission = usePermission()
  const navigate = useNavigate()
  const providers = useProviders()
  const dialog = useDialog()
  const command = useCommand()
  const theme = useTheme()
  const language = useLanguage()
  const initialDirectory = decode64(params.dir)
  const availableThemeEntries = createMemo(() => Object.entries(theme.themes()))
  const colorSchemeOrder: ColorScheme[] = ["system", "light", "dark"]
  const colorSchemeKey: Record<ColorScheme, "theme.scheme.system" | "theme.scheme.light" | "theme.scheme.dark"> = {
    system: "theme.scheme.system",
    light: "theme.scheme.light",
    dark: "theme.scheme.dark",
  }
  const colorSchemeLabel = (scheme: ColorScheme) => language.t(colorSchemeKey[scheme])
  const currentDir = createMemo(() => decode64(params.dir) ?? "")

  const [state, setState] = createStore({
    autoselect: !initialDirectory,
    busyWorkspaces: {} as Record<string, boolean>,
    hoverSession: undefined as string | undefined,
    hoverProject: undefined as string | undefined,
    scrollSessionKey: undefined as string | undefined,
    nav: undefined as HTMLElement | undefined,
  })

  const editor = createInlineEditorController()
  const setBusy = (directory: string, value: boolean) => {
    const key = workspaceKey(directory)
    if (value) {
      setState("busyWorkspaces", key, true)
      return
    }
    setState(
      "busyWorkspaces",
      produce((draft) => {
        delete draft[key]
      }),
    )
  }
  const isBusy = (directory: string) => !!state.busyWorkspaces[workspaceKey(directory)]
  const navLeave = { current: undefined as number | undefined }
  const [sortNow, setSortNow] = createSignal(Date.now())
  let sortNowInterval: ReturnType<typeof setInterval> | undefined
  const sortNowTimeout = setTimeout(
    () => {
      setSortNow(Date.now())
      sortNowInterval = setInterval(() => setSortNow(Date.now()), 60_000)
    },
    60_000 - (Date.now() % 60_000),
  )

  const aim = createAim({
    enabled: () => !layout.sidebar.opened(),
    active: () => state.hoverProject,
    el: () => state.nav,
    onActivate: (directory) => {
      globalSync.child(directory)
      setState("hoverProject", directory)
      setState("hoverSession", undefined)
    },
  })

  onCleanup(() => {
    if (navLeave.current !== undefined) clearTimeout(navLeave.current)
    clearTimeout(sortNowTimeout)
    if (sortNowInterval) clearInterval(sortNowInterval)
    aim.reset()
  })

  const sidebarHovering = createMemo(() => !layout.sidebar.opened() && state.hoverProject !== undefined)
  const sidebarExpanded = createMemo(() => layout.sidebar.opened() || sidebarHovering())
  const setHoverProject = (value: string | undefined) => {
    setState("hoverProject", value)
    if (value !== undefined) return
    aim.reset()
  }
  const clearHoverProjectSoon = () => queueMicrotask(() => setHoverProject(undefined))
  const setHoverSession = (id: string | undefined) => setState("hoverSession", id)

  const hoverProjectData = createMemo(() => {
    const id = state.hoverProject
    if (!id) return
    return layout.projects.list().find((project) => project.worktree === id)
  })

  createEffect(() => {
    if (!layout.sidebar.opened()) return
    setHoverProject(undefined)
  })

  const autoselecting = createMemo(() => {
    if (params.dir) return false
    if (!state.autoselect) return false
    if (!pageReady()) return true
    if (!layoutReady()) return true
    const list = layout.projects.list()
    if (list.length > 0) return true
    return !!server.projects.last()
  })

  createEffect(() => {
    if (!state.autoselect) return
    const dir = params.dir
    if (!dir) return
    const directory = decode64(dir)
    if (!directory) return
    setState("autoselect", false)
  })

  const editorOpen = editor.editorOpen
  const openEditor = editor.openEditor
  const closeEditor = editor.closeEditor
  const setEditor = editor.setEditor
  const InlineEditor = editor.InlineEditor

  const clearSidebarHoverState = () => {
    if (layout.sidebar.opened()) return
    setState("hoverSession", undefined)
    setHoverProject(undefined)
  }

  const navigateWithSidebarReset = (href: string) => {
    clearSidebarHoverState()
    navigate(href)
    layout.mobileSidebar.hide()
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
      title: language.t("toast.theme.title"),
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
      title: language.t("toast.scheme.title"),
      description: colorSchemeLabel(next),
    })
  }

  function setLocale(next: Locale) {
    if (next === language.locale()) return
    language.setLocale(next)
    showToast({
      title: language.t("toast.language.title"),
      description: language.t("toast.language.description", { language: language.label(next) }),
    })
  }

  function cycleLanguage(direction = 1) {
    const locales = language.locales
    const currentIndex = locales.indexOf(language.locale())
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + locales.length) % locales.length
    const next = locales[nextIndex]
    if (!next) return
    setLocale(next)
  }

  const useUpdatePolling = () =>
    onMount(() => {
      if (!platform.checkUpdate || !platform.update || !platform.restart) return

      let toastId: number | undefined
      let interval: ReturnType<typeof setInterval> | undefined

      const pollUpdate = () =>
        platform.checkUpdate!().then(({ updateAvailable, version }) => {
          if (!updateAvailable) return
          if (toastId !== undefined) return
          toastId = showToast({
            persistent: true,
            icon: "download",
            title: language.t("toast.update.title"),
            description: language.t("toast.update.description", { version: version ?? "" }),
            actions: [
              {
                label: language.t("toast.update.action.installRestart"),
                onClick: async () => {
                  await platform.update!()
                  await platform.restart!()
                },
              },
              {
                label: language.t("toast.update.action.notYet"),
                onClick: "dismiss",
              },
            ],
          })
        })

      createEffect(() => {
        if (!settings.ready()) return

        if (!settings.updates.startup()) {
          if (interval === undefined) return
          clearInterval(interval)
          interval = undefined
          return
        }

        if (interval !== undefined) return
        void pollUpdate()
        interval = setInterval(pollUpdate, 10 * 60 * 1000)
      })

      onCleanup(() => {
        if (interval === undefined) return
        clearInterval(interval)
      })
    })

  const useSDKNotificationToasts = () =>
    onMount(() => {
      const toastBySession = new Map<string, number>()
      const alertedAtBySession = new Map<string, number>()
      const cooldownMs = 5000

      const dismissSessionAlert = (sessionKey: string) => {
        const toastId = toastBySession.get(sessionKey)
        if (toastId === undefined) return
        toaster.dismiss(toastId)
        toastBySession.delete(sessionKey)
        alertedAtBySession.delete(sessionKey)
      }

      const unsub = globalSDK.event.listen((e) => {
        if (e.details?.type === "worktree.ready") {
          setBusy(e.name, false)
          WorktreeState.ready(e.name)
          return
        }

        if (e.details?.type === "worktree.failed") {
          setBusy(e.name, false)
          WorktreeState.failed(e.name, e.details.properties?.message ?? language.t("common.requestFailed"))
          return
        }

        if (e.details?.type !== "permission.asked" && e.details?.type !== "question.asked") return
        const title =
          e.details.type === "permission.asked"
            ? language.t("notification.permission.title")
            : language.t("notification.question.title")
        const icon = e.details.type === "permission.asked" ? ("checklist" as const) : ("bubble-5" as const)
        const directory = e.name
        const props = e.details.properties
        if (e.details.type === "permission.asked" && permission.autoResponds(e.details.properties, directory)) return

        const [store] = globalSync.child(directory, { bootstrap: false })
        const session = store.session.find((s) => s.id === props.sessionID)
        const sessionKey = `${directory}:${props.sessionID}`

        const sessionTitle = session?.title ?? language.t("command.session.new")
        const projectName = getFilename(directory)
        const description =
          e.details.type === "permission.asked"
            ? language.t("notification.permission.description", { sessionTitle, projectName })
            : language.t("notification.question.description", { sessionTitle, projectName })
        const href = `/${base64Encode(directory)}/session/${props.sessionID}`

        const now = Date.now()
        const lastAlerted = alertedAtBySession.get(sessionKey) ?? 0
        if (now - lastAlerted < cooldownMs) return
        alertedAtBySession.set(sessionKey, now)

        if (e.details.type === "permission.asked") {
          if (settings.sounds.permissionsEnabled()) {
            playSound(soundSrc(settings.sounds.permissions()))
          }
          if (settings.notifications.permissions()) {
            void platform.notify(title, description, href)
          }
        }

        if (e.details.type === "question.asked") {
          if (settings.notifications.agent()) {
            void platform.notify(title, description, href)
          }
        }

        const currentSession = params.id
        if (directory === currentDir() && props.sessionID === currentSession) return
        if (directory === currentDir() && session?.parentID === currentSession) return

        dismissSessionAlert(sessionKey)

        const toastId = showToast({
          persistent: true,
          icon,
          title,
          description,
          actions: [
            {
              label: language.t("notification.action.goToSession"),
              onClick: () => navigate(href),
            },
            {
              label: language.t("common.dismiss"),
              onClick: "dismiss",
            },
          ],
        })
        toastBySession.set(sessionKey, toastId)
      })
      onCleanup(unsub)

      createEffect(() => {
        const currentSession = params.id
        if (!currentDir() || !currentSession) return
        const sessionKey = `${currentDir()}:${currentSession}`
        dismissSessionAlert(sessionKey)
        const [store] = globalSync.child(currentDir(), { bootstrap: false })
        const childSessions = store.session.filter((s) => s.parentID === currentSession)
        for (const child of childSessions) {
          dismissSessionAlert(`${currentDir()}:${child.id}`)
        }
      })
    })

  useUpdatePolling()
  useSDKNotificationToasts()

  function scrollToSession(sessionId: string, sessionKey: string) {
    if (!scrollContainerRef) return
    if (state.scrollSessionKey === sessionKey) return
    const element = scrollContainerRef.querySelector(`[data-session-id="${sessionId}"]`)
    if (!element) return
    const containerRect = scrollContainerRef.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    if (elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom) {
      setState("scrollSessionKey", sessionKey)
      return
    }
    setState("scrollSessionKey", sessionKey)
    element.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  const currentProject = createMemo(() => {
    const directory = currentDir()
    if (!directory) return

    const projects = layout.projects.list()

    const sandbox = projects.find((p) => p.sandboxes?.includes(directory))
    if (sandbox) return sandbox

    const direct = projects.find((p) => p.worktree === directory)
    if (direct) return direct

    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return

    const meta = globalSync.data.project.find((p) => p.id === id)
    const root = meta?.worktree
    if (!root) return

    return projects.find((p) => p.worktree === root)
  })

  createEffect(
    on(
      () => ({ ready: pageReady(), project: currentProject() }),
      (value) => {
        if (!value.ready) return
        const project = value.project
        if (!project) return
        const last = server.projects.last()
        if (last === project.worktree) return
        server.projects.touch(project.worktree)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => ({ ready: pageReady(), layoutReady: layoutReady(), dir: params.dir, list: layout.projects.list() }),
      (value) => {
        if (!value.ready) return
        if (!value.layoutReady) return
        if (!state.autoselect) return
        if (value.dir) return

        const last = server.projects.last()

        if (value.list.length === 0) {
          if (!last) return
          setState("autoselect", false)
          openProject(last, false)
          navigateToProject(last)
          return
        }

        const next = value.list.find((project) => project.worktree === last) ?? value.list[0]
        if (!next) return
        setState("autoselect", false)
        openProject(next.worktree, false)
        navigateToProject(next.worktree)
      },
    ),
  )

  const workspaceName = (directory: string, projectId?: string, branch?: string) => {
    const key = workspaceKey(directory)
    const direct = store.workspaceName[key] ?? store.workspaceName[directory]
    if (direct) return direct
    if (!projectId) return
    if (!branch) return
    return store.workspaceBranchName[projectId]?.[branch]
  }

  const setWorkspaceName = (directory: string, next: string, projectId?: string, branch?: string) => {
    const key = workspaceKey(directory)
    setStore("workspaceName", key, next)
    if (!projectId) return
    if (!branch) return
    if (!store.workspaceBranchName[projectId]) {
      setStore("workspaceBranchName", projectId, {})
    }
    setStore("workspaceBranchName", projectId, branch, next)
  }

  const workspaceLabel = (directory: string, branch?: string, projectId?: string) =>
    workspaceName(directory, projectId, branch) ?? branch ?? getFilename(directory)

  const workspaceSetting = createMemo(() => {
    const project = currentProject()
    if (!project) return false
    if (project.vcs !== "git") return false
    return layout.sidebar.workspaces(project.worktree)()
  })

  createEffect(() => {
    if (!pageReady()) return
    if (!layoutReady()) return
    const project = currentProject()
    if (!project) return

    const local = project.worktree
    const dirs = [project.worktree, ...(project.sandboxes ?? [])]
    const existing = store.workspaceOrder[project.worktree]
    const merged = syncWorkspaceOrder(local, dirs, existing)
    if (!existing) {
      setStore("workspaceOrder", project.worktree, merged)
      return
    }

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
    const projects = layout.projects.list()
    for (const [directory, expanded] of Object.entries(store.workspaceExpanded)) {
      if (!expanded) continue
      const project = projects.find((item) => item.worktree === directory || item.sandboxes?.includes(directory))
      if (!project) continue
      if (project.vcs === "git" && layout.sidebar.workspaces(project.worktree)()) continue
      setStore("workspaceExpanded", directory, false)
    }
  })

  const currentSessions = createMemo(() => {
    const project = currentProject()
    if (!project) return [] as Session[]
    const now = Date.now()
    if (workspaceSetting()) {
      const dirs = workspaceIds(project)
      const activeDir = currentDir()
      const result: Session[] = []
      for (const dir of dirs) {
        const expanded = store.workspaceExpanded[dir] ?? dir === project.worktree
        const active = dir === activeDir
        if (!expanded && !active) continue
        const [dirStore] = globalSync.child(dir, { bootstrap: true })
        const dirSessions = sortedRootSessions(dirStore, now)
        result.push(...dirSessions)
      }
      return result
    }
    const [projectStore] = globalSync.child(project.worktree)
    return sortedRootSessions(projectStore, now)
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

  const PREFETCH_MAX_SESSIONS_PER_DIR = 10
  const prefetchedByDir = new Map<string, Map<string, true>>()

  const lruFor = (directory: string) => {
    const existing = prefetchedByDir.get(directory)
    if (existing) return existing
    const created = new Map<string, true>()
    prefetchedByDir.set(directory, created)
    return created
  }

  const markPrefetched = (directory: string, sessionID: string) => {
    const lru = lruFor(directory)
    if (lru.has(sessionID)) lru.delete(sessionID)
    lru.set(sessionID, true)
    while (lru.size > PREFETCH_MAX_SESSIONS_PER_DIR) {
      const oldest = lru.keys().next().value as string | undefined
      if (!oldest) return
      lru.delete(oldest)
    }
  }

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

  const mergeByID = <T extends { id: string }>(current: T[], incoming: T[]) => {
    if (current.length === 0) {
      return incoming.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    }

    const map = new Map<string, T>()
    for (const item of current) {
      map.set(item.id, item)
    }
    for (const item of incoming) {
      map.set(item.id, item)
    }
    return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  async function prefetchMessages(directory: string, sessionID: string, token: number) {
    const [store, setStore] = globalSync.child(directory, { bootstrap: false })

    return retry(() => globalSDK.client.session.messages({ directory, sessionID, limit: prefetchChunk }))
      .then((messages) => {
        if (prefetchToken.value !== token) return

        const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
        const next = items.map((x) => x.info).filter((m): m is Message => !!m?.id)
        const sorted = mergeByID([], next)

        const current = store.message[sessionID] ?? []
        const merged = mergeByID(
          current.filter((item): item is Message => !!item?.id),
          sorted,
        )

        batch(() => {
          setStore("message", sessionID, reconcile(merged, { key: "id" }))

          for (const message of items) {
            const currentParts = store.part[message.info.id] ?? []
            const mergedParts = mergeByID(
              currentParts.filter((item): item is (typeof currentParts)[number] & { id: string } => !!item?.id),
              message.parts.filter((item): item is (typeof message.parts)[number] & { id: string } => !!item?.id),
            )

            setStore("part", message.info.id, reconcile(mergedParts, { key: "id" }))
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

    const [store] = globalSync.child(directory, { bootstrap: false })
    const cached = untrack(() => store.message[session.id] !== undefined)
    if (cached) return

    const q = queueFor(directory)
    if (q.inflight.has(session.id)) return
    if (q.pendingSet.has(session.id)) return

    const lru = lruFor(directory)
    const known = lru.has(session.id)
    if (!known && lru.size >= PREFETCH_MAX_SESSIONS_PER_DIR && priority !== "high") return
    markPrefetched(directory, session.id)

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

    navigateToSession(session)
    queueMicrotask(() => scrollToSession(session.id, `${session.directory}:${session.id}`))
  }

  function navigateSessionByUnseen(offset: number) {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const hasUnseen = sessions.some((session) => notification.session.unseenCount(session.id) > 0)
    if (!hasUnseen) return

    const activeIndex = params.id ? sessions.findIndex((s) => s.id === params.id) : -1
    const start = activeIndex === -1 ? (offset > 0 ? -1 : 0) : activeIndex

    for (let i = 1; i <= sessions.length; i++) {
      const index = offset > 0 ? (start + i) % sessions.length : (start - i + sessions.length) % sessions.length
      const session = sessions[index]
      if (!session) continue
      if (notification.session.unseenCount(session.id) === 0) continue

      prefetchSession(session, "high")

      const next = sessions[(index + 1) % sessions.length]
      const prev = sessions[(index - 1 + sessions.length) % sessions.length]

      if (offset > 0) {
        if (next) prefetchSession(next, "high")
        if (prev) prefetchSession(prev)
      }

      if (offset < 0) {
        if (prev) prefetchSession(prev, "high")
        if (next) prefetchSession(next)
      }

      navigateToSession(session)
      queueMicrotask(() => scrollToSession(session.id, `${session.directory}:${session.id}`))
      return
    }
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

  command.register("layout", () => {
    const commands: CommandOption[] = [
      {
        id: "sidebar.toggle",
        title: language.t("command.sidebar.toggle"),
        category: language.t("command.category.view"),
        keybind: "mod+b",
        onSelect: () => layout.sidebar.toggle(),
      },
      {
        id: "project.open",
        title: language.t("command.project.open"),
        category: language.t("command.category.project"),
        keybind: "mod+o",
        onSelect: () => chooseProject(),
      },
      {
        id: "provider.connect",
        title: language.t("command.provider.connect"),
        category: language.t("command.category.provider"),
        onSelect: () => connectProvider(),
      },
      {
        id: "server.switch",
        title: language.t("command.server.switch"),
        category: language.t("command.category.server"),
        onSelect: () => openServer(),
      },
      {
        id: "settings.open",
        title: language.t("command.settings.open"),
        category: language.t("command.category.settings"),
        keybind: "mod+comma",
        onSelect: () => openSettings(),
      },
      {
        id: "session.previous",
        title: language.t("command.session.previous"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowup",
        onSelect: () => navigateSessionByOffset(-1),
      },
      {
        id: "session.next",
        title: language.t("command.session.next"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowdown",
        onSelect: () => navigateSessionByOffset(1),
      },
      {
        id: "session.previous.unseen",
        title: language.t("command.session.previous.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowup",
        onSelect: () => navigateSessionByUnseen(-1),
      },
      {
        id: "session.next.unseen",
        title: language.t("command.session.next.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowdown",
        onSelect: () => navigateSessionByUnseen(1),
      },
      {
        id: "session.archive",
        title: language.t("command.session.archive"),
        category: language.t("command.category.session"),
        keybind: "mod+shift+backspace",
        disabled: !params.dir || !params.id,
        onSelect: () => {
          const session = currentSessions().find((s) => s.id === params.id)
          if (session) archiveSession(session)
        },
      },
      {
        id: "workspace.new",
        title: language.t("workspace.new"),
        category: language.t("command.category.workspace"),
        keybind: "mod+shift+w",
        disabled: !workspaceSetting(),
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          return createWorkspace(project)
        },
      },
      {
        id: "workspace.toggle",
        title: language.t("command.workspace.toggle"),
        description: language.t("command.workspace.toggle.description"),
        category: language.t("command.category.workspace"),
        slash: "workspace",
        disabled: !currentProject() || currentProject()?.vcs !== "git",
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          if (project.vcs !== "git") return
          const wasEnabled = layout.sidebar.workspaces(project.worktree)()
          layout.sidebar.toggleWorkspaces(project.worktree)
          showToast({
            title: wasEnabled
              ? language.t("toast.workspace.disabled.title")
              : language.t("toast.workspace.enabled.title"),
            description: wasEnabled
              ? language.t("toast.workspace.disabled.description")
              : language.t("toast.workspace.enabled.description"),
          })
        },
      },
      {
        id: "theme.cycle",
        title: language.t("command.theme.cycle"),
        category: language.t("command.category.theme"),
        keybind: "mod+shift+t",
        onSelect: () => cycleTheme(1),
      },
    ]

    for (const [id, definition] of availableThemeEntries()) {
      commands.push({
        id: `theme.set.${id}`,
        title: language.t("command.theme.set", { theme: definition.name ?? id }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewTheme(id)
          return () => theme.cancelPreview()
        },
      })
    }

    commands.push({
      id: "theme.scheme.cycle",
      title: language.t("command.theme.scheme.cycle"),
      category: language.t("command.category.theme"),
      keybind: "mod+shift+s",
      onSelect: () => cycleColorScheme(1),
    })

    for (const scheme of colorSchemeOrder) {
      commands.push({
        id: `theme.scheme.${scheme}`,
        title: language.t("command.theme.scheme.set", { scheme: colorSchemeLabel(scheme) }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewColorScheme(scheme)
          return () => theme.cancelPreview()
        },
      })
    }

    commands.push({
      id: "language.cycle",
      title: language.t("command.language.cycle"),
      category: language.t("command.category.language"),
      onSelect: () => cycleLanguage(1),
    })

    for (const locale of language.locales) {
      commands.push({
        id: `language.set.${locale}`,
        title: language.t("command.language.set", { language: language.label(locale) }),
        category: language.t("command.category.language"),
        onSelect: () => setLocale(locale),
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

  function openSettings() {
    dialog.show(() => <DialogSettings />)
  }

  function projectRoot(directory: string) {
    const project = layout.projects
      .list()
      .find((item) => item.worktree === directory || item.sandboxes?.includes(directory))
    if (project) return project.worktree

    const known = Object.entries(store.workspaceOrder).find(
      ([root, dirs]) => root === directory || dirs.includes(directory),
    )
    if (known) return known[0]

    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return directory

    const meta = globalSync.data.project.find((item) => item.id === id)
    return meta?.worktree ?? directory
  }

  async function navigateToProject(directory: string | undefined) {
    if (!directory) return
    const root = projectRoot(directory)
    server.projects.touch(root)
    const project = layout.projects.list().find((item) => item.worktree === root)
    const dirs = Array.from(new Set([root, ...(store.workspaceOrder[root] ?? []), ...(project?.sandboxes ?? [])]))
    const openSession = async (target: { directory: string; id: string }) => {
      const resolved = await globalSDK.client.session
        .get({ sessionID: target.id })
        .then((x) => x.data)
        .catch(() => undefined)
      const next = resolved?.directory ? resolved : target
      setStore("lastProjectSession", root, { directory: next.directory, id: next.id, at: Date.now() })
      navigateWithSidebarReset(`/${base64Encode(next.directory)}/session/${next.id}`)
    }

    const projectSession = store.lastProjectSession[root]
    if (projectSession?.id) {
      await openSession(projectSession)
      return
    }

    const latest = latestRootSession(
      dirs.map((item) => globalSync.child(item, { bootstrap: false })[0]),
      Date.now(),
    )
    if (latest) {
      await openSession(latest)
      return
    }

    const fetched = latestRootSession(
      await Promise.all(
        dirs.map(async (item) => ({
          path: { directory: item },
          session: await globalSDK.client.session
            .list({ directory: item })
            .then((x) => x.data ?? [])
            .catch(() => []),
        })),
      ),
      Date.now(),
    )
    if (fetched) {
      await openSession(fetched)
      return
    }

    navigateWithSidebarReset(`/${base64Encode(root)}/session`)
  }

  function navigateToSession(session: Session | undefined) {
    if (!session) return
    navigateWithSidebarReset(`/${base64Encode(session.directory)}/session/${session.id}`)
  }

  function openProject(directory: string, navigate = true) {
    layout.projects.open(directory)
    if (navigate) navigateToProject(directory)
  }

  const handleDeepLinks = (urls: string[]) => {
    if (!server.isLocal()) return
    for (const directory of collectOpenProjectDeepLinks(urls)) {
      openProject(directory)
    }
  }

  onMount(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ urls: string[] }>).detail
      const urls = detail?.urls ?? []
      if (urls.length === 0) return
      handleDeepLinks(urls)
    }

    handleDeepLinks(drainPendingDeepLinks(window))
    window.addEventListener(deepLinkEvent, handler as EventListener)
    onCleanup(() => window.removeEventListener(deepLinkEvent, handler as EventListener))
  })

  async function renameProject(project: LocalProject, next: string) {
    const current = displayName(project)
    if (next === current) return
    const name = next === getFilename(project.worktree) ? "" : next

    if (project.id && project.id !== "global") {
      await globalSDK.client.project.update({ projectID: project.id, directory: project.worktree, name })
      return
    }

    globalSync.project.meta(project.worktree, { name })
  }

  const renameWorkspace = (directory: string, next: string, projectId?: string, branch?: string) => {
    const current = workspaceName(directory, projectId, branch) ?? branch ?? getFilename(directory)
    if (current === next) return
    setWorkspaceName(directory, next, projectId, branch)
  }

  function closeProject(directory: string) {
    const index = layout.projects.list().findIndex((x) => x.worktree === directory)
    const next = layout.projects.list()[index + 1]
    layout.projects.close(directory)
    if (next) navigateToProject(next.worktree)
    else navigate("/")
  }

  function toggleProjectWorkspaces(project: LocalProject) {
    const enabled = layout.sidebar.workspaces(project.worktree)()
    if (enabled) {
      layout.sidebar.toggleWorkspaces(project.worktree)
      return
    }
    if (project.vcs !== "git") return
    layout.sidebar.toggleWorkspaces(project.worktree)
  }

  const showEditProjectDialog = (project: LocalProject) => dialog.show(() => <DialogEditProject project={project} />)

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
        title: language.t("command.project.open"),
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

  const deleteWorkspace = async (root: string, directory: string) => {
    if (directory === root) return

    setBusy(directory, true)

    const result = await globalSDK.client.worktree
      .remove({ directory: root, worktreeRemoveInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.delete.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    setBusy(directory, false)

    if (!result) return

    globalSync.set(
      "project",
      produce((draft) => {
        const project = draft.find((item) => item.worktree === root)
        if (!project) return
        project.sandboxes = (project.sandboxes ?? []).filter((sandbox) => sandbox !== directory)
      }),
    )
    setStore("workspaceOrder", root, (order) => (order ?? []).filter((workspace) => workspace !== directory))

    layout.projects.close(directory)
    layout.projects.open(root)

    if (params.dir && currentDir() === directory) {
      navigateToProject(root)
    }
  }

  const resetWorkspace = async (root: string, directory: string) => {
    if (directory === root) return
    setBusy(directory, true)

    const progress = showToast({
      persistent: true,
      title: language.t("workspace.resetting.title"),
      description: language.t("workspace.resetting.description"),
    })
    const dismiss = () => toaster.dismiss(progress)

    const sessions: Session[] = await globalSDK.client.session
      .list({ directory })
      .then((x) => x.data ?? [])
      .catch(() => [])

    clearWorkspaceTerminals(
      directory,
      sessions.map((s) => s.id),
      platform,
    )
    await globalSDK.client.instance.dispose({ directory }).catch(() => undefined)

    const result = await globalSDK.client.worktree
      .reset({ directory: root, worktreeResetInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.reset.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    if (!result) {
      setBusy(directory, false)
      dismiss()
      return
    }

    const archivedAt = Date.now()
    await Promise.all(
      sessions
        .filter((session) => session.time.archived === undefined)
        .map((session) =>
          globalSDK.client.session
            .update({
              sessionID: session.id,
              directory: session.directory,
              time: { archived: archivedAt },
            })
            .catch(() => undefined),
        ),
    )

    setBusy(directory, false)
    dismiss()

    showToast({
      title: language.t("workspace.reset.success.title"),
      description: language.t("workspace.reset.success.description"),
      actions: [
        {
          label: language.t("command.session.new"),
          onClick: () => {
            const href = `/${base64Encode(directory)}/session`
            navigate(href)
            layout.mobileSidebar.hide()
          },
        },
        {
          label: language.t("common.dismiss"),
          onClick: "dismiss",
        },
      ],
    })
  }

  function DialogDeleteWorkspace(props: { root: string; directory: string }) {
    const name = createMemo(() => getFilename(props.directory))
    const [data, setData] = createStore({
      status: "loading" as "loading" | "ready" | "error",
      dirty: false,
    })

    onMount(() => {
      globalSDK.client.file
        .status({ directory: props.directory })
        .then((x) => {
          const files = x.data ?? []
          const dirty = files.length > 0
          setData({ status: "ready", dirty })
        })
        .catch(() => {
          setData({ status: "error", dirty: false })
        })
    })

    const handleDelete = () => {
      dialog.close()
      void deleteWorkspace(props.root, props.directory)
    }

    const description = () => {
      if (data.status === "loading") return language.t("workspace.status.checking")
      if (data.status === "error") return language.t("workspace.status.error")
      if (!data.dirty) return language.t("workspace.status.clean")
      return language.t("workspace.status.dirty")
    }

    return (
      <Dialog title={language.t("workspace.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("workspace.delete.confirm", { name: name() })}
            </span>
            <span class="text-12-regular text-text-weak">{description()}</span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" disabled={data.status === "loading"} onClick={handleDelete}>
              {language.t("workspace.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  function DialogResetWorkspace(props: { root: string; directory: string }) {
    const name = createMemo(() => getFilename(props.directory))
    const [state, setState] = createStore({
      status: "loading" as "loading" | "ready" | "error",
      dirty: false,
      sessions: [] as Session[],
    })

    const refresh = async () => {
      const sessions = await globalSDK.client.session
        .list({ directory: props.directory })
        .then((x) => x.data ?? [])
        .catch(() => [])
      const active = sessions.filter((session) => session.time.archived === undefined)
      setState({ sessions: active })
    }

    onMount(() => {
      globalSDK.client.file
        .status({ directory: props.directory })
        .then((x) => {
          const files = x.data ?? []
          const dirty = files.length > 0
          setState({ status: "ready", dirty })
          void refresh()
        })
        .catch(() => {
          setState({ status: "error", dirty: false })
        })
    })

    const handleReset = () => {
      dialog.close()
      void resetWorkspace(props.root, props.directory)
    }

    const archivedCount = () => state.sessions.length

    const description = () => {
      if (state.status === "loading") return language.t("workspace.status.checking")
      if (state.status === "error") return language.t("workspace.status.error")
      if (!state.dirty) return language.t("workspace.status.clean")
      return language.t("workspace.status.dirty")
    }

    const archivedLabel = () => {
      const count = archivedCount()
      if (count === 0) return language.t("workspace.reset.archived.none")
      if (count === 1) return language.t("workspace.reset.archived.one")
      return language.t("workspace.reset.archived.many", { count })
    }

    return (
      <Dialog title={language.t("workspace.reset.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("workspace.reset.confirm", { name: name() })}
            </span>
            <span class="text-12-regular text-text-weak">
              {description()} {archivedLabel()} {language.t("workspace.reset.note")}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" disabled={state.status === "loading"} onClick={handleReset}>
              {language.t("workspace.reset.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  createEffect(
    on(
      () => ({ ready: pageReady(), dir: params.dir, id: params.id }),
      (value) => {
        if (!value.ready) return
        const dir = value.dir
        const id = value.id
        if (!dir || !id) return
        const directory = decode64(dir)
        if (!directory) return
        const at = Date.now()
        setStore("lastProjectSession", projectRoot(directory), { directory, id, at })
        notification.session.markViewed(id)
        const expanded = untrack(() => store.workspaceExpanded[directory])
        if (expanded === false) {
          setStore("workspaceExpanded", directory, true)
        }
        requestAnimationFrame(() => scrollToSession(id, `${directory}:${id}`))
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const sidebarWidth = layout.sidebar.opened() ? layout.sidebar.width() : 48
    document.documentElement.style.setProperty("--dialog-left-margin", `${sidebarWidth}px`)
  })

  const loadedSessionDirs = new Set<string>()

  createEffect(() => {
    const project = currentProject()
    const workspaces = workspaceSetting()
    const next = new Set<string>()
    if (!project) {
      loadedSessionDirs.clear()
      return
    }

    if (workspaces) {
      const activeDir = currentDir()
      const dirs = [project.worktree, ...(project.sandboxes ?? [])]
      for (const directory of dirs) {
        const expanded = store.workspaceExpanded[directory] ?? directory === project.worktree
        const active = directory === activeDir
        if (!expanded && !active) continue
        next.add(directory)
      }
    }

    if (!workspaces) {
      next.add(project.worktree)
    }

    for (const directory of next) {
      if (loadedSessionDirs.has(directory)) continue
      globalSync.project.loadSessions(directory)
    }

    loadedSessionDirs.clear()
    for (const directory of next) {
      loadedSessionDirs.add(directory)
    }
  })

  function handleDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    setHoverProject(undefined)
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
    const local = project.worktree
    const dirs = [local, ...(project.sandboxes ?? [])]
    const active = currentProject()
    const directory = active?.worktree === project.worktree ? currentDir() : undefined
    const extra = directory && directory !== local && !dirs.includes(directory) ? directory : undefined
    const pending = extra ? WorktreeState.get(extra)?.status === "pending" : false

    const existing = store.workspaceOrder[project.worktree]
    if (!existing) return extra ? [...dirs, extra] : dirs

    const merged = syncWorkspaceOrder(local, dirs, existing)
    if (pending && extra) return [local, extra, ...merged.filter((directory) => directory !== local)]
    if (!extra) return merged
    if (pending) return merged
    return [...merged, extra]
  }

  const sidebarProject = createMemo(() => {
    if (layout.sidebar.opened()) return currentProject()
    const hovered = hoverProjectData()
    if (hovered) return hovered
    return currentProject()
  })

  function handleWorkspaceDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeWorkspace", id)
  }

  function handleWorkspaceDragOver(event: DragEvent) {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const project = sidebarProject()
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

  const createWorkspace = async (project: LocalProject) => {
    clearSidebarHoverState()
    const created = await globalSDK.client.worktree
      .create({ directory: project.worktree })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.create.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return undefined
      })

    if (!created?.directory) return

    setWorkspaceName(created.directory, created.branch, project.id, created.branch)

    const local = project.worktree
    const key = workspaceKey(created.directory)
    const root = workspaceKey(local)

    setBusy(created.directory, true)
    WorktreeState.pending(created.directory)
    setStore("workspaceExpanded", key, true)
    if (key !== created.directory) {
      setStore("workspaceExpanded", created.directory, true)
    }
    setStore("workspaceOrder", project.worktree, (prev) => {
      const existing = prev ?? []
      const next = existing.filter((item) => {
        const id = workspaceKey(item)
        if (id === root) return false
        return id !== key
      })
      return [local, created.directory, ...next]
    })

    globalSync.child(created.directory)
    navigateWithSidebarReset(`/${base64Encode(created.directory)}/session`)
  }

  const workspaceSidebarCtx: WorkspaceSidebarContext = {
    currentDir,
    sidebarExpanded,
    sidebarHovering,
    nav: () => state.nav,
    hoverSession: () => state.hoverSession,
    setHoverSession,
    clearHoverProjectSoon,
    prefetchSession,
    archiveSession,
    workspaceName,
    renameWorkspace,
    editorOpen,
    openEditor,
    closeEditor,
    setEditor,
    InlineEditor,
    isBusy,
    workspaceExpanded: (directory, local) => workspaceOpenState(store.workspaceExpanded, directory, local),
    setWorkspaceExpanded: (directory, value) => setStore("workspaceExpanded", directory, value),
    showResetWorkspaceDialog: (root, directory) =>
      dialog.show(() => <DialogResetWorkspace root={root} directory={directory} />),
    showDeleteWorkspaceDialog: (root, directory) =>
      dialog.show(() => <DialogDeleteWorkspace root={root} directory={directory} />),
    setScrollContainerRef: (el, mobile) => {
      if (!mobile) scrollContainerRef = el
    },
  }

  const projectSidebarCtx: ProjectSidebarContext = {
    currentDir,
    sidebarOpened: () => layout.sidebar.opened(),
    sidebarHovering,
    hoverProject: () => state.hoverProject,
    nav: () => state.nav,
    onProjectMouseEnter: (worktree, event) => aim.enter(worktree, event),
    onProjectMouseLeave: (worktree) => aim.leave(worktree),
    onProjectFocus: (worktree) => aim.activate(worktree),
    navigateToProject,
    openSidebar: () => layout.sidebar.open(),
    closeProject,
    showEditProjectDialog,
    toggleProjectWorkspaces,
    workspacesEnabled: (project) => project.vcs === "git" && layout.sidebar.workspaces(project.worktree)(),
    workspaceIds,
    workspaceLabel,
    sessionProps: {
      sidebarExpanded,
      sidebarHovering,
      nav: () => state.nav,
      hoverSession: () => state.hoverSession,
      setHoverSession,
      clearHoverProjectSoon,
      prefetchSession,
      archiveSession,
    },
    setHoverSession,
  }

  const SidebarPanel = (panelProps: { project: LocalProject | undefined; mobile?: boolean }) => {
    const projectName = createMemo(() => {
      const project = panelProps.project
      if (!project) return ""
      return project.name || getFilename(project.worktree)
    })
    const projectId = createMemo(() => panelProps.project?.id ?? "")
    const workspaces = createMemo(() => workspaceIds(panelProps.project))
    const unseenCount = createMemo(() =>
      workspaces().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
    )
    const clearNotifications = () =>
      workspaces()
        .filter((directory) => notification.project.unseenCount(directory) > 0)
        .forEach((directory) => notification.project.markViewed(directory))
    const workspacesEnabled = createMemo(() => {
      const project = panelProps.project
      if (!project) return false
      if (project.vcs !== "git") return false
      return layout.sidebar.workspaces(project.worktree)()
    })
    const homedir = createMemo(() => globalSync.data.path.home)

    return (
      <div
        classList={{
          "flex flex-col min-h-0 bg-background-stronger border border-b-0 border-border-weak-base rounded-tl-[12px]": true,
          "flex-1 min-w-0": panelProps.mobile,
        }}
        style={{ width: panelProps.mobile ? undefined : `${Math.max(layout.sidebar.width() - 64, 0)}px` }}
      >
        <Show when={panelProps.project}>
          {(p) => (
            <>
              <div class="shrink-0 px-2 py-1">
                <div class="group/project flex items-start justify-between gap-2 p-2 pr-1">
                  <div class="flex flex-col min-w-0">
                    <InlineEditor
                      id={`project:${projectId()}`}
                      value={projectName}
                      onSave={(next) => renameProject(p(), next)}
                      class="text-14-medium text-text-strong truncate"
                      displayClass="text-14-medium text-text-strong truncate"
                      stopPropagation
                    />

                    <Tooltip
                      placement="bottom"
                      gutter={2}
                      value={p().worktree}
                      class="shrink-0"
                      contentStyle={{
                        "max-width": "640px",
                        transform: "translate3d(52px, 0, 0)",
                      }}
                    >
                      <span class="text-12-regular text-text-base truncate select-text">
                        {p().worktree.replace(homedir(), "~")}
                      </span>
                    </Tooltip>
                  </div>

                  <DropdownMenu modal={!sidebarHovering()}>
                    <DropdownMenu.Trigger
                      as={IconButton}
                      icon="dot-grid"
                      variant="ghost"
                      data-action="project-menu"
                      data-project={base64Encode(p().worktree)}
                      class="shrink-0 size-6 rounded-md data-[expanded]:bg-surface-base-active"
                      classList={{
                        "opacity-0 group-hover/project:opacity-100 data-[expanded]:opacity-100": !panelProps.mobile,
                      }}
                      aria-label={language.t("common.moreOptions")}
                    />
                    <DropdownMenu.Portal mount={!panelProps.mobile ? state.nav : undefined}>
                      <DropdownMenu.Content class="mt-1">
                        <DropdownMenu.Item onSelect={() => showEditProjectDialog(p())}>
                          <DropdownMenu.ItemLabel>{language.t("common.edit")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          data-action="project-workspaces-toggle"
                          data-project={base64Encode(p().worktree)}
                          disabled={p().vcs !== "git" && !layout.sidebar.workspaces(p().worktree)()}
                          onSelect={() => toggleProjectWorkspaces(p())}
                        >
                          <DropdownMenu.ItemLabel>
                            {layout.sidebar.workspaces(p().worktree)()
                              ? language.t("sidebar.workspaces.disable")
                              : language.t("sidebar.workspaces.enable")}
                          </DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          data-action="project-clear-notifications"
                          data-project={base64Encode(p().worktree)}
                          disabled={unseenCount() === 0}
                          onSelect={clearNotifications}
                        >
                          <DropdownMenu.ItemLabel>
                            {language.t("sidebar.project.clearNotifications")}
                          </DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item
                          data-action="project-close-menu"
                          data-project={base64Encode(p().worktree)}
                          onSelect={() => closeProject(p().worktree)}
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.close")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </div>
              </div>

              <div class="flex-1 min-h-0 flex flex-col">
                <Show
                  when={workspacesEnabled()}
                  fallback={
                    <>
                      <div class="shrink-0 py-4 px-3">
                        <TooltipKeybind
                          title={language.t("command.session.new")}
                          keybind={command.keybind("session.new")}
                          placement="top"
                        >
                          <Button
                            size="large"
                            icon="plus-small"
                            class="w-full"
                            onClick={() => navigateWithSidebarReset(`/${base64Encode(p().worktree)}/session`)}
                          >
                            {language.t("command.session.new")}
                          </Button>
                        </TooltipKeybind>
                      </div>
                      <div class="flex-1 min-h-0">
                        <LocalWorkspace
                          ctx={workspaceSidebarCtx}
                          project={p()}
                          sortNow={sortNow}
                          mobile={panelProps.mobile}
                        />
                      </div>
                    </>
                  }
                >
                  <>
                    <div class="shrink-0 py-4 px-3">
                      <TooltipKeybind
                        title={language.t("workspace.new")}
                        keybind={command.keybind("workspace.new")}
                        placement="top"
                      >
                        <Button size="large" icon="plus-small" class="w-full" onClick={() => createWorkspace(p())}>
                          {language.t("workspace.new")}
                        </Button>
                      </TooltipKeybind>
                    </div>
                    <div class="relative flex-1 min-h-0">
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
                            if (!panelProps.mobile) scrollContainerRef = el
                          }}
                          class="size-full flex flex-col py-2 gap-4 overflow-y-auto no-scrollbar [overflow-anchor:none]"
                        >
                          <SortableProvider ids={workspaces()}>
                            <For each={workspaces()}>
                              {(directory) => (
                                <SortableWorkspace
                                  ctx={workspaceSidebarCtx}
                                  directory={directory}
                                  project={p()}
                                  sortNow={sortNow}
                                  mobile={panelProps.mobile}
                                />
                              )}
                            </For>
                          </SortableProvider>
                        </div>
                        <DragOverlay>
                          <WorkspaceDragOverlay
                            sidebarProject={sidebarProject}
                            activeWorkspace={() => store.activeWorkspace}
                            workspaceLabel={workspaceLabel}
                          />
                        </DragOverlay>
                      </DragDropProvider>
                    </div>
                  </>
                </Show>
              </div>
            </>
          )}
        </Show>

        <div
          class="shrink-0 px-2 py-3 border-t border-border-weak-base"
          classList={{
            hidden: !(providers.all().length > 0 && providers.paid().length === 0),
          }}
        >
          <div class="rounded-md bg-background-base shadow-xs-border-base">
            <div class="p-3 flex flex-col gap-2">
              <div class="text-12-medium text-text-strong">{language.t("sidebar.gettingStarted.title")}</div>
              <div class="text-text-base">{language.t("sidebar.gettingStarted.line1")}</div>
              <div class="text-text-base">{language.t("sidebar.gettingStarted.line2")}</div>
            </div>
            <Button
              class="flex w-full text-left justify-start text-12-medium text-text-strong stroke-[1.5px] rounded-md rounded-t-none shadow-none border-t border-border-weak-base px-3"
              size="large"
              icon="plus"
              onClick={connectProvider}
            >
              {language.t("command.provider.connect")}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div class="relative bg-background-base flex-1 min-h-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
      <Titlebar />
      <div class="flex-1 min-h-0 flex">
        <nav
          aria-label={language.t("sidebar.nav.projectsAndSessions")}
          data-component="sidebar-nav-desktop"
          classList={{
            "hidden xl:block": true,
            "relative shrink-0": true,
          }}
          style={{ width: layout.sidebar.opened() ? `${Math.max(layout.sidebar.width(), 244)}px` : "64px" }}
          ref={(el) => {
            setState("nav", el)
          }}
          onMouseEnter={() => {
            if (navLeave.current === undefined) return
            clearTimeout(navLeave.current)
            navLeave.current = undefined
          }}
          onMouseLeave={() => {
            aim.reset()
            if (!sidebarHovering()) return

            if (navLeave.current !== undefined) clearTimeout(navLeave.current)
            navLeave.current = window.setTimeout(() => {
              navLeave.current = undefined
              setHoverProject(undefined)
              setState("hoverSession", undefined)
            }, 300)
          }}
        >
          <div class="@container w-full h-full contain-strict">
            <SidebarContent
              opened={() => layout.sidebar.opened()}
              aimMove={aim.move}
              projects={() => layout.projects.list()}
              renderProject={(project) => (
                <SortableProject ctx={projectSidebarCtx} project={project} sortNow={sortNow} />
              )}
              handleDragStart={handleDragStart}
              handleDragEnd={handleDragEnd}
              handleDragOver={handleDragOver}
              openProjectLabel={language.t("command.project.open")}
              openProjectKeybind={() => command.keybind("project.open")}
              onOpenProject={chooseProject}
              renderProjectOverlay={() => (
                <ProjectDragOverlay projects={() => layout.projects.list()} activeProject={() => store.activeProject} />
              )}
              settingsLabel={() => language.t("sidebar.settings")}
              settingsKeybind={() => command.keybind("settings.open")}
              onOpenSettings={openSettings}
              helpLabel={() => language.t("sidebar.help")}
              onOpenHelp={() => platform.openLink("https://opencode.ai/desktop-feedback")}
              renderPanel={() => <SidebarPanel project={currentProject()} />}
            />
          </div>
          <Show when={!layout.sidebar.opened() ? hoverProjectData()?.worktree : undefined} keyed>
            {(worktree) => (
              <div class="absolute inset-y-0 left-16 z-50 flex" onMouseEnter={aim.reset}>
                <SidebarPanel project={hoverProjectData()} />
              </div>
            )}
          </Show>
          <Show when={layout.sidebar.opened()}>
            <ResizeHandle
              direction="horizontal"
              size={layout.sidebar.width()}
              min={244}
              max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.3 + 64}
              collapseThreshold={244}
              onResize={layout.sidebar.resize}
              onCollapse={layout.sidebar.close}
            />
          </Show>
        </nav>
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
          <nav
            aria-label={language.t("sidebar.nav.projectsAndSessions")}
            data-component="sidebar-nav-mobile"
            classList={{
              "@container fixed top-10 bottom-0 left-0 z-50 w-72 bg-background-base transition-transform duration-200 ease-out": true,
              "translate-x-0": layout.mobileSidebar.opened(),
              "-translate-x-full": !layout.mobileSidebar.opened(),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent
              mobile
              opened={() => layout.sidebar.opened()}
              aimMove={aim.move}
              projects={() => layout.projects.list()}
              renderProject={(project) => (
                <SortableProject ctx={projectSidebarCtx} project={project} sortNow={sortNow} mobile />
              )}
              handleDragStart={handleDragStart}
              handleDragEnd={handleDragEnd}
              handleDragOver={handleDragOver}
              openProjectLabel={language.t("command.project.open")}
              openProjectKeybind={() => command.keybind("project.open")}
              onOpenProject={chooseProject}
              renderProjectOverlay={() => (
                <ProjectDragOverlay projects={() => layout.projects.list()} activeProject={() => store.activeProject} />
              )}
              settingsLabel={() => language.t("sidebar.settings")}
              settingsKeybind={() => command.keybind("settings.open")}
              onOpenSettings={openSettings}
              helpLabel={() => language.t("sidebar.help")}
              onOpenHelp={() => platform.openLink("https://opencode.ai/desktop-feedback")}
              renderPanel={() => <SidebarPanel project={currentProject()} mobile />}
            />
          </nav>
        </div>

        <main
          classList={{
            "size-full overflow-x-hidden flex flex-col items-start contain-strict border-t border-border-weak-base": true,
            "xl:border-l xl:rounded-tl-[12px]": !layout.sidebar.opened(),
          }}
        >
          <Show when={!autoselecting()} fallback={<div class="size-full" />}>
            {props.children}
          </Show>
        </main>
      </div>
      <Toast.Region />
    </div>
  )
}

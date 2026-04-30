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
  type Accessor,
  type JSX,
} from "solid-js"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { useLayout, type LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { Persist, persisted } from "@/utils/persist"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { decode64 } from "@/utils/base64"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Dialog } from "@opencode-ai/ui/dialog"
import { getFilename } from "@opencode-ai/core/util/path"
import { Session, type Message } from "@opencode-ai/sdk/v2/client"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { createStore, produce, reconcile } from "solid-js/store"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useProviders } from "@/hooks/use-providers"
import { showToast, Toast, toaster } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { clearWorkspaceTerminals, getTerminalServerScope } from "@/context/terminal"
import { dropSessionCaches, pickSessionCacheEvictions } from "@/context/global-sync/session-cache"
import {
  clearSessionPrefetchInflight,
  clearSessionPrefetch,
  getSessionPrefetch,
  isSessionPrefetchCurrent,
  runSessionPrefetch,
  setSessionPrefetch,
  shouldSkipSessionPrefetch,
} from "@/context/global-sync/session-prefetch"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { Binary } from "@opencode-ai/core/util/binary"
import { retry } from "@opencode-ai/core/util/retry"
import { playSoundById } from "@/utils/sound"
import { setNavigate } from "@/utils/notification-click"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { setSessionHandoff } from "@/pages/session/handoff"

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { triggerFileFind } from "@opencode-ai/ui/pierre/file-find"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { DialogSelectTheme } from "@/components/dialog-select-theme"
import { DialogSettings } from "@/components/dialog-settings"
import { useCommand, type CommandOption } from "@/context/command"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { navStart } from "@/utils/perf"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogEditProject } from "@/components/dialog-edit-project"
import { DialogSelectSkill } from "@/components/dialog-select-skill"
import { DialogSelectTheme } from "@/components/dialog-select-theme"
import { DialogSwitchProject } from "@/components/dialog-switch-project"
import { DebugBar } from "@/components/debug-bar"
import { QuickAssistant } from "@/components/quick-assistant"
import { Titlebar } from "@/components/titlebar"
import { Spinner } from "@opencode-ai/ui/spinner"
import { ServerConnection, useServer } from "@/context/server"
import { useLanguage, type Locale } from "@/context/language"
import { dict as enDict } from "@/i18n/en"
import {
  canonicalWorkspaceDir,
  displayName,
  effectiveWorkspaceOrder,
  errorMessage,
  latestProjectSession,
  latestRootSession,
  sortedProjectSessions,
  sortedRootSessions,
  waitForMatch,
  workspaceKey,
} from "./layout/helpers"
import {
  extraAgentActive,
  enabledExtraAgents,
  extraAgentByDirectory,
  extraAgentConfig,
  extraAgentDir,
  extraAgentProject,
  isExtraAgentDirectory,
  mainDomain,
} from "./layout/extra-agents"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  deepLinkEvent,
  drainPendingDeepLinks,
} from "./layout/deep-links"
import { createInlineEditorController } from "./layout/inline-editor"
import {
  LocalWorkspace,
  SortableWorkspace,
  WorkspaceDragOverlay,
  type WorkspaceSidebarContext,
} from "./layout/sidebar-workspace"
import { ProjectDragOverlay, SortableProject, type ProjectSidebarContext } from "./layout/sidebar-project"
import { SidebarContent } from "./layout/sidebar-shell"

const USE_NEW_DESIGN = import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"

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
      gettingStartedDismissed: false,
    }),
  )

  const pageReady = createMemo(() => ready())
  let booted = false

  let scrollContainerRef: HTMLDivElement | undefined
  let dialogRun = 0
  let dialogDead = false

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
  const trace = (_event: string, _extra?: Record<string, unknown>) => {}
  const location = useLocation()
  const navigate = useNavigate()
  setNavigate(navigate)
  const providers = useProviders()
  const dialog = useDialog()
  const command = useCommand()
  const theme = useTheme()
  const language = useLanguage()
  createEffect(() => {
    if (!import.meta.env.DEV) return
    if (platform.platform !== "desktop") return
    console.debug("[layout] debug bar disabled on desktop dev")
  })
  type DictKey = keyof typeof enDict
  const kw = (...keys: DictKey[]) => (language.locale() === "en" ? undefined : keys.map((k) => enDict[k]).join(" "))
  // Keep the route slug, resolved directory, and comparison key separate.
  // Most bugs in the project rail/sidebar flow came from mixing these layers.
  const routeSlug = createMemo(() => params.dir)
  const initialDirectory = decode64(routeSlug())
  const routeDir = createMemo(() => {
    const slug = routeSlug()
    if (!slug) return ""
    const dir = decode64(slug)
    if (!dir) return ""
    // Prefer the synced child directory because the raw route value may be a
    // non-canonical path that later resolves to a normalized worktree path.
    return canonicalWorkspaceDir(dir, globalSync.peek(dir, { bootstrap: false })[0].path.directory)
  })
  // Use this only for equality checks, never as a directory source.
  const routeKey = createMemo(() => workspaceKey(routeDir()))
  const availableThemeEntries = createMemo(() => theme.ids().map((id) => [id, theme.themes()[id]] as const))
  const colorSchemeOrder: ColorScheme[] = ["system", "light", "dark"]
  const colorSchemeKey: Record<ColorScheme, "theme.scheme.system" | "theme.scheme.light" | "theme.scheme.dark"> = {
    system: "theme.scheme.system",
    light: "theme.scheme.light",
    dark: "theme.scheme.dark",
  }
  const colorSchemeLabel = (scheme: ColorScheme) => language.t(colorSchemeKey[scheme])
  const waitServer = (key: ServerConnection.Key) =>
    waitForMatch(
      () => server.key,
      (value) => value === key,
    )
  const [state, setState] = createStore({
    autoselect: !initialDirectory && !USE_NEW_DESIGN,
    busyWorkspaces: {} as Record<string, boolean>,
    scrollSessionKey: undefined as string | undefined,
    nav: undefined as HTMLElement | undefined,
    sortNow: Date.now(),
    sizing: false,
    previewSidebarWidth: undefined as number | undefined,
  })

  const [findbar, setFindbar] = createStore({
    open: false,
    q: "",
  })
  let findInput: HTMLInputElement | undefined

  const closeFindbar = () => {
    setFindbar("open", false)
  }

  const openFindbar = (seed?: string) => {
    const q = seed?.trim() || findbar.q
    if (triggerFileFind("open", q || undefined)) {
      closeFindbar()
      return
    }
    if (!platform.find) return
    setFindbar({ open: true, q })
    queueMicrotask(() => {
      findInput?.focus()
      findInput?.select()
    })
  }

  const runFindbar = (dir: 1 | -1) => {
    if (triggerFileFind(dir === 1 ? "next" : "previous")) {
      closeFindbar()
      return
    }
    const q = findbar.q.trim()
    if (!q) return
    void platform.find?.(q, dir)
  }

  const findbarKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closeFindbar()
      return
    }
    if (event.key !== "Enter") return
    event.preventDefault()
    event.stopPropagation()
    runFindbar(event.shiftKey ? -1 : 1)
  }

  const editor = createInlineEditorController()
  const setBusy = (directory: string, value: boolean) => {
    const key = pathKey(directory)
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
  const sortNow = () => state.sortNow
  let sizet: number | undefined
  let sortNowInterval: ReturnType<typeof setInterval> | undefined
  const sortNowTimeout = setTimeout(
    () => {
      setState("sortNow", Date.now())
      sortNowInterval = setInterval(() => setState("sortNow", Date.now()), 60_000)
    },
    60_000 - (Date.now() % 60_000),
  )

  onCleanup(() => {
    dialogDead = true
    dialogRun += 1
    clearTimeout(sortNowTimeout)
    if (sortNowInterval) clearInterval(sortNowInterval)
    if (sizet !== undefined) clearTimeout(sizet)
  })

  onMount(() => {
    const stop = () => {
      setState("sizing", false)
      setState("previewSidebarWidth", undefined)
    }
    const blur = () => reset()
    const hide = () => {
      if (document.visibilityState !== "hidden") return
      reset()
    }
    makeEventListener(window, "pointerup", stop)
    makeEventListener(window, "pointercancel", stop)
    makeEventListener(window, "blur", stop)
    makeEventListener(window, "blur", blur)
    makeEventListener(document, "visibilitychange", hide)
  })

  const sidebarExpanded = createMemo(() => layout.sidebar.opened())
  const sidebarReduced = createMemo(() => false)
  const reset = () => undefined

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
    reset()
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
    showToast({
      title: language.t("toast.theme.title"),
      description: theme.name(nextThemeId),
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

      const unsub = globalSDK.listenAll((e) => {
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

        if (
          e.details?.type === "question.replied" ||
          e.details?.type === "question.rejected" ||
          e.details?.type === "permission.replied"
        ) {
          const props = e.details.properties as { sessionID: string }
          const sessionKey = `${e.name}:${props.sessionID}`
          dismissSessionAlert(sessionKey)
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
            void playSoundById(settings.sounds.permissions())
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
        if (workspaceKey(directory) === routeKey() && props.sessionID === currentSession) return
        if (workspaceKey(directory) === routeKey() && session?.parentID === currentSession) return

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
        if (!routeDir() || !currentSession) return
        const sessionKey = `${routeDir()}:${currentSession}`
        dismissSessionAlert(sessionKey)
        const [store] = globalSync.child(routeDir(), { bootstrap: false })
        const childSessions = store.session.filter((s) => s.parentID === currentSession)
        for (const child of childSessions) {
          dismissSessionAlert(`${routeDir()}:${child.id}`)
        }
      })
    })

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
    const directory = routeDir()
    if (!directory) return
    const extra = extraAgentByDirectory(directory)
    if (extra) return extraAgentProject(extra.id)
    const key = workspaceKey(directory)

    // IMPORTANT: use the same visible project list that the rail renders.
    // This list intentionally excludes extra-agent pseudo projects such as
    // /hermes, /genericagent, and /openclaw. Do NOT convert the drop result
    // into an absolute index for the backing store here; only identify the
    // dragged project and the target project that the user saw on screen.
    const projects = layout.projects.list()

    const sandbox = projects.find((p) => p.sandboxes?.some((item) => pathKey(item) === key))
    if (sandbox) return sandbox

    const direct = projects.find((p) => pathKey(p.worktree) === key)
    if (direct) return direct

    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return

    const meta = globalSync.data.project.find((p) => p.id === id)
    const root = meta?.worktree
    if (!root) return

    return projects.find((p) => p.worktree === root)
  })

  const [autoselecting] = createResource(async () => {
    await ready.promise
    await layout.ready.promise
    if (!untrack(() => state.autoselect)) return

    const list = layout.projects.list()
    const last = server.projects.last()

    if (list.length === 0) {
      if (!last) return
      await openProject(last, true)
    } else {
      const next = list.find((project) => project.worktree === last) ?? list[0]
      if (!next) return
      await openProject(next.worktree, true)
    }
  })

  const workspaceName = (directory: string, projectId?: string, branch?: string) => {
    const key = pathKey(directory)
    const direct = store.workspaceName[key] ?? store.workspaceName[directory]
    if (direct) return direct
    if (!projectId) return
    if (!branch) return
    return store.workspaceBranchName[projectId]?.[branch]
  }

  const setWorkspaceName = (directory: string, next: string, projectId?: string, branch?: string) => {
    const key = pathKey(directory)
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

  const visibleSessionDirs = createMemo(() => {
    const project = currentProject()
    if (!project) return [] as string[]
    if (!workspaceSetting()) return [project.worktree]

    const activeDir = routeDir()
    return workspaceIds(project).filter((directory) => {
      const expanded = store.workspaceExpanded[directory] ?? directory === project.worktree
      const active = pathKey(directory) === pathKey(activeDir)
      return expanded || active
    })
  })

  createEffect(() => {
    if (!pageReady()) return
    if (!layoutReady()) return
    const projects = layout.projects.list()
    for (const [directory, expanded] of Object.entries(store.workspaceExpanded)) {
      if (!expanded) continue
      const key = pathKey(directory)
      const project = projects.find(
        (item) => pathKey(item.worktree) === key || item.sandboxes?.some((sandbox) => pathKey(sandbox) === key),
      )
      if (!project) continue
      if (project.vcs === "git" && layout.sidebar.workspaces(project.worktree)()) continue
      setStore("workspaceExpanded", directory, false)
    }
  })

  const currentSessions = createMemo(() => {
    globalSync.version
    const now = Date.now()
    const project = currentProject()
    const dirs = !workspaceSetting() && project ? workspaceIds(project) : visibleSessionDirs()
    if (dirs.length === 0) return [] as Session[]

    if (!workspaceSetting()) {
      return sortedProjectSessions(
        dirs.map((dir) => globalSync.child(dir, { bootstrap: false })[0]),
        now,
      )
    }

    const result: Session[] = []
    for (const dir of dirs) {
      const [dirStore] = globalSync.child(dir, { bootstrap: false })
      const dirSessions = sortedRootSessions(dirStore, now)
      result.push(...dirSessions)
    }
    return result
  })

  const startup = createMemo(() => {
    if (!pageReady()) return false
    if (!layoutReady()) return false
    if (autoselecting.loading) return false
    const dir = routeDir()
    if (!dir) return true
    const [child] = globalSync.child(dir, { bootstrap: false })
    if (!child.path.directory) return false
    if (child.session.length > 0) return true
    return child.status === "complete"
  })

  createEffect(() => {
    if (booted) return
    if (!startup()) return
    booted = true
    queueMicrotask(() => window.dispatchEvent(new CustomEvent("opencode:startup-interactive")))
  })

  type PrefetchQueue = {
    inflight: Set<string>
    pending: string[]
    pendingSet: Set<string>
    running: number
  }

  const prefetchChunk = 200
  const prefetchConcurrency = 2
  const prefetchPendingLimit = 10
  const span = 4
  const prefetchToken = { value: 0 }
  const prefetchQueues = new Map<string, PrefetchQueue>()

  const PREFETCH_MAX_SESSIONS_PER_DIR = 10
  const prefetchedByDir = new Map<string, Set<string>>()

  const lruFor = (directory: string) => {
    const existing = prefetchedByDir.get(directory)
    if (existing) return existing
    const created = new Set<string>()
    prefetchedByDir.set(directory, created)
    return created
  }

  const markPrefetched = (directory: string, sessionID: string) => {
    const lru = lruFor(directory)
    return pickSessionCacheEvictions({
      seen: lru,
      keep: sessionID,
      limit: PREFETCH_MAX_SESSIONS_PER_DIR,
      preserve: params.id && workspaceKey(directory) === routeKey() ? [params.id] : undefined,
    })
  }

  createEffect(() => {
    const active = new Set(visibleSessionDirs())
    for (const directory of prefetchedByDir.keys()) {
      if (active.has(directory)) continue
      prefetchedByDir.delete(directory)
    }
  })

  createEffect(() => {
    routeDir()
    globalSDK.url

    prefetchToken.value += 1
    clearSessionPrefetchInflight()
    prefetchQueues.clear()
  })

  createEffect(() => {
    const visible = new Set(visibleSessionDirs())
    for (const [directory, q] of prefetchQueues) {
      if (visible.has(directory)) continue
      q.pending.length = 0
      q.pendingSet.clear()
      if (q.running === 0) prefetchQueues.delete(directory)
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

    return runSessionPrefetch({
      directory,
      sessionID,
      task: (rev) =>
        retry(() => globalSDK.client.session.messages({ directory, sessionID, limit: prefetchChunk }))
          .then((messages) => {
            if (prefetchToken.value !== token) return
            if (!isSessionPrefetchCurrent(directory, sessionID, rev)) return

            const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
            const next = items.map((x) => x.info).filter((m): m is Message => !!m?.id)
            const sorted = mergeByID([], next)
            const stale = markPrefetched(directory, sessionID)
            const cursor = messages.response.headers.get("x-next-cursor") ?? undefined

            if (stale.length > 0) {
              clearSessionPrefetch(directory, stale)
              for (const id of stale) {
                globalSync.todo.set(id, undefined)
              }
            }

            const current = store.message[sessionID] ?? []
            const merged = mergeByID(
              current.filter((item): item is Message => !!item?.id),
              sorted,
            )
            const meta = {
              count: merged.length,
              cursor,
              complete: !cursor,
              at: Date.now(),
            }

            if (!isSessionPrefetchCurrent(directory, sessionID, rev)) return

            batch(() => {
              if (stale.length > 0) {
                setStore(
                  produce((draft) => {
                    dropSessionCaches(draft, stale)
                  }),
                )
              }

              setStore("message", sessionID, reconcile(merged, { key: "id" }))
              setSessionPrefetch({ directory, sessionID, ...meta })

              for (const message of items) {
                const currentParts = store.part[message.info.id] ?? []
                const mergedParts = mergeByID(
                  currentParts.filter((item): item is (typeof currentParts)[number] & { id: string } => !!item?.id),
                  message.parts.filter((item): item is (typeof message.parts)[number] & { id: string } => !!item?.id),
                )

                setStore("part", message.info.id, reconcile(mergedParts, { key: "id" }))
              }
            })

            return meta
          })
          .catch(() => undefined),
    })
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
    const cached = untrack(() => {
      const info = getSessionPrefetch(directory, session.id)
      return shouldSkipSessionPrefetch({
        message: store.message[session.id] !== undefined,
        info,
        chunk: prefetchChunk,
      })
    })
    if (cached) return

    const q = queueFor(directory)
    if (q.inflight.has(session.id)) return
    if (q.pendingSet.has(session.id)) {
      if (priority !== "high") return
      const index = q.pending.indexOf(session.id)
      if (index > 0) {
        q.pending.splice(index, 1)
        q.pending.unshift(session.id)
      }
      return
    }

    const lru = lruFor(directory)
    const known = lru.has(session.id)
    if (!known && lru.size >= PREFETCH_MAX_SESSIONS_PER_DIR && priority !== "high") return

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

  const warm = (sessions: Session[], index: number) => {
    for (let offset = 1; offset <= span; offset++) {
      const next = sessions[index + offset]
      if (next) prefetchSession(next, offset === 1 ? "high" : "low")

      const prev = sessions[index - offset]
      if (prev) prefetchSession(prev, offset === 1 ? "high" : "low")
    }
  }

  createEffect(() => {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    if (!params.id) return

    const index = params.id ? sessions.findIndex((s) => s.id === params.id) : 0
    if (index === -1) return

    warm(sessions, index)
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

    prefetchSession(session, "high")
    warm(sessions, targetIndex)

    navigateToSession(session)
  }

  function navigateProjectByOffset(offset: number) {
    const projects = layout.projects.list()
    if (projects.length === 0) return

    const current = currentProject()?.worktree
    const fallback = routeDir() ? projectRoot(routeDir()) : undefined
    const active = current ?? fallback
    const index = active ? projects.findIndex((project) => project.worktree === active) : -1

    const target =
      index === -1
        ? offset > 0
          ? projects[0]
          : projects[projects.length - 1]
        : projects[(index + offset + projects.length) % projects.length]
    if (!target) return

    // warm up child store to prevent flicker
    globalSync.child(target.worktree)
    void openProject(target.worktree)
  }

  function navigateToProjectIndex(index: number) {
    const projects = layout.projects.list()
    const target = projects[index]
    if (!target) return

    globalSync.child(target.worktree)
    void openProject(target.worktree)
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
      warm(sessions, index)

      navigateToSession(session)
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

  async function generateSessionTitle(session: Session) {
    const [, setStore] = globalSync.child(session.directory)
    try {
      const result = await globalSDK.client.session.generateTitle({ sessionID: session.id })
      if (result.error) {
        throw result.error
      }
      const updated = result.data
      setStore(
        produce((draft) => {
          const match = Binary.search(draft.session, session.id, (s) => s.id)
          if (match.found) {
            draft.session[match.index].title = updated.title
          }
        }),
      )
      showToast({
        title: language.t("toast.session.generateTitle.success.title"),
        description: updated.title,
      })
    } catch (err) {
      showToast({
        title: language.t("toast.session.generateTitle.failed.title"),
        description: errorMessage(err),
      })
    }
  }

  const collectRemovedSessionIDs = (sessions: Session[], sessionID: string) => {
    const removed = new Set<string>([sessionID])
    const byParent = new Map<string, string[]>()
    for (const item of sessions) {
      const parentID = item.parentID
      if (!parentID) continue
      const existing = byParent.get(parentID)
      if (existing) {
        existing.push(item.id)
        continue
      }
      byParent.set(parentID, [item.id])
    }
    const stack = [sessionID]
    while (stack.length) {
      const parentID = stack.pop()
      if (!parentID) continue
      const children = byParent.get(parentID)
      if (!children) continue
      for (const child of children) {
        if (removed.has(child)) continue
        removed.add(child)
        stack.push(child)
      }
    }
    return removed
  }

  async function deleteSession(session: Session) {
    const result = await globalSDK.client.session
      .delete({ directory: session.directory, sessionID: session.id })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })
    if (!result) return false

    const [, setStore] = globalSync.child(session.directory)
    setStore(
      produce((draft) => {
        const removed = collectRemovedSessionIDs(draft.session, session.id)
        draft.session = draft.session.filter((item) => !removed.has(item.id))
      }),
    )

    if (params.id === session.id && params.dir === base64Encode(session.directory)) {
      navigateWithSidebarReset(`/${base64Encode(session.directory)}/session`)
    }
    return true
  }

  command.register("layout", () => {
    const commands: CommandOption[] = [
      {
        id: "sidebar.toggle",
        title: language.t("command.sidebar.toggle"),
        keywords: kw("command.sidebar.toggle"),
        category: language.t("command.category.view"),
        keybind: "mod+b",
        onSelect: () => layout.sidebar.toggle(),
      },
      {
        id: "page.find",
        title: language.t("command.page.find"),
        description: language.t("command.page.find.description"),
        keywords: kw("command.page.find", "command.page.find.description"),
        category: language.t("command.category.view"),
        keybind: "mod+f",
        disabled: !platform.find,
        onSelect: () => openFindbar(window.getSelection?.()?.toString().trim() || ""),
      },
      {
        id: "project.open",
        title: language.t("command.project.open"),
        keywords: kw("command.project.open"),
        category: language.t("command.category.project"),
        keybind: "mod+o",
        onSelect: () => chooseProject(),
      },
      {
        id: "project.switch",
        title: language.t("command.project.switch"),
        keywords: kw("command.project.switch"),
        category: language.t("command.category.project"),
        keybind: "mod+t",
        disabled: layout.projects.list().length === 0 && enabledExtraAgents(server.list).length === 0,
        onSelect: () => {
          dialog.show(() => <DialogSwitchProject onSelect={navigateToProject} />, undefined, {
            modal: false,
            preventScroll: false,
          })
        },
      },
      {
        id: "provider.connect",
        title: language.t("command.provider.connect"),
        keywords: kw("command.provider.connect"),
        category: language.t("command.category.provider"),
        onSelect: () => connectProvider(),
      },
      {
        id: "server.switch",
        title: language.t("command.server.switch"),
        keywords: kw("command.server.switch"),
        category: language.t("command.category.server"),
        onSelect: () => openServer(),
      },
      {
        id: "server.reloadBackend",
        title: language.t("command.server.reloadBackend"),
        description: language.t("command.server.reloadBackend.description"),
        keywords: kw("command.server.reloadBackend", "command.server.reloadBackend.description"),
        category: language.t("command.category.server"),
        disabled: !platform.reloadBackend,
        onSelect: async () => {
          if (!platform.reloadBackend) return
          await platform
            .reloadBackend()
            .then(() => {
              showToast({
                variant: "success",
                title: language.t("toast.server.reloadBackend.success.title"),
                description: language.t("toast.server.reloadBackend.success.description"),
                duration: 1800,
              })
            })
            .catch((err: unknown) => {
              showToast({
                variant: "error",
                title: language.t("common.requestFailed"),
                description: err instanceof Error ? err.message : String(err),
                duration: 2200,
              })
            })
        },
      },
      {
        id: "settings.open",
        title: language.t("command.settings.open"),
        keywords: kw("command.settings.open"),
        category: language.t("command.category.settings"),
        keybind: "mod+comma",
        onSelect: () => openSettings(),
      },
      ...(platform.platform === "desktop" && platform.exportDebugLogs
        ? [
            {
              id: "logs.export",
              title: "Export logs",
              category: language.t("command.category.settings"),
              onSelect: () => {
                void platform.exportDebugLogs?.()
              },
            },
          ]
        : []),
      {
        id: "project.openInFinder",
        title:
          platform.os === "macos"
            ? "Open in Finder"
            : platform.os === "windows"
              ? "Open in Explorer"
              : "Open in File Manager",
        category: language.t("command.category.project"),
        disabled: !params.dir || !platform.openInFinder,
        onSelect: async () => {
          const directory = params.dir ? decode64(params.dir) : null
          if (directory && platform.openInFinder) {
            await platform.openInFinder(directory)
          }
        },
      },
      {
        id: "project.openInVscode",
        title: "Open in VSCode",
        category: language.t("command.category.project"),
        disabled: !params.dir || !platform.openInVscode,
        onSelect: async () => {
          const directory = params.dir ? decode64(params.dir) : null
          if (directory && platform.openInVscode) {
            await platform.openInVscode(directory)
          }
        },
      },
      {
        id: "project.openInCursor",
        title: "Open in Cursor",
        category: language.t("command.category.project"),
        disabled: !params.dir || !platform.openInEditor,
        onSelect: async () => {
          const directory = params.dir ? decode64(params.dir) : null
          if (directory && platform.openInEditor) {
            await platform.openInEditor("cursor", directory)
          }
        },
      },
      {
        id: "project.openInSublime",
        title: "Open in Sublime Text",
        category: language.t("command.category.project"),
        disabled: !params.dir || !platform.openInEditor,
        onSelect: async () => {
          const directory = params.dir ? decode64(params.dir) : null
          if (directory && platform.openInEditor) {
            await platform.openInEditor("sublime", directory)
          }
        },
      },
      {
        id: "project.openInZed",
        title: "Open in Zed",
        category: language.t("command.category.project"),
        disabled: !params.dir || !platform.openInEditor,
        onSelect: async () => {
          const directory = params.dir ? decode64(params.dir) : null
          if (directory && platform.openInEditor) {
            await platform.openInEditor("zed", directory)
          }
        },
      },
      {
        id: "project.openInEditor",
        title: "Open in Editor",
        category: language.t("command.category.project"),
        disabled: !params.dir || !platform.openInEditor,
        onSelect: async () => {
          const directory = params.dir ? decode64(params.dir) : null
          if (directory && platform.openInEditor && platform.getDefaultEditor) {
            const defaultEditor = await platform.getDefaultEditor()
            const editor = defaultEditor || "vscode"
            await platform.openInEditor(editor, directory)
          }
        },
      },
      {
        id: "project.openInFinder",
        title:
          platform.os === "macos"
            ? language.t("session.header.open.finder")
            : platform.os === "windows"
              ? language.t("session.header.open.fileExplorer")
              : language.t("session.header.open.fileManager"),
        category: language.t("command.category.project"),
        disabled: !params.dir || (platform.os === "windows" ? !platform.openPath : !platform.openInFinder),
        onSelect: async () => {
          const dir = params.dir ? decode64(params.dir) : null
          if (!dir) return
          if (platform.os === "windows" && platform.openPath) {
            await platform.openPath(dir)
            return
          }
          if (platform.openInFinder) await platform.openInFinder(dir)
        },
      },
      {
        id: "project.openInVscode",
        title: "Open in VSCode",
        category: language.t("command.category.project"),
        disabled: !params.dir || (platform.os === "windows" ? !platform.openPath : !platform.openInVscode),
        onSelect: async () => {
          const dir = params.dir ? decode64(params.dir) : null
          if (!dir) return
          if (platform.os === "windows" && platform.openPath) {
            await platform.openPath(dir, "code")
            return
          }
          if (platform.openInVscode) await platform.openInVscode(dir)
        },
      },
      {
        id: "project.openInCursor",
        title: "Open in Cursor",
        category: language.t("command.category.project"),
        disabled: !params.dir || !platform.openInEditor,
        onSelect: async () => {
          const dir = params.dir ? decode64(params.dir) : null
          if (dir && platform.openInEditor) await platform.openInEditor("cursor", dir)
        },
      },
      {
        id: "project.openInSublime",
        title: "Open in Sublime Text",
        category: language.t("command.category.project"),
        disabled: !params.dir || !platform.openInEditor,
        onSelect: async () => {
          const dir = params.dir ? decode64(params.dir) : null
          if (dir && platform.openInEditor) await platform.openInEditor("sublime", dir)
        },
      },
      {
        id: "project.openInZed",
        title: "Open in Zed",
        category: language.t("command.category.project"),
        disabled: !params.dir || !platform.openInEditor,
        onSelect: async () => {
          const dir = params.dir ? decode64(params.dir) : null
          if (dir && platform.openInEditor) await platform.openInEditor("zed", dir)
        },
      },
      {
        id: "project.openInEditor",
        title: "Open in Editor",
        category: language.t("command.category.project"),
        disabled: !params.dir || !platform.openInEditor,
        onSelect: async () => {
          const dir = params.dir ? decode64(params.dir) : null
          if (dir && platform.openInEditor && platform.getDefaultEditor) {
            const editor = (await platform.getDefaultEditor()) || "vscode"
            await platform.openInEditor(editor, dir)
          }
        },
      },
      {
        id: "session.previous",
        title: language.t("command.session.previous"),
        keywords: kw("command.session.previous"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowup",
        onSelect: () => navigateSessionByOffset(-1),
      },
      {
        id: "session.next",
        title: language.t("command.session.next"),
        keywords: kw("command.session.next"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowdown",
        onSelect: () => navigateSessionByOffset(1),
      },
      {
        id: "session.previous.unseen",
        title: language.t("command.session.previous.unseen"),
        keywords: kw("command.session.previous.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowup",
        onSelect: () => navigateSessionByUnseen(-1),
      },
      {
        id: "session.next.unseen",
        title: language.t("command.session.next.unseen"),
        keywords: kw("command.session.next.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowdown",
        onSelect: () => navigateSessionByUnseen(1),
      },
      {
        id: "session.archive",
        title: language.t("command.session.archive"),
        keywords: kw("command.session.archive"),
        category: language.t("command.category.session"),
        keybind: "mod+shift+backspace",
        disabled: !params.dir || !params.id,
        onSelect: () => {
          const session = currentSessions().find((s) => s.id === params.id)
          if (session) void archiveSession(session)
        },
      },
      {
        id: "workspace.new",
        title: language.t("workspace.new"),
        keywords: kw("workspace.new"),
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
        keywords: kw("command.workspace.toggle", "command.workspace.toggle.description"),
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
        keywords: kw("command.theme.cycle"),
        category: language.t("command.category.theme"),
        keybind: "mod+shift+t",
        onSelect: () => cycleTheme(1),
      },
      {
        id: "theme.select",
        title: language.t("command.theme.select"),
        keywords: kw("command.theme.select"),
        category: language.t("command.category.theme"),
        onSelect: () => dialog.show(() => <DialogSelectTheme />),
      },
    ]

    commands.push({
      id: "theme.scheme.cycle",
      title: language.t("command.theme.scheme.cycle"),
      keywords: kw("command.theme.scheme.cycle"),
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
      keywords: kw("command.language.cycle"),
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
    const run = ++dialogRun
    void import("@/components/dialog-select-provider").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }

  function openServer() {
    const run = ++dialogRun
    void import("@/components/dialog-select-server").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogSelectServer />)
    })
  }

  function openSettings() {
    const run = ++dialogRun
    void import("@/components/dialog-settings").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogSettings />)
    })
  }

  function openConfig(section?: string, pick?: string) {
    if (!params.dir) return
    const q = new URLSearchParams()
    if (section) q.set("section", section)
    if (pick) q.set("pick", pick)
    const next = q.size ? `/${params.dir}/config?${q.toString()}` : `/${params.dir}/config`
    navigate(next)
  }

  function openExtraAgent(id: Parameters<typeof extraAgentDir>[0]) {
    console.debug("[layout] open extra agent", {
      id,
      current: server.current?.integration ?? null,
      directory: routeDir() || null,
    })
    const conn = server.list.find((item) => item.integration === id)
    if (!conn) {
      const cfg = extraAgentConfig(id)
      openConfig(cfg?.section, cfg?.pick)
      return
    }
    if (
      extraAgentActive(id, {
        directory: routeDir(),
        integration: server.current?.integration,
        pathname: location.pathname,
      })
    ) {
      console.debug("[layout] extra agent already active", {
        id,
        directory: routeDir() || null,
        pathname: location.pathname,
      })
      return
    }
    console.debug("[layout] navigate to extra agent", {
      id,
      directory: extraAgentDir(id),
    })
    void navigateToProject(extraAgentDir(id))
  }

  function projectRoot(directory: string) {
    if (isExtraAgentDirectory(directory)) return directory
    const key = workspaceKey(directory)
    const project = layout.projects
      .list()
      .find((item) => pathKey(item.worktree) === key || item.sandboxes?.some((sandbox) => pathKey(sandbox) === key))
    if (project) return project.worktree

    const known = Object.entries(store.workspaceOrder).find(
      ([root, dirs]) => pathKey(root) === key || dirs.some((item) => pathKey(item) === key),
    )
    if (known) return known[0]

    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return directory

    const meta = globalSync.data.project.find((item) => item.id === id)
    return meta?.worktree ?? directory
  }

  function activeProjectRoot(directory: string) {
    return currentProject()?.worktree ?? projectRoot(directory)
  }

  function rememberSessionRoute(directory: string, id: string, root = activeProjectRoot(directory)) {
    setStore("lastProjectSession", root, { directory, id, at: Date.now() })
    return root
  }

  function clearLastProjectSession(root: string) {
    if (!store.lastProjectSession[root]) return
    setStore(
      "lastProjectSession",
      produce((draft) => {
        delete draft[root]
      }),
    )
  }

  function syncSessionRoute(directory: string, id: string, root = activeProjectRoot(directory)) {
    rememberSessionRoute(directory, id, root)
    notification.session.markViewed(id)
    const expanded = untrack(() => store.workspaceExpanded[directory])
    if (expanded === false) {
      setStore("workspaceExpanded", directory, true)
    }
    requestAnimationFrame(() => scrollToSession(id, `${directory}:${id}`))
    return root
  }

  async function navigateToProject(directory: string | undefined) {
    if (!directory) return
    const extra = extraAgentByDirectory(directory)
    if (extra) {
      const conn = server.list.find((item) => item.integration === extra.id)
      if (conn) {
        const key = ServerConnection.key(conn)
        server.setActive(key)
        await waitServer(key)
      }
      navigateWithSidebarReset(`/${base64Encode(extra.directory)}/session`)
      return
    }

    if (server.domain !== mainDomain) {
      const key = server.lastNonExtraAgent
      if (key) {
        server.setActive(key)
        await waitServer(key)
      }
      navigateWithSidebarReset(`/${base64Encode(directory)}/session`)
      return
    }

    const root = projectRoot(directory)
    const project = layout.projects.list().find((item) => workspaceKey(item.worktree) === workspaceKey(root))
    const dirs = workspaceIds(project)
    const stores = dirs.map((dir) => globalSync.child(dir, { bootstrap: false })[0])
    const session = latestProjectSession(
      {
        root,
        dirs,
        recent: store.lastProjectSession[root],
        stores,
      },
      Date.now(),
    )
    server.projects.touch(root)
    if (session) {
      navigateWithSidebarReset(`/${base64Encode(session.directory)}/session/${session.id}`)
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
    if (navigate) return navigateToProject(directory)
  }

  const handleDeepLinks = (urls: string[]) => {
    if (!server.isLocal()) return

    for (const directory of collectOpenProjectDeepLinks(urls)) {
      void openProject(directory)
    }

    for (const link of collectNewSessionDeepLinks(urls)) {
      void openProject(link.directory, false)
      const slug = base64Encode(link.directory)
      if (link.prompt) {
        setSessionHandoff(slug, { prompt: link.prompt })
      }
      const href = link.prompt ? `/${slug}/session?prompt=${encodeURIComponent(link.prompt)}` : `/${slug}/session`
      navigateWithSidebarReset(href)
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
    makeEventListener(window, deepLinkEvent, handler as EventListener)
  })

  const [folderDragging, setFolderDragging] = createSignal(false)
  const [fileDragging, setFileDragging] = createSignal(false)

  onMount(() => {
    if (platform.platform !== "desktop") return

    const dragDropEventName = "opencode:drag-drop"

    const handler = async (event: Event) => {
      const detail = (event as CustomEvent<{ type: string; paths: string[]; position: { x: number; y: number } }>)
        .detail
      if (!detail) return

      if (detail.type === "enter") {
        if (detail.paths.length > 0 && platform.filterDirectories) {
          const dirs = await platform.filterDirectories(detail.paths).catch((): string[] => [])
          const hasFiles = dirs.length < detail.paths.length
          setFolderDragging(dirs.length > 0)
          setFileDragging(hasFiles)
        }
        return
      }

      if (detail.type === "leave") {
        setFolderDragging(false)
        setFileDragging(false)
        return
      }

      if (detail.type !== "drop") return

      setFolderDragging(false)
      setFileDragging(false)
      if (detail.paths.length === 0 || !platform.filterDirectories) return

      const dirs = await platform.filterDirectories(detail.paths).catch((): string[] => [])
      const files = detail.paths.filter((path) => !dirs.includes(path))

      if (dirs.length > 0) {
        for (const dir of dirs) {
          openProject(dir, false)
        }
        await navigateToProject(dirs[0])
      }

      if (files.length > 0) {
        window.dispatchEvent(new CustomEvent("opencode:file-drop", { detail: { paths: files } }))
      }
    }

    window.addEventListener(dragDropEventName, handler as EventListener)
    onCleanup(() => window.removeEventListener(dragDropEventName, handler as EventListener))
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
    const list = layout.projects.list()
    const key = pathKey(directory)
    const index = list.findIndex((x) => pathKey(x.worktree) === key)
    const active = pathKey(currentProject()?.worktree ?? "") === key
    if (index === -1) return

    if (!active) {
      layout.projects.close(directory)
      return
    }

    if (list.length === 1) {
      layout.projects.close(directory)
      navigate("/")
      return
    }

    const next = list[index + 1] ?? list[index - 1]

    navigateWithSidebarReset(`/${base64Encode(next.worktree)}/session`)
    layout.projects.close(directory)
    queueMicrotask(() => {
      void navigateToProject(next.worktree)
    })
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

  const showEditProjectDialog = (project: LocalProject) => {
    const run = ++dialogRun
    void import("@/components/dialog-edit-project").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogEditProject project={project} />)
    })
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          void openProject(directory, false)
        }
        void navigateToProject(result[0])
      } else if (result) {
        void openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      const run = ++dialogRun
      void import("@/components/dialog-select-directory").then((x) => {
        if (dialogDead || dialogRun !== run) return
        dialog.show(
          () => <x.DialogSelectDirectory multiple={true} onSelect={resolve} />,
          () => resolve(null),
        )
      })
    }
  }

  const deleteWorkspace = async (root: string, directory: string, leaveDeletedWorkspace = false) => {
    if (directory === root) return

    const current = routeDir()
    const currentKey = workspaceKey(current)
    const deletedKey = workspaceKey(directory)
    const shouldLeave = leaveDeletedWorkspace || (!!params.dir && currentKey === deletedKey)
    if (!leaveDeletedWorkspace && shouldLeave) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
    }

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

    if (pathKey(store.lastProjectSession[root]?.directory ?? "") === pathKey(directory)) {
      clearLastProjectSession(root)
    }

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

    if (shouldLeave) return

    const nextCurrent = routeDir()
    const nextKey = workspaceKey(nextCurrent)
    const project = layout.projects.list().find((item) => item.worktree === root)
    const dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], store.workspaceOrder[root])
      : [root]
    const valid = dirs.some((item) => pathKey(item) === nextKey)

    if (params.dir && projectRoot(nextCurrent) === root && !valid) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
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
      getTerminalServerScope(server.current, server.key),
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
      const leaveDeletedWorkspace = !!params.dir && routeKey() === workspaceKey(props.directory)
      if (leaveDeletedWorkspace) {
        navigateWithSidebarReset(`/${base64Encode(props.root)}/session`)
      }
      dialog.close()
      void deleteWorkspace(props.root, props.directory, leaveDeletedWorkspace)
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

  function DialogArchivedSessions(props: { project: LocalProject }) {
    const [state, setState] = createStore({
      status: "loading" as "loading" | "ready" | "error",
      sessions: [] as Session[],
    })

    const load = async () => {
      const dirs = [props.project.worktree, ...(props.project.sandboxes ?? [])]
      const rows = await Promise.all(
        dirs.map((directory) =>
          globalSDK.client.session
            .list({ directory, roots: true })
            .then((x) => x.data ?? [])
            .catch(() => []),
        ),
      )
      setState({
        status: "ready",
        sessions: rows
          .flatMap((list) => list)
          .filter((item) => item.time.archived !== undefined)
          .toSorted((a, b) => b.time.updated - a.time.updated),
      })
    }

    onMount(() => {
      load().catch(() => setState("status", "error"))
    })

    const remove = (sessionID: string) => setState("sessions", (list) => list.filter((item) => item.id !== sessionID))

    const open = (session: Session) => {
      dialog.close()
      navigateWithSidebarReset(`/${base64Encode(session.directory)}/session/${session.id}`)
    }

    const label = (session: Session) => {
      if (session.directory === props.project.worktree) return language.t("workspace.type.local")
      const [workspace] = globalSync.child(session.directory, { bootstrap: false })
      return workspaceLabel(session.directory, workspace.vcs?.branch, props.project.id)
    }

    const restore = async (session: Session) => {
      try {
        const restored = await globalSDK.client.session
          .update({
            directory: session.directory,
            sessionID: session.id,
            time: { archived: null },
          })
          .then((x) => x.data)
        if (!restored) throw new Error(language.t("common.requestFailed"))
        const [, setChild] = globalSync.child(session.directory)
        setChild(
          produce((draft) => {
            const match = Binary.search(draft.session, restored.id, (s) => s.id)
            if (match.found) {
              draft.session[match.index] = restored
              return
            }
            draft.session.splice(match.index, 0, restored)
          }),
        )
        await globalSync.project.loadSessions(session.directory, { silent: true, force: true })
        remove(session.id)
      } catch (err) {
        showToast({
          title: language.t("session.restore.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
      }
    }

    const removeArchived = async (session: Session) => {
      const ok = await globalSDK.client.session
        .delete({ sessionID: session.id, directory: session.directory })
        .then((x) => x.data)
        .catch((err) => {
          showToast({
            title: language.t("session.delete.failed.title"),
            description: errorMessage(err, language.t("common.requestFailed")),
          })
          return false
        })
      if (!ok) return false
      return true
    }

    return (
      <Dialog title={language.t("sidebar.project.archivedSessions")} fit>
        <div class="flex flex-col gap-3 pl-6 pr-2.5 pb-3 min-w-[32rem] max-w-[40rem]">
          <Show when={state.status === "loading"}>
            <div class="flex items-center gap-2 text-12-regular text-text-weak">
              <Spinner class="size-4" />
              {language.t("prompt.loading")}
            </div>
          </Show>
          <Show when={state.status === "error"}>
            <div class="text-12-regular text-text-weak">{language.t("common.requestFailed")}</div>
          </Show>
          <Show when={state.status === "ready" && state.sessions.length === 0}>
            <div class="text-12-regular text-text-weak">{language.t("sidebar.project.noArchivedSessions")}</div>
          </Show>
          <Show when={state.status === "ready" && state.sessions.length > 0}>
            <div class="max-h-80 overflow-y-auto flex flex-col gap-1 pr-1">
              <For each={state.sessions}>
                {(session) => {
                  const [confirm, setConfirm] = createStore({ on: false })
                  let timer: ReturnType<typeof setTimeout> | undefined

                  const start = () => {
                    setConfirm("on", true)
                    clearTimeout(timer)
                    timer = setTimeout(() => setConfirm("on", false), 3000)
                  }

                  const removeSession = async () => {
                    clearTimeout(timer)
                    const ok = await removeArchived(session)
                    if (!ok) {
                      setConfirm("on", false)
                      return
                    }
                    remove(session.id)
                  }

                  onCleanup(() => clearTimeout(timer))

                  return (
                    <div class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-raised-base-hover">
                      <button class="flex-1 min-w-0 text-left" onClick={() => open(session)}>
                        <div class="text-14-regular text-text-strong truncate">{session.title}</div>
                        <div class="text-12-regular text-text-weak truncate">{label(session)}</div>
                      </button>
                      <div class="flex items-center gap-1 shrink-0">
                        <Tooltip value={language.t("session.restore")} placement="top">
                          <IconButton
                            icon="arrow-left"
                            variant="ghost"
                            class="size-6 rounded-md cursor-pointer"
                            aria-label={language.t("session.restore")}
                            onClick={() => void restore(session)}
                          />
                        </Tooltip>
                        <Show
                          when={confirm.on}
                          fallback={
                            <Tooltip value={language.t("common.delete")} placement="top">
                              <IconButton
                                icon="trash"
                                variant="ghost"
                                class="size-6 rounded-md cursor-pointer"
                                style={{ "--icon-base": "var(--icon-critical-base)" }}
                                aria-label={language.t("common.delete")}
                                onClick={start}
                              />
                            </Tooltip>
                          }
                        >
                          <Button
                            variant="primary"
                            size="small"
                            class="shrink-0 cursor-pointer"
                            style={{
                              "background-color": "var(--surface-critical-base)",
                              "border-color": "var(--surface-critical-base)",
                              color: "var(--text-on-critical-base)",
                            }}
                            onClick={removeSession}
                          >
                            {language.t("session.delete.button")}
                          </Button>
                        </Show>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.close")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  const activeRoute = {
    session: "",
    sessionProject: "",
  }

  createEffect(
    on(
      () => {
        return [pageReady(), routeSlug(), params.id, currentProject()?.worktree, routeDir()] as const
      },
      ([ready, slug, id, root, dir]) => {
        if (!ready || !slug || !dir) {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          activeRoute.directory = ""
          return
        }
        requestAnimationFrame(() => scrollToSession(id, `${directory}:${id}`))
      },
    ),
  )

  createEffect(() => {
    const sidebarWidth = layout.sidebar.opened() ? Math.max(layout.sidebar.width(), 244) : 48
    document.documentElement.style.setProperty("--dialog-left-margin", `${sidebarWidth}px`)
  })

  const side = createMemo(() => Math.max(state.previewSidebarWidth ?? layout.sidebar.width(), 244))
  const dragSide = createMemo(() => Math.max(state.previewSidebarWidth ?? layout.sidebar.width(), 244))
  const panel = createMemo(() => Math.max(side() - 64, 0))
  const drag = {
    click: false,
    frame: 0,
  }
  let projectOver = ""

  let started = false

  onCleanup(() => {
    if (!drag.frame) return
    cancelAnimationFrame(drag.frame)
  })

  createEffect(
    on(
      () => [visibleSessionDirs(), routeDir(), autoselecting.loading] as const,
      ([dirs, dir, selecting]) => {
        trace("visibleSessionDirs.effect", {
          dirs,
          dir,
          selecting,
          started,
        })
        if (selecting) return
        if (dirs.length === 0) return

        if (!started) {
          started = true
          if (!dir) return
          const [child] = globalSync.child(dir, { bootstrap: false })
          if (child.sessions === "ready" || child.sessions === "loading") return
          trace("visibleSessionDirs.load", {
            directory: dir,
            reason: "startup",
          })
          globalSync.project.loadSessions(dir, { silent: true })
          return
        }

        for (const directory of dirs) {
          const [child] = globalSync.child(directory, { bootstrap: false })
          if (child.sessions === "ready" || child.sessions === "loading") continue
          trace("visibleSessionDirs.load", {
            directory,
            reason: "visible",
          })
          globalSync.project.loadSessions(directory, { silent: true })
        }
      },
      { defer: true },
    ),
  )

  function handleDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    projectOver = ""
    console.debug(`[project-dnd] start draggable=${id}`)
    setStore("activeProject", id)
  }

  function handleDragOver(event: DragEvent) {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return
    const next = `${draggable.id.toString()}->${droppable.id.toString()}`
    if (next === projectOver) return
    projectOver = next

    const projects = layout.projects.list()
    const from = projects.findIndex((p) => p.worktree === draggable.id.toString())
    const to = projects.findIndex((p) => p.worktree === droppable.id.toString())
    console.debug(
      `[project-dnd] over draggable=${draggable.id.toString()} droppable=${droppable.id.toString()} from=${from} to=${to} order=${projects.map((project) => project.worktree).join(" | ")}`,
    )
  }

  function handleDragEnd(event: DragEvent) {
    if (store.activeProject) {
      drag.click = true
      if (drag.frame) cancelAnimationFrame(drag.frame)
      drag.frame = requestAnimationFrame(() => {
        drag.click = false
        drag.frame = 0
      })
    }
    const { draggable, droppable } = event
    setStore("activeProject", undefined)
    if (!draggable || !droppable) {
      console.debug("[project-dnd] end cancelled")
      projectOver = ""
      return
    }

    const projects = layout.projects.list()
    const from = projects.findIndex((p) => p.worktree === draggable.id.toString())
    const to = projects.findIndex((p) => p.worktree === droppable.id.toString())
    console.debug(
      `[project-dnd] end draggable=${draggable.id.toString()} droppable=${droppable.id.toString()} from=${from} to=${to} order=${projects.map((project) => project.worktree).join(" | ")}`,
    )
    projectOver = ""
    if (from === -1 || to === -1 || from === to) return

    // Pass the target project ID, not the filtered list index. The backing
    // store may contain hidden extra-agent entries, so only server-side code
    // can safely translate this visible drop target into a real insertion slot.
    layout.projects.move(draggable.id.toString(), droppable.id.toString())
  }

  function consumeProjectClick() {
    if (!drag.click) return false
    drag.click = false
    if (drag.frame) cancelAnimationFrame(drag.frame)
    drag.frame = 0
    return true
  }

  function workspaceIds(project: LocalProject | undefined) {
    if (!project) return []
    const local = project.worktree
    const dirs = [local, ...(project.sandboxes ?? [])]
    const active = currentProject()
    const directory = workspaceKey(active?.worktree ?? "") === workspaceKey(project.worktree) ? routeDir() : undefined
    const extra =
      directory && pathKey(directory) !== pathKey(local) && !dirs.some((item) => pathKey(item) === pathKey(directory))
        ? directory
        : undefined
    const pending = extra ? WorktreeState.get(extra)?.status === "pending" : false

    const ordered = effectiveWorkspaceOrder(local, dirs, store.workspaceOrder[project.worktree])
    if (pending && extra) return [local, extra, ...ordered.filter((item) => item !== local)]
    if (!extra) return ordered
    if (pending) return ordered
    return [...ordered, extra]
  }

  const sidebarProject = createMemo(() => {
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
    setStore(
      "workspaceOrder",
      project.worktree,
      result.filter((directory) => pathKey(directory) !== pathKey(project.worktree)),
    )
  }

  function handleWorkspaceDragEnd() {
    setStore("activeWorkspace", undefined)
  }

  const ProjectIcon = (props: { project: LocalProject; class?: string; notify?: boolean }): JSX.Element => {
    const notification = useNotification()
    const notifications = createMemo(() => notification.project.unseen(props.project.worktree))
    const hasError = createMemo(() => notifications().some((n) => n.type === "error"))
    const name = createMemo(() => props.project.name || getFilename(props.project.worktree))
    const opencode = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

    return (
      <div class={`relative size-8 shrink-0 rounded ${props.class ?? ""}`}>
        <div class="size-full rounded overflow-clip">
          <Avatar
            fallback={name()}
            src={props.project.id === opencode ? "https://opencode.ai/favicon.svg" : props.project.icon?.override}
            {...getAvatarColors(props.project.icon?.color)}
            class="size-full rounded"
            classList={{ "badge-mask": notifications().length > 0 && props.notify }}
          />
        </div>
        <Show when={notifications().length > 0 && props.notify}>
          <div
            classList={{
              "absolute top-px right-px size-1.5 rounded-full z-10": true,
              "bg-icon-critical-base": hasError(),
              "bg-text-interactive-base": !hasError(),
            }}
          />
        </Show>
      </div>
    )
  }

  const SessionItem = (props: {
    session: Session
    slug: string
    mobile?: boolean
    dense?: boolean
    popover?: boolean
    children?: Map<string, string[]>
  }): JSX.Element => {
    const notification = useNotification()
    const notifications = createMemo(() => notification.session.unseen(props.session.id))
    const hasError = createMemo(() => notifications().some((n) => n.type === "error"))
    const [sessionStore] = globalSync.child(props.session.directory)
    const hasPermissions = createMemo(() => {
      const permissions = sessionStore.permission?.[props.session.id] ?? []
      if (permissions.length > 0) return true

      const childIDs = props.children?.get(props.session.id)
      if (childIDs) {
        for (const id of childIDs) {
          const childPermissions = sessionStore.permission?.[id] ?? []
          if (childPermissions.length > 0) return true
        }
        return false
      }

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
      return agentColor(user.agent, agent?.color)
    })

    const hoverMessages = createMemo(() =>
      sessionStore.message[props.session.id]?.filter((message) => message.role === "user"),
    )
    const hoverReady = createMemo(() => sessionStore.message[props.session.id] !== undefined)
    const hoverAllowed = createMemo(() => !props.mobile && sidebarExpanded())
    const hoverEnabled = createMemo(() => (props.popover ?? true) && hoverAllowed())
    const isActive = createMemo(() => props.session.id === params.id)
    const [menu, setMenu] = createStore({
      open: false,
      pendingRename: false,
    })

    const hoverPrefetch = { current: undefined as ReturnType<typeof setTimeout> | undefined }
    const cancelHoverPrefetch = () => {
      if (hoverPrefetch.current === undefined) return
      clearTimeout(hoverPrefetch.current)
      hoverPrefetch.current = undefined
    }
    const scheduleHoverPrefetch = () => {
      if (hoverPrefetch.current !== undefined) return
      hoverPrefetch.current = setTimeout(() => {
        hoverPrefetch.current = undefined
        prefetchSession(props.session)
      }, 200)
    }

    onCleanup(cancelHoverPrefetch)

    const messageLabel = (message: Message) => {
      const parts = sessionStore.part[message.id] ?? []
      const text = parts.find((part): part is TextPart => part?.type === "text" && !part.synthetic && !part.ignored)
      return text?.text
    }

    const item = (
      <A
        href={`${props.slug}/session/${props.session.id}`}
        class={`flex items-center justify-between gap-3 min-w-0 text-left w-full focus:outline-none transition-[padding] ${menu.open ? "pr-7" : ""} group-hover/session:pr-7 group-focus-within/session:pr-7 group-active/session:pr-7 ${props.dense ? "py-0.5" : "py-1"}`}
        onPointerEnter={scheduleHoverPrefetch}
        onPointerLeave={cancelHoverPrefetch}
        onMouseEnter={scheduleHoverPrefetch}
        onMouseLeave={cancelHoverPrefetch}
        onFocus={() => prefetchSession(props.session, "high")}
        onClick={() => {
          setState("hoverSession", undefined)
          if (layout.sidebar.opened()) return
          queueMicrotask(() => setState("hoverProject", undefined))
        }}
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
          <InlineEditor
            id={`session:${props.session.id}`}
            value={() => props.session.title}
            onSave={(next) => renameSession(props.session, next)}
            class="text-14-regular text-text-strong grow-1 min-w-0 overflow-hidden text-ellipsis truncate"
            displayClass="text-14-regular text-text-strong grow-1 min-w-0 overflow-hidden text-ellipsis truncate"
            stopPropagation
          />
          <Show when={props.session.summary}>
            {(summary) => (
              <div class="group-hover/session:hidden group-active/session:hidden group-focus-within/session:hidden">
                <DiffChanges changes={summary()} />
              </div>
            )}
          </Show>
        </div>
      </A>
    )

    return (
      <div
        data-session-id={props.session.id}
        class="group/session relative w-full rounded-md cursor-default transition-colors pl-2 pr-3
               hover:outline hover:outline-1 hover:outline-[var(--color-surface-raised-base-active)] [&:has(:focus-visible)]:outline [&:has(:focus-visible)]:outline-1 [&:has(:focus-visible)]:outline-[var(--color-surface-raised-base-active)] has-[[data-expanded]]:bg-surface-raised-base-hover has-[.active]:bg-surface-raised-base-active"
      >
        <Show
          when={hoverEnabled()}
          fallback={
            <Tooltip placement={props.mobile ? "bottom" : "right"} value={props.session.title} gutter={10}>
              {item}
            </Tooltip>
          }
        >
          <HoverCard
            openDelay={1000}
            closeDelay={sidebarHovering() ? 600 : 0}
            placement="right-start"
            gutter={16}
            shift={-2}
            trigger={item}
            mount={!props.mobile ? state.nav : undefined}
            open={state.hoverSession === props.session.id}
            onOpenChange={(open) => setState("hoverSession", open ? props.session.id : undefined)}
          >
            <Show
              when={hoverReady()}
              fallback={<div class="text-12-regular text-text-weak">{language.t("session.messages.loading")}</div>}
            >
              <div class="overflow-y-auto max-h-72 h-full">
                <MessageNav
                  messages={hoverMessages() ?? []}
                  current={undefined}
                  getLabel={messageLabel}
                  onMessageSelect={(message) => {
                    if (!isActive()) {
                      sessionStorage.setItem("opencode.pendingMessage", `${props.session.id}|${message.id}`)
                      navigate(`${props.slug}/session/${props.session.id}`)
                      return
                    }
                    window.history.replaceState(null, "", `#message-${message.id}`)
                    window.dispatchEvent(new HashChangeEvent("hashchange"))
                  }}
                  size="normal"
                  class="w-60"
                />
              </div>
            </Show>
          </HoverCard>
        </Show>
        <div
          class={`absolute ${props.dense ? "top-0.5 right-0.5" : "top-1 right-1"} flex items-center gap-0.5 transition-opacity`}
          classList={{
            "opacity-100 pointer-events-auto": menu.open,
            "opacity-0 pointer-events-none": !menu.open,
            "group-hover/session:opacity-100 group-hover/session:pointer-events-auto": true,
            "group-focus-within/session:opacity-100 group-focus-within/session:pointer-events-auto": true,
          }}
        >
          <Tooltip value={language.t("session.generateTitle")} placement="top">
            <IconButton
              icon="models"
              variant="ghost"
              class="size-6 rounded-md cursor-pointer"
              aria-label={language.t("session.generateTitle")}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void generateSessionTitle(props.session)
              }}
            />
          </Tooltip>
          <Tooltip value={language.t("common.archive")} placement="top">
            <IconButton
              icon="archive"
              variant="ghost"
              class="size-6 rounded-md cursor-pointer"
              aria-label={language.t("common.archive")}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void archiveSession(props.session)
              }}
            />
          </Tooltip>
        </div>
      </div>
    )
  }

  const NewSessionItem = (props: { slug: string; mobile?: boolean; dense?: boolean }): JSX.Element => {
    const label = language.t("command.session.new")
    const tooltip = () => props.mobile || !sidebarExpanded()
    const item = (
      <A
        href={`${props.slug}/session`}
        end
        class={`flex items-center justify-between gap-3 min-w-0 text-left w-full focus:outline-none ${props.dense ? "py-0.5" : "py-1"}`}
        onClick={() => {
          setState("hoverSession", undefined)
          if (layout.sidebar.opened()) return
          queueMicrotask(() => setState("hoverProject", undefined))
        }}
      >
        <div class="flex items-center gap-1 w-full">
          <div class="shrink-0 size-6 flex items-center justify-center">
            <Icon name="plus-small" size="small" class="text-icon-weak" />
          </div>
          <span class="text-14-regular text-text-strong grow-1 min-w-0 overflow-hidden text-ellipsis truncate">
            {label}
          </span>
        </div>
      </A>
    )

    return (
      <div class="group/session relative w-full rounded-md cursor-default transition-colors pl-2 pr-3 hover:outline hover:outline-1 hover:outline-[var(--color-surface-raised-base-active)] [&:has(:focus-visible)]:outline [&:has(:focus-visible)]:outline-1 [&:has(:focus-visible)]:outline-[var(--color-surface-raised-base-active)] has-[.active]:bg-surface-raised-base-active">
        <Show
          when={!tooltip()}
          fallback={
            <Tooltip placement={props.mobile ? "bottom" : "right"} value={label} gutter={10}>
              {item}
            </Tooltip>
          }
        >
          {item}
        </Show>
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
      const project = sidebarProject()
      if (!project) return
      const directory = store.activeWorkspace
      if (!directory) return

      const [workspaceStore] = globalSync.child(directory, { bootstrap: false })
      const kind =
        directory === project.worktree ? language.t("workspace.type.local") : language.t("workspace.type.sandbox")
      const name = workspaceLabel(directory, workspaceStore.vcs?.branch, project.id)
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
    const [workspaceStore, setWorkspaceStore] = globalSync.child(props.directory, { bootstrap: false })
    const [menu, setMenu] = createStore({
      open: false,
      pendingRename: false,
    })
    const slug = createMemo(() => base64Encode(props.directory))
    const sessions = createMemo(() =>
      workspaceStore.session
        .filter((session) => session.directory === workspaceStore.path.directory)
        .filter((session) => !session.parentID && !session.time?.archived)
        .toSorted(sortSessions(Date.now())),
    )
    const children = createMemo(() => {
      const map = new Map<string, string[]>()
      for (const session of workspaceStore.session) {
        if (!session.parentID) continue
        const existing = map.get(session.parentID)
        if (existing) {
          existing.push(session.id)
          continue
        }
        map.set(session.parentID, [session.id])
      }
      return map
    })
    const local = createMemo(() => props.directory === props.project.worktree)
    const active = createMemo(() => {
      const current = decode64(params.dir) ?? ""
      return current === props.directory
    })
    const workspaceValue = createMemo(() => {
      const branch = workspaceStore.vcs?.branch
      const name = branch ?? getFilename(props.directory)
      return workspaceName(props.directory, props.project.id, branch) ?? name
    })
    const open = createMemo(() => store.workspaceExpanded[props.directory] ?? local())
    const boot = createMemo(() => open() || active())
    const booted = createMemo((prev) => prev || workspaceStore.status === "complete", false)
    const loading = createMemo(() => open() && !booted() && sessions().length === 0)
    const hasMore = createMemo(() => workspaceStore.sessionTotal > sessions().length)
    const busy = createMemo(() => isBusy(props.directory))
    const loadMore = async () => {
      setWorkspaceStore("limit", (limit) => limit + 5)
      await globalSync.project.loadSessions(props.directory)
    }

    const workspaceEditActive = createMemo(() => editorOpen(`workspace:${props.directory}`))

    const openWrapper = (value: boolean) => {
      setStore("workspaceExpanded", props.directory, value)
      if (value) return
      if (editorOpen(`workspace:${props.directory}`)) closeEditor()
    }

    createEffect(() => {
      if (!boot()) return
      globalSync.child(props.directory, { bootstrap: true })
    })

    const header = () => (
      <div class="flex items-center gap-1 min-w-0 flex-1">
        <div class="flex items-center justify-center shrink-0 size-6">
          <Show when={busy()} fallback={<Icon name="branch" size="small" />}>
            <Spinner class="size-[15px]" />
          </Show>
        </div>
        <span class="text-14-medium text-text-base shrink-0">
          {local() ? language.t("workspace.type.local") : language.t("workspace.type.sandbox")} :
        </span>
        <Show
          when={!local()}
          fallback={
            <span class="text-14-medium text-text-base min-w-0 truncate">
              {workspaceStore.vcs?.branch ?? getFilename(props.directory)}
            </span>
          }
        >
          <InlineEditor
            id={`workspace:${props.directory}`}
            value={workspaceValue}
            onSave={(next) => {
              const trimmed = next.trim()
              if (!trimmed) return
              renameWorkspace(props.directory, trimmed, props.project.id, workspaceStore.vcs?.branch)
              setEditor("value", workspaceValue())
            }}
            class="text-14-medium text-text-base min-w-0 truncate"
            displayClass="text-14-medium text-text-base min-w-0 truncate"
            editing={workspaceEditActive()}
            stopPropagation={false}
            openOnDblClick={false}
          />
        </Show>
        <Icon
          name={open() ? "chevron-down" : "chevron-right"}
          size="small"
          class="shrink-0 text-icon-base opacity-0 transition-opacity group-hover/workspace:opacity-100 group-focus-within/workspace:opacity-100"
        />
      </div>
    )

    return (
      <div
        // @ts-ignore
        use:sortable
        classList={{
          "opacity-30": sortable.isActiveDraggable,
          "opacity-50 pointer-events-none": busy(),
        }}
      >
        <Collapsible variant="ghost" open={open()} class="shrink-0" onOpenChange={openWrapper}>
          <div class="px-2 py-1">
            <div class="group/workspace relative">
              <div class="flex items-center gap-1">
                <Show
                  when={workspaceEditActive()}
                  fallback={
                    <Collapsible.Trigger class="flex items-center justify-between w-full pl-2 pr-16 py-1.5 rounded-md hover:bg-surface-raised-base-hover">
                      {header()}
                    </Collapsible.Trigger>
                  }
                >
                  <div class="flex items-center justify-between w-full pl-2 pr-16 py-1.5 rounded-md">{header()}</div>
                </Show>
                <div
                  class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 transition-opacity"
                  classList={{
                    "opacity-100 pointer-events-auto": menu.open,
                    "opacity-0 pointer-events-none": !menu.open,
                    "group-hover/workspace:opacity-100 group-hover/workspace:pointer-events-auto": true,
                    "group-focus-within/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto": true,
                  }}
                >
                  <DropdownMenu
                    modal={!sidebarHovering()}
                    open={menu.open}
                    onOpenChange={(open) => setMenu("open", open)}
                  >
                    <Tooltip value={language.t("common.moreOptions")} placement="top">
                      <DropdownMenu.Trigger
                        as={IconButton}
                        icon="dot-grid"
                        variant="ghost"
                        class="size-6 rounded-md"
                        aria-label={language.t("common.moreOptions")}
                      />
                    </Tooltip>
                    <DropdownMenu.Portal mount={!props.mobile ? state.nav : undefined}>
                      <DropdownMenu.Content
                        onCloseAutoFocus={(event) => {
                          if (!menu.pendingRename) return
                          event.preventDefault()
                          setMenu("pendingRename", false)
                          openEditor(`workspace:${props.directory}`, workspaceValue())
                        }}
                      >
                        <DropdownMenu.Item
                          disabled={local()}
                          onSelect={() => {
                            setMenu("pendingRename", true)
                            setMenu("open", false)
                          }}
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          disabled={local() || busy()}
                          onSelect={() =>
                            dialog.show(() => (
                              <DialogResetWorkspace root={props.project.worktree} directory={props.directory} />
                            ))
                          }
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.reset")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          disabled={local() || busy()}
                          onSelect={() =>
                            dialog.show(() => (
                              <DialogDeleteWorkspace root={props.project.worktree} directory={props.directory} />
                            ))
                          }
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </div>

          <Collapsible.Content>
            <nav class="flex flex-col gap-1 px-2">
              <NewSessionItem slug={slug()} mobile={props.mobile} />
              <Show when={loading()}>
                <SessionSkeleton />
              </Show>
              <For each={sessions()}>
                {(session) => (
                  <SessionItem session={session} slug={slug()} mobile={props.mobile} children={children()} />
                )}
              </For>
              <Show when={hasMore()}>
                <div class="relative w-full py-1">
                  <Button
                    variant="ghost"
                    class="flex w-full text-left justify-start text-14-regular text-text-weak pl-9 pr-10"
                    size="large"
                    onClick={(e: MouseEvent) => {
                      loadMore()
                      ;(e.currentTarget as HTMLButtonElement).blur()
                    }}
                  >
                    {language.t("common.loadMore")}
                  </Button>
                </div>
              </Show>
            </nav>
          </Collapsible.Content>
        </Collapsible>
      </div>
    )
  }

  const SortableProject = (props: { project: LocalProject; mobile?: boolean }): JSX.Element => {
    const sortable = createSortable(props.project.worktree)
    const selected = createMemo(() => {
      const current = decode64(params.dir) ?? ""
      return props.project.worktree === current || props.project.sandboxes?.includes(current)
    })

    const workspaces = createMemo(() => workspaceIds(props.project).slice(0, 2))
    const workspaceEnabled = createMemo(
      () => props.project.vcs === "git" && layout.sidebar.workspaces(props.project.worktree)(),
    )
    const [open, setOpen] = createSignal(false)

    const preview = createMemo(() => !props.mobile && layout.sidebar.opened())
    const overlay = createMemo(() => !props.mobile && !layout.sidebar.opened())
    const active = createMemo(() => (preview() ? open() : overlay() && state.hoverProject === props.project.worktree))

    createEffect(() => {
      if (preview()) return
      if (!open()) return
      setOpen(false)
    })

    const label = (directory: string) => {
      const [data] = globalSync.child(directory, { bootstrap: false })
      const kind =
        directory === props.project.worktree ? language.t("workspace.type.local") : language.t("workspace.type.sandbox")
      const name = workspaceLabel(directory, data.vcs?.branch, props.project.id)
      return `${kind} : ${name}`
    }

    const sessions = (directory: string) => {
      const [data] = globalSync.child(directory, { bootstrap: false })
      const root = workspaceKey(directory)
      return data.session
        .filter((session) => workspaceKey(session.directory) === root)
        .filter((session) => !session.parentID && !session.time?.archived)
        .toSorted(sortSessions(Date.now()))
        .slice(0, 2)
    }

    const projectSessions = () => {
      const directory = props.project.worktree
      const [data] = globalSync.child(directory, { bootstrap: false })
      const root = workspaceKey(directory)
      return data.session
        .filter((session) => workspaceKey(session.directory) === root)
        .filter((session) => !session.parentID && !session.time?.archived)
        .toSorted(sortSessions(Date.now()))
        .slice(0, 2)
    }

    const projectName = () => props.project.name || getFilename(props.project.worktree)
    const trigger = (
      <button
        type="button"
        aria-label={projectName()}
        data-action="project-switch"
        data-project={base64Encode(props.project.worktree)}
        classList={{
          "flex items-center justify-center size-10 p-1 rounded-lg overflow-hidden transition-colors cursor-default": true,
          "bg-transparent border-2 border-icon-strong-base hover:bg-surface-base-hover": selected(),
          "bg-transparent border border-transparent hover:bg-surface-base-hover hover:border-border-weak-base":
            !selected() && !active(),
          "bg-surface-base-hover border border-border-weak-base": !selected() && active(),
        }}
        onMouseEnter={() => {
          if (!overlay()) return
          globalSync.child(props.project.worktree)
        }}
        onFocus={() => {
          if (!overlay()) return
          globalSync.child(props.project.worktree)
        }}
        onClick={(e) => {
          if (overlay()) {
            e.stopPropagation()
            setState("hoverProject", props.project.worktree)
            setState("hoverSession", undefined)
          } else {
            navigateToProject(props.project.worktree)
          }
        }}
        onBlur={() => setOpen(false)}
      >
        <ContextMenu.Trigger
          as="button"
          type="button"
          aria-label={projectName()}
          data-action="project-switch"
          data-project={base64Encode(props.project.worktree)}
          classList={{
            "flex items-center justify-center size-10 p-1 rounded-lg overflow-hidden transition-colors cursor-default": true,
            "bg-transparent border-2 border-icon-strong-base hover:bg-surface-base-hover": selected(),
            "bg-transparent border border-transparent hover:bg-surface-base-hover hover:border-border-weak-base":
              !selected() && !active(),
            "bg-surface-base-hover border border-border-weak-base": !selected() && active(),
          }}
          onClick={(event: MouseEvent) => {
            // 如果是在 preview 模式（侧边栏已打开），则导航到项目
            if (preview()) {
              navigateToProject(props.project.worktree)
              return
            }
            // 在 overlay 模式下，切换 hoverProject 状态来显示/隐藏对话列表
            event.preventDefault()
            globalSync.child(props.project.worktree)
            const currentProject = state.hoverProject === props.project.worktree ? undefined : props.project.worktree
            setState("hoverProject", currentProject)
            setState("hoverSession", undefined)
          }}
          onKeyDown={(event: KeyboardEvent) => {
            if (!overlay()) return
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              globalSync.child(props.project.worktree)
              const currentProject = state.hoverProject === props.project.worktree ? undefined : props.project.worktree
              setState("hoverProject", currentProject)
              setState("hoverSession", undefined)
            }
          }}
        >
          <ProjectIcon project={props.project} notify />
        </ContextMenu.Trigger>
        <ContextMenu.Portal mount={!props.mobile ? state.nav : undefined}>
          <ContextMenu.Content>
            <ContextMenu.Item onSelect={() => dialog.show(() => <DialogEditProject project={props.project} />)}>
              <ContextMenu.ItemLabel>{language.t("common.edit")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item
              data-action="project-workspaces-toggle"
              data-project={base64Encode(props.project.worktree)}
              disabled={props.project.vcs !== "git" && !layout.sidebar.workspaces(props.project.worktree)()}
              onSelect={() => {
                const enabled = layout.sidebar.workspaces(props.project.worktree)()
                if (enabled) {
                  layout.sidebar.toggleWorkspaces(props.project.worktree)
                  return
                }
                if (props.project.vcs !== "git") return
                layout.sidebar.toggleWorkspaces(props.project.worktree)
              }}
            >
              <ContextMenu.ItemLabel>
                {layout.sidebar.workspaces(props.project.worktree)()
                  ? language.t("sidebar.workspaces.disable")
                  : language.t("sidebar.workspaces.enable")}
              </ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item
              data-action="project-close-menu"
              data-project={base64Encode(props.project.worktree)}
              onSelect={() => closeProject(props.project.worktree)}
            >
              <ContextMenu.ItemLabel>{language.t("common.close")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    )

    return (
      // @ts-ignore
      <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
        <Show when={preview()} fallback={<Trigger />}>
          <HoverCard
            open={open() && !menu()}
            openDelay={999999}
            closeDelay={0}
            placement="right-start"
            gutter={6}
            trigger={trigger}
            onOpenChange={(value) => {
              if (menu()) return
              // 只允许关闭（value === false），不允许自动悬停打开
              if (!value) {
                setOpen(false)
              }
              if (value) setState("hoverSession", undefined)
            }}
          >
            <div class="-m-3 p-2 flex flex-col w-72">
              <div class="px-4 pt-2 pb-1 flex items-center gap-2">
                <div class="text-14-medium text-text-strong truncate grow">{displayName(props.project)}</div>
                <Tooltip value={language.t("common.close")} placement="top" gutter={6}>
                  <IconButton
                    icon="circle-x"
                    variant="ghost"
                    class="shrink-0"
                    data-action="project-close-hover"
                    data-project={base64Encode(props.project.worktree)}
                    aria-label={language.t("common.close")}
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpen(false)
                      closeProject(props.project.worktree)
                    }}
                  />
                </Tooltip>
              </div>
              <div class="px-4 pb-2 text-12-medium text-text-weak">{language.t("sidebar.project.recentSessions")}</div>
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
                          popover={false}
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
                            <SessionItem
                              session={session}
                              slug={base64Encode(directory)}
                              dense
                              mobile={props.mobile}
                              popover={false}
                            />
                          )}
                        </For>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
              <div class="px-2 py-2 border-t border-border-weak-base">
                <Button
                  variant="ghost"
                  class="flex w-full text-left justify-start text-text-base px-2 hover:bg-transparent active:bg-transparent"
                  onClick={() => {
                    layout.sidebar.open()
                    setOpen(false)
                    if (selected()) {
                      return
                    }
                    navigateToProject(props.project.worktree)
                  }}
                >
                  {language.t("sidebar.project.viewAllSessions")}
                </Button>
              </div>
            </div>
          </HoverCard>
        </Show>
      </div>
    )
  }

  const LocalWorkspace = (props: { project: LocalProject; mobile?: boolean }): JSX.Element => {
    const [workspaceStore, setWorkspaceStore] = globalSync.child(props.project.worktree)
    const slug = createMemo(() => base64Encode(props.project.worktree))
    const sessions = createMemo(() =>
      workspaceStore.session
        .filter((session) => session.directory === workspaceStore.path.directory)
        .filter((session) => !session.parentID && !session.time?.archived)
        .toSorted(sortSessions(Date.now())),
    )
    const children = createMemo(() => {
      const map = new Map<string, string[]>()
      for (const session of workspaceStore.session) {
        if (!session.parentID) continue
        const existing = map.get(session.parentID)
        if (existing) {
          existing.push(session.id)
          continue
        }
        map.set(session.parentID, [session.id])
      }
      return map
    })
    const booted = createMemo((prev) => prev || workspaceStore.status === "complete", false)
    const loading = createMemo(() => !booted() && sessions().length === 0)
    const hasMore = createMemo(() => workspaceStore.sessionTotal > sessions().length)
    const loadMore = async () => {
      setWorkspaceStore("limit", (limit) => limit + 5)
      await globalSync.project.loadSessions(props.project.worktree)
    }

    return (
      <div
        ref={(el) => {
          if (!props.mobile) scrollContainerRef = el
        }}
        class="size-full flex flex-col py-2 overflow-y-auto no-scrollbar [overflow-anchor:none]"
      >
        <nav class="flex flex-col gap-1 px-2">
          <Show when={loading()}>
            <SessionSkeleton />
          </Show>
          <For each={sessions()}>
            {(session) => <SessionItem session={session} slug={slug()} mobile={props.mobile} children={children()} />}
          </For>
          <Show when={hasMore()}>
            <div class="relative w-full py-1">
              <Button
                variant="ghost"
                class="flex w-full text-left justify-start text-14-regular text-text-weak pl-9 pr-10"
                size="large"
                onClick={(e: MouseEvent) => {
                  loadMore()
                  ;(e.currentTarget as HTMLButtonElement).blur()
                }}
              >
                {language.t("common.loadMore")}
              </Button>
            </div>
          </Show>
        </nav>
      </div>
    )
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

    setWorkspaceName(created.directory, created.branch ?? getFilename(created.directory), project.id, created.branch)

    const local = project.worktree
    const key = pathKey(created.directory)
    const root = pathKey(local)

    setBusy(created.directory, true)
    WorktreeState.pending(created.directory)
    setStore("workspaceExpanded", key, true)
    if (key !== created.directory) {
      setStore("workspaceExpanded", created.directory, true)
    }
    setStore("workspaceOrder", project.worktree, (prev) => {
      const existing = prev ?? []
      const next = existing.filter((item) => {
        const id = pathKey(item)
        return id !== root && id !== key
      })
      return [created.directory, ...next]
    })

    globalSync.child(created.directory)
    navigateWithSidebarReset(`/${base64Encode(created.directory)}/session`)
  }

  const workspaceSidebarCtx: WorkspaceSidebarContext = {
    currentDir: routeDir,
    navList: currentSessions,
    sidebarExpanded,
    sidebarReduced,
    nav: () => state.nav,
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
    workspaceExpanded: (directory, local) => store.workspaceExpanded[directory] ?? local,
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
    currentDir: routeDir,
    sidebarReduced,
    consumeProjectClick,
    navigateToProject,
    closeProject,
    showEditProjectDialog,
    toggleProjectWorkspaces,
    workspacesEnabled: (project) => project.vcs === "git" && layout.sidebar.workspaces(project.worktree)(),
    workspaceIds,
  }

  const SidebarPanel = (panelProps: {
    project: Accessor<LocalProject | undefined>
    mobile?: boolean
    merged?: boolean
  }) => {
    const project = panelProps.project
    const merged = createMemo(() => panelProps.mobile || (panelProps.merged ?? layout.sidebar.opened()))
    const empty = createMemo(() => !params.dir && layout.projects.list().length === 0)
    const projectName = createMemo(() => {
      const item = project()
      if (!item) return ""
      return item.name || getFilename(item.worktree)
    })
    const projectId = createMemo(() => project()?.id ?? "")
    const worktree = createMemo(() => project()?.worktree ?? "")
    const slug = createMemo(() => {
      const dir = worktree()
      if (!dir) return ""
      return base64Encode(dir)
    })
    const workspaces = createMemo(() => {
      const item = project()
      if (!item) return [] as string[]
      return workspaceIds(item)
    })
    const unseenCount = createMemo(() =>
      workspaces().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
    )
    const clearNotifications = () =>
      workspaces()
        .filter((directory) => notification.project.unseenCount(directory) > 0)
        .forEach((directory) => notification.project.markViewed(directory))
    const workspacesEnabled = createMemo(() => {
      const item = project()
      if (!item) return false
      if (item.vcs !== "git") return false
      return layout.sidebar.workspaces(item.worktree)()
    })
    const canToggle = createMemo(() => {
      const item = project()
      if (!item) return false
      return item.vcs === "git" || layout.sidebar.workspaces(item.worktree)()
    })
    const homedir = createMemo(() => globalSync.data.path.home)

    return (
      <div
        classList={{
          "flex flex-col min-h-0 min-w-0 box-border rounded-tl-[12px] px-3": true,
          "border border-b-0 border-border-weak-base": !merged(),
          "border-l border-t border-border-weaker-base": merged(),
          "bg-background-base": merged(),
          "bg-background-stronger": !merged(),
          "flex-1 min-w-0": panelProps.mobile,
          "max-w-full overflow-hidden": panelProps.mobile,
        }}
        style={{
          width: panelProps.mobile ? undefined : `${panel()}px`,
        }}
      >
        <Show
          when={project()}
          fallback={
            <Show when={empty()}>
              <div class="flex-1 min-h-0 -mt-4 flex items-center justify-center px-6 pb-64 text-center">
                <div class="mt-8 flex max-w-60 flex-col items-center gap-6 text-center">
                  <div class="flex flex-col gap-3">
                    <div class="text-14-medium text-text-strong">{language.t("sidebar.empty.title")}</div>
                    <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                      {language.t("sidebar.empty.description")}
                    </div>
                  </div>
                  <Button size="large" icon="folder-add-left" onClick={chooseProject}>
                    {language.t("command.project.open")}
                  </Button>
                </div>
              </div>
            </Show>
          }
          keyed
        >
          {(project) => (
            <>
              <div class="shrink-0 pl-1 py-1">
                <div class="group/project flex items-start justify-between gap-2 py-2 pl-2 pr-0">
                  <div class="flex flex-col min-w-0">
                    <InlineEditor
                      id={`project:${projectId()}`}
                      value={projectName}
                      onSave={(next) => {
                        void renameProject(project, next)
                      }}
                      class="text-14-medium text-text-strong truncate"
                      displayClass="text-14-medium text-text-strong truncate"
                      stopPropagation
                    />

                    <Tooltip
                      placement="bottom"
                      gutter={2}
                      value={worktree()}
                      class="shrink-0"
                      contentStyle={{
                        "max-width": "640px",
                        transform: "translate3d(52px, 0, 0)",
                      }}
                    >
                      <span class="text-12-regular text-text-base truncate select-text">
                        {worktree().replace(homedir(), "~")}
                      </span>
                    </Tooltip>
                  </div>

                  <DropdownMenu modal={!sidebarHovering()}>
                    <DropdownMenu.Trigger
                      as={IconButton}
                      icon="dot-grid"
                      variant="ghost"
                      data-action="project-menu"
                      data-project={slug()}
                      class="shrink-0 size-6 rounded-md transition-opacity data-[expanded]:bg-surface-base-active"
                      classList={{
                        "opacity-100": panelProps.mobile || merged(),
                        "opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100 data-[expanded]:opacity-100":
                          !panelProps.mobile && !merged(),
                      }}
                      aria-label={language.t("common.moreOptions")}
                    />
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content class="mt-1">
                        <DropdownMenu.Item
                          onSelect={() => {
                            showEditProjectDialog(project)
                          }}
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.edit")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          data-action="project-workspaces-toggle"
                          data-project={slug()}
                          disabled={!canToggle()}
                          onSelect={() => {
                            toggleProjectWorkspaces(project)
                          }}
                        >
                          <DropdownMenu.ItemLabel>
                            {workspacesEnabled()
                              ? language.t("sidebar.workspaces.disable")
                              : language.t("sidebar.workspaces.enable")}
                          </DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          data-action="project-clear-notifications"
                          data-project={slug()}
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
                          data-project={slug()}
                          onSelect={() => {
                            const dir = worktree()
                            if (!dir) return
                            closeProject(dir)
                          }}
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.close")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </div>

                <DropdownMenu modal>
                  <DropdownMenu.Trigger
                    as={IconButton}
                    icon="dot-grid"
                    variant="ghost"
                    data-action="project-menu"
                    data-project={slug()}
                    class="shrink-0 size-6 rounded-md transition-opacity data-[expanded]:bg-surface-base-active"
                    classList={{
                      "opacity-100": panelProps.mobile || merged(),
                      "opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100 data-[expanded]:opacity-100":
                        !panelProps.mobile && !merged(),
                    }}
                    aria-label={language.t("common.moreOptions")}
                  />
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content class="mt-1">
                      <DropdownMenu.Item
                        onSelect={() => {
                          const item = project()
                          if (!item) return
                          showEditProjectDialog(item)
                        }}
                      >
                        <DropdownMenu.ItemLabel>{language.t("common.edit")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        data-action="project-workspaces-toggle"
                        data-project={slug()}
                        disabled={!canToggle()}
                        onSelect={() => {
                          const item = project()
                          if (!item) return
                          toggleProjectWorkspaces(item)
                        }}
                      >
                        <DropdownMenu.ItemLabel>
                          {workspacesEnabled()
                            ? language.t("sidebar.workspaces.disable")
                            : language.t("sidebar.workspaces.enable")}
                        </DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        data-action="project-clear-notifications"
                        data-project={slug()}
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
                        data-project={slug()}
                        onSelect={() => {
                          const dir = worktree()
                          if (!dir) return
                          closeProject(dir)
                        }}
                      >
                        <DropdownMenu.ItemLabel>{language.t("common.close")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              </div>

              <div class="flex-1 min-h-0 flex flex-col">
                <Show
                  when={workspacesEnabled()}
                  fallback={
                    <>
                      <div class="shrink-0 py-4 px-3">
                        <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                          <Button
                            variant="ghost"
                            size="large"
                            icon="plus-small"
                            class="w-full rounded-lg border border-border-weak-base hover:bg-surface-base-hover active:bg-surface-base-active"
                            onClick={() => navigateWithSidebarReset(`/${base64Encode(p().worktree)}/session`)}
                          >
                            {language.t("command.session.new")}
                          </Button>
                          <IconButton
                            icon="archive"
                            variant="ghost"
                            size="large"
                            class="rounded-lg border border-border-weak-base"
                            aria-label={language.t("sidebar.project.viewArchivedSessions")}
                            onClick={() => dialog.show(() => <DialogArchivedSessions project={p()} />)}
                          />
                        </div>
                      </div>
                      <div class="flex-1 min-h-0">
                        <LocalWorkspace
                          ctx={workspaceSidebarCtx}
                          project={project}
                          sortNow={sortNow}
                          mobile={panelProps.mobile}
                        />
                      </div>
                    </>
                  }
                >
                  <>
                    <div class="shrink-0 py-4 px-3">
                      <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <Button
                          size="large"
                          icon="new-session"
                          variant="ghost"
                          class="w-full border border-border-weak-base"
                          onClick={() => {
                            const dir = worktree()
                            if (!dir) return
                            navigateWithSidebarReset(`/${base64Encode(dir)}/session`)
                          }}
                        >
                          {language.t("command.session.new")}
                        </Button>
                        <div class="flex items-center gap-2">
                          <Tooltip placement="bottom" value={language.t("sidebar.project.clearNotifications")}>
                            <IconButton
                              icon="bell-off"
                              variant="ghost"
                              size="large"
                              class="rounded-lg border border-border-weak-base"
                              disabled={unseenCount() === 0}
                              aria-label={language.t("sidebar.project.clearNotifications")}
                              onClick={clearNotifications}
                            />
                          </Tooltip>
                          <Tooltip placement="bottom" value={language.t("sidebar.project.viewArchivedSessions")}>
                            <IconButton
                              icon="archive"
                              variant="ghost"
                              size="large"
                              class="rounded-lg border border-border-weak-base"
                              aria-label={language.t("sidebar.project.viewArchivedSessions")}
                              onClick={() => {
                                const item = project()
                                if (!item) return
                                dialog.show(() => <DialogArchivedSessions project={item} />)
                              }}
                            />
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                    <div class="flex-1 min-h-0">
                      <LocalWorkspace
                        ctx={workspaceSidebarCtx}
                        project={project()!}
                        sortNow={sortNow}
                        mobile={panelProps.mobile}
                      />
                    </div>
                  </>
                }
              >
                <>
                  <div class="shrink-0 py-4 px-3">
                    <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <Button
                        size="large"
                        icon="plus-small"
                        class="w-full"
                        onClick={() => {
                          const item = project()
                          if (!item) return
                          createWorkspace(item)
                        }}
                      >
                        {language.t("workspace.new")}
                      </Button>
                      <div class="flex items-center gap-2">
                        <Tooltip placement="bottom" value={language.t("sidebar.project.clearNotifications")}>
                          <IconButton
                            icon="bell-off"
                            variant="ghost"
                            size="large"
                            class="rounded-lg border border-border-weak-base"
                            disabled={unseenCount() === 0}
                            aria-label={language.t("sidebar.project.clearNotifications")}
                            onClick={clearNotifications}
                          />
                        </Tooltip>
                        <Tooltip placement="bottom" value={language.t("sidebar.project.viewArchivedSessions")}>
                          <IconButton
                            icon="archive"
                            variant="ghost"
                            size="large"
                            class="rounded-lg border border-border-weak-base"
                            aria-label={language.t("sidebar.project.viewArchivedSessions")}
                            onClick={() => {
                              const item = project()
                              if (!item) return
                              dialog.show(() => <DialogArchivedSessions project={item} />)
                            }}
                          />
                        </Tooltip>
                      </div>
                    </div>
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
                                project={project()!}
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
        </Show>

        <div
          class="shrink-0 px-3 py-3"
          classList={{
            hidden: store.gettingStartedDismissed || !(providers.all().size > 0 && providers.paid().length === 0),
          }}
        >
          <div class="rounded-xl bg-background-base shadow-xs-border-base" data-component="getting-started">
            <div class="p-3 flex flex-col gap-6">
              <div class="flex flex-col gap-2">
                <div class="text-14-medium text-text-strong">{language.t("sidebar.gettingStarted.title")}</div>
                <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                  {language.t("sidebar.gettingStarted.line1")}
                </div>
                <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                  {language.t("sidebar.gettingStarted.line2")}
                </div>
              </div>
              <div data-component="getting-started-actions">
                <Button size="large" icon="plus-small" onClick={connectProvider}>
                  {language.t("command.provider.connect")}
                </Button>
                <Button size="large" variant="ghost" onClick={() => setStore("gettingStartedDismissed", true)}>
                  {language.t("toast.update.action.notYet")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Use the dedicated project rail source. This keeps the normal OpenCode
  // project rail decoupled from extra-agent entry rendering while still
  // preserving rail visibility when browsing extra-agent domains.
  const projects = () => layout.projects.rail()
  const projectOverlay = () => <ProjectDragOverlay projects={projects} activeProject={() => store.activeProject} />
  const sidebarContent = (mobile?: boolean) => (
    <SidebarContent
      mobile={mobile}
      opened={() => layout.sidebar.opened()}
      projects={projects}
      renderProject={(project) => <SortableProject ctx={projectSidebarCtx} project={project} mobile={mobile} />}
      handleDragStart={handleDragStart}
      handleDragOver={handleDragOver}
      handleDragEnd={handleDragEnd}
      openProjectLabel={language.t("command.project.open")}
      openProjectKeybind={() => command.keybind("project.open")}
      onOpenProject={chooseProject}
      renderProjectOverlay={projectOverlay}
      extraAgents={() =>
        enabledExtraAgents(server.list).map((agent) => ({
          id: agent.id,
          label: () => language.t(agent.labelKey),
          active: () => routeDir() === agent.directory,
          healthy: () => server.healthyFor(`extra-agent/${agent.id}`),
          icon: agent.icon,
          onOpen: () => openExtraAgent(agent.id),
        }))
      }
      configLabel={() => "Config"}
      onOpenConfig={openConfig}
      settingsLabel={() => language.t("sidebar.settings")}
      settingsKeybind={() => command.keybind("settings.open")}
      onOpenSettings={openSettings}
      helpLabel={() => language.t("sidebar.help")}
      onOpenHelp={() => platform.openLink("https://opencode.ai/desktop-feedback")}
      renderPanel={() =>
        mobile ? <SidebarPanel project={currentProject} mobile /> : <SidebarPanel project={currentProject} merged />
      }
    />
  )

  if (USE_NEW_DESIGN) {
    return (
      <div class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
        {autoselecting() ?? ""}
        <Titlebar update={titlebarUpdate} />
        <main
          class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict bg-v2-background-bg-base"
          classList={{
            "m-2 mt-0 rounded-[10px] shadow-[var(--v2-elevation-raised)] overflow-hidden": !!params.id || !params.dir,
          }}
        >
          <Show when={!autoselecting.loading} fallback={<div class="size-full" />}>
            {props.children}
          </Show>
        </main>
        {import.meta.env.DEV && <DebugBar />}
        <Toast.Region />
      </div>
    )
  }

  return (
    <div class="relative bg-background-base flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
      <Show when={folderDragging() || fileDragging()}>
        <div class="fixed inset-0 z-[100] flex items-center justify-center bg-background-base/80 pointer-events-none">
          <div class="flex flex-col items-center gap-3 text-text-weak">
            <Show when={folderDragging()} fallback={<Icon name="photo" class="size-12" />}>
              <Icon name="folder" class="size-12" />
            </Show>
            <span class="text-16-medium">
              {folderDragging() ? language.t("sidebar.dropFolder") : language.t("sidebar.dropFile")}
            </span>
          </div>
        </div>
      </Show>
      <Titlebar />
      <div class="flex-1 min-h-0 min-w-0 flex">
        <div class="flex-1 min-h-0 relative">
          <div class="size-full relative overflow-x-hidden">
            <nav
              aria-label={language.t("sidebar.nav.projectsAndSessions")}
              data-component="sidebar-nav-desktop"
              classList={{
                "hidden xl:block": true,
                "absolute inset-y-0 left-0": true,
                "z-10": true,
                "pointer-events-none": state.sizing,
              }}
              style={{ width: `${side()}px` }}
              ref={(el) => {
                setState("nav", el)
              }}
            >
              <div class="@container w-full h-full">{sidebarContent()}</div>
              <Show when={layout.sidebar.opened()}>
                <div onPointerDown={() => setState("sizing", true)}>
                  <ResizeHandle
                    direction="horizontal"
                    size={layout.sidebar.width()}
                    min={244}
                    max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.3 + 64}
                    collapseThreshold={244}
                    onResize={(w) => {
                      setState("sizing", true)
                      if (sizet !== undefined) clearTimeout(sizet)
                      sizet = window.setTimeout(() => setState("sizing", false), 120)
                      layout.sidebar.resize(w)
                    }}
                    onCollapse={layout.sidebar.close}
                  />
                </div>
              </Show>
            </nav>

            <Show when={layout.sidebar.opened()}>
              <div
                class="hidden xl:block absolute inset-y-0 z-30 w-0 overflow-visible"
                style={{ left: `${dragSide()}px` }}
                onPointerDown={() => {
                  setState("sizing", true)
                  setState("previewSidebarWidth", layout.sidebar.width())
                }}
              >
                <ResizeHandle
                  direction="horizontal"
                  size={state.previewSidebarWidth ?? layout.sidebar.width()}
                  min={244}
                  max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.3 + 64}
                  onResize={(w) => {
                    setState("sizing", true)
                    if (sizet !== undefined) clearTimeout(sizet)
                    sizet = window.setTimeout(() => setState("sizing", false), 120)
                    setState("previewSidebarWidth", w)
                  }}
                  onResizeEnd={(w) => {
                    setState("previewSidebarWidth", undefined)
                    layout.sidebar.resize(w)
                  }}
                />
              </div>
            </div>

            <Show when={findbar.open && platform.find}>
              <div class="pointer-events-none absolute top-3 right-3 z-30 w-[min(480px,calc(100%-24px))]">
                <div class="pointer-events-auto flex flex-row items-center gap-2 rounded-2xl border border-border-weak-base bg-background-stronger/92 px-2 py-2 shadow-lg backdrop-blur-xl">
                  <div class="flex flex-1 min-w-0 flex-row items-center gap-2 rounded-xl bg-surface-panel px-3 ring-1 ring-border-weaker-base/70">
                    <Icon name="magnifying-glass" size="small" class="shrink-0 text-text-weaker" />
                    <InlineInput
                      ref={findInput}
                      value={findbar.q}
                      autofocus
                      placeholder={language.t("common.search.placeholder")}
                      style={{ "--inline-input-shadow": "none" }}
                      class="h-10 flex-1 min-w-0 bg-transparent text-14-regular text-text-strong placeholder:text-text-weaker"
                      onInput={(event) => setFindbar("q", event.currentTarget.value)}
                      onKeyDown={findbarKeyDown}
                    />
                  </div>
                  <div class="flex flex-row items-center gap-1 rounded-xl bg-surface-panel px-1.5 py-1 ring-1 ring-border-weaker-base/70">
                    <IconButton
                      icon="arrow-left"
                      variant="ghost"
                      size="large"
                      class="rounded-lg text-text-weak hover:text-text-strong"
                      aria-label={language.t("command.page.find.previous")}
                      onClick={() => runFindbar(-1)}
                    />
                    <IconButton
                      icon="arrow-right"
                      variant="ghost"
                      size="large"
                      class="rounded-lg text-text-weak hover:text-text-strong"
                      aria-label={language.t("command.page.find.next")}
                      onClick={() => runFindbar(1)}
                    />
                    <div class="mx-0.5 h-5 w-px bg-border-weaker-base" />
                    <IconButton
                      icon="close"
                      variant="ghost"
                      size="large"
                      class="rounded-lg text-text-weak hover:text-text-strong"
                      aria-label={language.t("common.close")}
                      onClick={closeFindbar}
                    />
                  </div>
                </div>
              </div>
            </Show>

            <div
              classList={{
                "absolute inset-0": true,
                "xl:inset-y-0 xl:right-0 xl:left-[var(--main-left)]": true,
                "z-20": true,
                "transition-[left] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[left] motion-reduce:transition-none":
                  !state.sizing,
              }}
              style={{
                "--main-left": layout.sidebar.opened() ? `${Math.max(layout.sidebar.width(), 244)}px` : "4rem",
              }}
            >
              <main
                classList={{
                  "size-full overflow-x-hidden flex flex-col items-start contain-strict border-t border-border-weak-base bg-background-base xl:border-l xl:rounded-tl-[12px]": true,
                }}
              >
                <Show when={!autoselecting()} fallback={<div class="size-full" />}>
                  {props.children}
                </Show>
              </main>
            </div>
          </div>
        </div>
        {import.meta.env.DEV && platform.platform !== "desktop" && <DebugBar />}
      </div>
      <QuickAssistant />
      <Toast.Region />
    </div>
  )
}

function UpdateAvailableToast(props: {
  version: string
  install: () => void
  language: ReturnType<typeof useLanguage>
}) {
  let toastId: number | undefined

  onMount(() => {
    toastId = showToast({
      persistent: true,
      icon: "download",
      title: props.language.t("toast.update.title"),
      description: props.language.t("toast.update.description", { version: props.version }),
      actions: [
        {
          label: props.language.t("toast.update.action.installRestart"),
          onClick: props.install,
        },
        {
          label: props.language.t("toast.update.action.notYet"),
          onClick: "dismiss",
        },
      ],
    })
  })

  onCleanup(() => {
    if (toastId === undefined) return
    toaster.dismiss(toastId)
  })

  return null
}

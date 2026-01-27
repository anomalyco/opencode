import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  ParentProps,
  Show,
  Switch,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js"
import { A, useNavigate, useParams } from "@solidjs/router"
import { useLayout, getAvatarColors, LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { Persist, persisted } from "@/utils/persist"
import { base64Encode } from "@opencode-ai/util/encode"
import { decode64 } from "@/utils/base64"
import { Avatar } from "@opencode-ai/ui/avatar"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { HoverCard } from "@opencode-ai/ui/hover-card"
import { MessageNav } from "@opencode-ai/ui/message-nav"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Dialog } from "@opencode-ai/ui/dialog"
import { getFilename } from "@opencode-ai/util/path"
import { Session, type Message, type TextPart } from "@opencode-ai/sdk/v2/client"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
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
import { playSound, soundSrc } from "@/utils/sound"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { agentColor } from "@/utils/agent"

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { DialogSettings } from "@/components/dialog-settings"
import { useCommand, type CommandOption } from "@/context/command"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { navStart } from "@/utils/perf"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogEditProject } from "@/components/dialog-edit-project"
import { Titlebar } from "@/components/titlebar"
import { useServer } from "@/context/server"
import { useLanguage, type Locale } from "@/context/language"

export default function Layout(props: ParentProps) {
  const [store, setStore, , ready] = persisted(
    Persist.global("layout.page", ["layout.page.v1"]),
    createStore({
      lastSession: {} as { [directory: string]: string },
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
  const initialDir = params.dir
  const availableThemeEntries = createMemo(() => Object.entries(theme.themes()))
  const colorSchemeOrder: ColorScheme[] = ["system", "light", "dark"]
  const colorSchemeKey: Record<ColorScheme, "theme.scheme.system" | "theme.scheme.light" | "theme.scheme.dark"> = {
    system: "theme.scheme.system",
    light: "theme.scheme.light",
    dark: "theme.scheme.dark",
  }
  const colorSchemeLabel = (scheme: ColorScheme) => language.t(colorSchemeKey[scheme])

  const [state, setState] = createStore({
    autoselect: !params.dir,
    busyWorkspaces: new Set<string>(),
    hoverSession: undefined as string | undefined,
    hoverProject: undefined as string | undefined,
    scrollSessionKey: undefined as string | undefined,
    nav: undefined as HTMLElement | undefined,
  })

  const [editor, setEditor] = createStore({
    active: "" as string,
    value: "",
  })
  const setBusy = (directory: string, value: boolean) => {
    const key = workspaceKey(directory)
    setState("busyWorkspaces", (prev) => {
      const next = new Set(prev)
      if (value) next.add(key)
      else next.delete(key)
      return next
    })
  }
  const isBusy = (directory: string) => state.busyWorkspaces.has(workspaceKey(directory))
  const editorRef = { current: undefined as HTMLInputElement | undefined }

  const navLeave = { current: undefined as number | undefined }

  onCleanup(() => {
    if (navLeave.current === undefined) return
    clearTimeout(navLeave.current)
  })

  const sidebarHovering = createMemo(() => !layout.sidebar.opened() && state.hoverProject !== undefined)
  const sidebarExpanded = createMemo(() => layout.sidebar.opened() || sidebarHovering())

  const hoverProjectData = createMemo(() => {
    const id = state.hoverProject
    if (!id) return
    return layout.projects.list().find((project) => project.worktree === id)
  })

  createEffect(() => {
    if (!layout.sidebar.opened()) return
    setState("hoverProject", undefined)
  })

  createEffect(
    on(
      () => ({ dir: params.dir, id: params.id }),
      () => {
        if (layout.sidebar.opened()) return
        if (!state.hoverProject) return
        setState("hoverSession", undefined)
        setState("hoverProject", undefined)
      },
      { defer: true },
    ),
  )

  const autoselecting = createMemo(() => {
    if (params.dir) return false
    if (initialDir) return false
    if (!state.autoselect) return false
    if (!pageReady()) return true
    if (!layoutReady()) return true
    const list = layout.projects.list()
    if (list.length === 0) return false
    return true
  })

  const editorOpen = (id: string) => editor.active === id
  const editorValue = () => editor.value

  const openEditor = (id: string, value: string) => {
    if (!id) return
    setEditor({ active: id, value })
  }

  const closeEditor = () => setEditor({ active: "", value: "" })

  const saveEditor = (callback: (next: string) => void) => {
    const next = editor.value.trim()
    if (!next) {
      closeEditor()
      return
    }
    closeEditor()
    callback(next)
  }

  const editorKeyDown = (event: KeyboardEvent, callback: (next: string) => void) => {
    if (event.key === "Enter") {
      event.preventDefault()
      saveEditor(callback)
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      closeEditor()
    }
  }

  const InlineEditor = (props: {
    id: string
    value: Accessor<string>
    onSave: (next: string) => void
    class?: string
    displayClass?: string
    editing?: boolean
    stopPropagation?: boolean
    openOnDblClick?: boolean
  }) => {
    const isEditing = () => props.editing ?? editorOpen(props.id)
    const stopEvents = () => props.stopPropagation ?? false
    const allowDblClick = () => props.openOnDblClick ?? true
    const stopPropagation = (event: Event) => {
      if (!stopEvents()) return
      event.stopPropagation()
    }
    const handleDblClick = (event: MouseEvent) => {
      if (!allowDblClick()) return
      stopPropagation(event)
      openEditor(props.id, props.value())
    }

    return (
      <Show
        when={isEditing()}
        fallback={
          <span
            class={props.displayClass ?? props.class}
            onDblClick={handleDblClick}
            onPointerDown={stopPropagation}
            onMouseDown={stopPropagation}
            onClick={stopPropagation}
            onTouchStart={stopPropagation}
          >
            {props.value()}
          </span>
        }
      >
        <InlineInput
          ref={(el) => {
            editorRef.current = el
            requestAnimationFrame(() => el.focus())
          }}
          value={editorValue()}
          class={props.class}
          onInput={(event) => setEditor("value", event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            editorKeyDown(event, props.onSave)
          }}
          onBlur={() => closeEditor()}
          onPointerDown={stopPropagation}
          onClick={stopPropagation}
          onDblClick={stopPropagation}
          onMouseDown={stopPropagation}
          onMouseUp={stopPropagation}
          onTouchStart={stopPropagation}
        />
      </Show>
    )
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

  onMount(() => {
    if (!platform.checkUpdate || !platform.update || !platform.restart) return

    let toastId: number | undefined
    let interval: ReturnType<typeof setInterval> | undefined

    async function pollUpdate() {
      const { updateAvailable, version } = await platform.checkUpdate!()
      if (updateAvailable && toastId === undefined) {
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
      }
    }

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

  onMount(() => {
    const toastBySession = new Map<string, number>()
    const alertedAtBySession = new Map<string, number>()
    const cooldownMs = 5000

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
        playSound(soundSrc(settings.sounds.permissions()))
        if (settings.notifications.permissions()) {
          void platform.notify(title, description, href)
        }
      }

      if (e.details.type === "question.asked") {
        if (settings.notifications.agent()) {
          void platform.notify(title, description, href)
        }
      }

      const currentDir = decode64(params.dir)
      const currentSession = params.id
      if (directory === currentDir && props.sessionID === currentSession) return
      if (directory === currentDir && session?.parentID === currentSession) return

      const existingToastId = toastBySession.get(sessionKey)
      if (existingToastId !== undefined) toaster.dismiss(existingToastId)

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
      const currentDir = decode64(params.dir)
      const currentSession = params.id
      if (!currentDir || !currentSession) return
      const sessionKey = `${currentDir}:${currentSession}`
      const toastId = toastBySession.get(sessionKey)
      if (toastId !== undefined) {
        toaster.dismiss(toastId)
        toastBySession.delete(sessionKey)
        alertedAtBySession.delete(sessionKey)
      }
      const [store] = globalSync.child(currentDir, { bootstrap: false })
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

  function sortSessions(now: number) {
    const oneMinuteAgo = now - 60 * 1000
    return (a: Session, b: Session) => {
      const aUpdated = a.time.updated ?? a.time.created
      const bUpdated = b.time.updated ?? b.time.created
      const aRecent = aUpdated > oneMinuteAgo
      const bRecent = bUpdated > oneMinuteAgo
      if (aRecent && bRecent) return a.id.localeCompare(b.id)
      if (aRecent && !bRecent) return -1
      if (!aRecent && bRecent) return 1
      return bUpdated - aUpdated
    }
  }

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
    const directory = decode64(params.dir)
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
        if (initialDir) return
        if (value.dir) return
        if (value.list.length === 0) return

        const last = server.projects.last()
        const next = value.list.find((project) => project.worktree === last) ?? value.list[0]
        if (!next) return
        setState("autoselect", false)
        openProject(next.worktree, false)
        navigateToProject(next.worktree)
      },
    ),
  )

  const workspaceKey = (directory: string) => directory.replace(/[\\/]+$/, "")

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
    setStore("workspaceName", (prev) => ({ ...(prev ?? {}), [key]: next }))
    if (!projectId) return
    if (!branch) return
    setStore("workspaceBranchName", projectId, (prev) => ({ ...(prev ?? {}), [branch]: next }))
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
    if (!existing) {
      setStore("workspaceOrder", project.worktree, dirs)
      return
    }

    const keep = existing.filter((d) => d !== local && dirs.includes(d))
    const missing = dirs.filter((d) => d !== local && !existing.includes(d))
    const merged = [local, ...missing, ...keep]

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
    const compare = sortSessions(Date.now())
    if (workspaceSetting()) {
      const dirs = workspaceIds(project)
      const activeDir = decode64(params.dir) ?? ""
      const result: Session[] = []
      for (const dir of dirs) {
        const expanded = store.workspaceExpanded[dir] ?? dir === project.worktree
        const active = dir === activeDir
        if (!expanded && !active) continue
        const [dirStore] = globalSync.child(dir, { bootstrap: true })
        const dirSessions = dirStore.session
          .filter((session) => session.directory === dirStore.path.directory)
          .filter((session) => !session.parentID && !session.time?.archived)
          .toSorted(compare)
        result.push(...dirSessions)
      }
      return result
    }
    const [projectStore] = globalSync.child(project.worktree)
    return projectStore.session
      .filter((session) => session.directory === projectStore.path.directory)
      .filter((session) => !session.parentID && !session.time?.archived)
      .toSorted(compare)
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

  async function prefetchMessages(directory: string, sessionID: string, token: number) {
    const [, setStore] = globalSync.child(directory, { bootstrap: false })

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

    if (import.meta.env.DEV) {
      navStart({
        dir: base64Encode(session.directory),
        from: params.id,
        to: session.id,
        trigger: offset > 0 ? "alt+arrowdown" : "alt+arrowup",
      })
    }
    navigateToSession(session)
    queueMicrotask(() => scrollToSession(session.id, `${session.directory}:${session.id}`))
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

  async function deleteSession(session: Session) {
    const [store, setStore] = globalSync.child(session.directory)
    const sessions = (store.session ?? []).filter((s) => !s.parentID && !s.time?.archived)
    const index = sessions.findIndex((s) => s.id === session.id)
    const nextSession = sessions[index + 1] ?? sessions[index - 1]

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

    if (!result) return

    setStore(
      produce((draft) => {
        const removed = new Set<string>([session.id])

        const byParent = new Map<string, string[]>()
        for (const item of draft.session) {
          const parentID = item.parentID
          if (!parentID) continue
          const existing = byParent.get(parentID)
          if (existing) {
            existing.push(item.id)
            continue
          }
          byParent.set(parentID, [item.id])
        }

        const stack = [session.id]
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

        draft.session = draft.session.filter((s) => !removed.has(s.id))
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

  function navigateToProject(directory: string | undefined) {
    if (!directory) return
    if (!layout.sidebar.opened()) {
      setState("hoverSession", undefined)
      setState("hoverProject", undefined)
    }
    server.projects.touch(directory)
    const lastSession = store.lastSession[directory]
    navigate(`/${base64Encode(directory)}${lastSession ? `/session/${lastSession}` : ""}`)
    layout.mobileSidebar.hide()
  }

  function navigateToSession(session: Session | undefined) {
    if (!session) return
    if (!layout.sidebar.opened()) {
      setState("hoverSession", undefined)
      setState("hoverProject", undefined)
    }
    navigate(`/${base64Encode(session.directory)}/session/${session.id}`)
    layout.mobileSidebar.hide()
  }

  function openProject(directory: string, navigate = true) {
    layout.projects.open(directory)
    if (navigate) navigateToProject(directory)
  }

  const displayName = (project: LocalProject) => project.name || getFilename(project.worktree)

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

  async function renameSession(session: Session, next: string) {
    if (next === session.title) return
    await globalSDK.client.session.update({
      directory: session.directory,
      sessionID: session.id,
      title: next,
    })
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

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
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
          description: errorMessage(err),
        })
        return false
      })

    setBusy(directory, false)

    if (!result) return

    layout.projects.close(directory)
    layout.projects.open(root)

    if (params.dir && decode64(params.dir) === directory) {
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

    const sessions = await globalSDK.client.session
      .list({ directory })
      .then((x) => x.data ?? [])
      .catch(() => [])

    const result = await globalSDK.client.worktree
      .reset({ directory: root, worktreeResetInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.reset.failed.title"),
          description: errorMessage(err),
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

    await globalSDK.client.instance.dispose({ directory }).catch(() => undefined)

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

  function DialogDeleteSession(props: { session: Session }) {
    const handleDelete = async () => {
      await deleteSession(props.session)
      dialog.close()
    }

    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: props.session.title })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={handleDelete}>
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
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
        setStore("lastSession", directory, id)
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

  createEffect(() => {
    const project = currentProject()
    if (!project) return

    if (workspaceSetting()) {
      const activeDir = decode64(params.dir) ?? ""
      const dirs = [project.worktree, ...(project.sandboxes ?? [])]
      for (const directory of dirs) {
        const expanded = store.workspaceExpanded[directory] ?? directory === project.worktree
        const active = directory === activeDir
        if (!expanded && !active) continue
        globalSync.project.loadSessions(directory)
      }
      return
    }

    globalSync.project.loadSessions(project.worktree)
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
    setState("hoverProject", undefined)
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
    const directory = active?.worktree === project.worktree ? decode64(params.dir) : undefined
    const extra = directory && directory !== local && !dirs.includes(directory) ? directory : undefined
    const pending = extra ? WorktreeState.get(extra)?.status === "pending" : false

    const existing = store.workspaceOrder[project.worktree]
    if (!existing) return extra ? [...dirs, extra] : dirs

    const keep = existing.filter((d) => d !== local && dirs.includes(d))
    const missing = dirs.filter((d) => d !== local && !existing.includes(d))
    const merged = [local, ...(pending && extra ? [extra] : []), ...missing, ...keep]
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
               hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[[data-expanded]]:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active"
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
          <DropdownMenu modal={!sidebarHovering()} open={menu.open} onOpenChange={(open) => setMenu("open", open)}>
            <Tooltip value={language.t("common.moreOptions")} placement="top">
              <DropdownMenu.Trigger
                as={IconButton}
                icon="dot-grid"
                variant="ghost"
                class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                aria-label={language.t("common.moreOptions")}
              />
            </Tooltip>
            <DropdownMenu.Portal mount={!props.mobile ? state.nav : undefined}>
              <DropdownMenu.Content
                onCloseAutoFocus={(event) => {
                  if (!menu.pendingRename) return
                  event.preventDefault()
                  setMenu("pendingRename", false)
                  openEditor(`session:${props.session.id}`, props.session.title)
                }}
              >
                <DropdownMenu.Item
                  onSelect={() => {
                    setMenu("pendingRename", true)
                    setMenu("open", false)
                  }}
                >
                  <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => archiveSession(props.session)}>
                  <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => dialog.show(() => <DialogDeleteSession session={props.session} />)}>
                  <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
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
      <div class="group/session relative w-full rounded-md cursor-default transition-colors pl-2 pr-3 hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active">
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
          setState("hoverProject", props.project.worktree)
          setState("hoverSession", undefined)
        }}
        onFocus={() => {
          if (!overlay()) return
          globalSync.child(props.project.worktree)
          setState("hoverProject", props.project.worktree)
          setState("hoverSession", undefined)
        }}
        onClick={() => navigateToProject(props.project.worktree)}
        onBlur={() => setOpen(false)}
      >
        <ProjectIcon project={props.project} notify />
      </button>
    )

    return (
      // @ts-ignore
      <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
        <Show when={preview()} fallback={trigger}>
          <HoverCard
            open={open()}
            openDelay={0}
            closeDelay={0}
            placement="right-start"
            gutter={6}
            trigger={trigger}
            onOpenChange={(value) => {
              setOpen(value)
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
    if (!layout.sidebar.opened()) {
      setState("hoverSession", undefined)
      setState("hoverProject", undefined)
    }
    const created = await globalSDK.client.worktree
      .create({ directory: project.worktree })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.create.failed.title"),
          description: errorMessage(err),
        })
        return undefined
      })

    if (!created?.directory) return

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
    navigate(`/${base64Encode(created.directory)}/session`)
    layout.mobileSidebar.hide()
  }

  const SidebarPanel = (panelProps: { project: LocalProject | undefined; mobile?: boolean }) => {
    const projectName = createMemo(() => {
      const project = panelProps.project
      if (!project) return ""
      return project.name || getFilename(project.worktree)
    })
    const projectId = createMemo(() => panelProps.project?.id ?? "")
    const workspaces = createMemo(() => workspaceIds(panelProps.project))
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
          "flex flex-col min-h-0 bg-background-stronger border border-b-0 border-border-weak-base rounded-tl-sm": true,
          "flex-1 min-w-0": panelProps.mobile,
        }}
        style={{ width: panelProps.mobile ? undefined : `${Math.max(layout.sidebar.width() - 64, 0)}px` }}
      >
        <Show when={panelProps.project} keyed>
          {(p) => (
            <>
              <div class="shrink-0 px-2 py-1">
                <div class="group/project flex items-start justify-between gap-2 p-2 pr-1">
                  <div class="flex flex-col min-w-0">
                    <InlineEditor
                      id={`project:${projectId()}`}
                      value={projectName}
                      onSave={(next) => renameProject(p, next)}
                      class="text-16-medium text-text-strong truncate"
                      displayClass="text-16-medium text-text-strong truncate"
                      stopPropagation
                    />

                    <Tooltip
                      placement="bottom"
                      gutter={2}
                      value={p.worktree}
                      class="shrink-0"
                      contentStyle={{
                        "max-width": "640px",
                        transform: "translate3d(52px, 0, 0)",
                      }}
                    >
                      <span class="text-12-regular text-text-base truncate select-text">
                        {p.worktree.replace(homedir(), "~")}
                      </span>
                    </Tooltip>
                  </div>

                  <DropdownMenu modal={!sidebarHovering()}>
                    <DropdownMenu.Trigger
                      as={IconButton}
                      icon="dot-grid"
                      variant="ghost"
                      class="shrink-0 size-6 rounded-md opacity-0 group-hover/project:opacity-100 data-[expanded]:opacity-100 data-[expanded]:bg-surface-base-active"
                      aria-label={language.t("common.moreOptions")}
                    />
                    <DropdownMenu.Portal mount={!panelProps.mobile ? state.nav : undefined}>
                      <DropdownMenu.Content class="mt-1">
                        <DropdownMenu.Item onSelect={() => dialog.show(() => <DialogEditProject project={p} />)}>
                          <DropdownMenu.ItemLabel>{language.t("common.edit")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          disabled={p.vcs !== "git" && !layout.sidebar.workspaces(p.worktree)()}
                          onSelect={() => {
                            const enabled = layout.sidebar.workspaces(p.worktree)()
                            if (enabled) {
                              layout.sidebar.toggleWorkspaces(p.worktree)
                              return
                            }
                            if (p.vcs !== "git") return
                            layout.sidebar.toggleWorkspaces(p.worktree)
                          }}
                        >
                          <DropdownMenu.ItemLabel>
                            {layout.sidebar.workspaces(p.worktree)()
                              ? language.t("sidebar.workspaces.disable")
                              : language.t("sidebar.workspaces.enable")}
                          </DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item onSelect={() => closeProject(p.worktree)}>
                          <DropdownMenu.ItemLabel>{language.t("common.close")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </div>
              </div>

              <Show
                when={workspacesEnabled()}
                fallback={
                  <>
                    <div class="py-4 px-3">
                      <TooltipKeybind
                        title={language.t("command.session.new")}
                        keybind={command.keybind("session.new")}
                        placement="top"
                      >
                        <Button
                          size="large"
                          icon="plus-small"
                          class="w-full"
                          onClick={() => {
                            if (!layout.sidebar.opened()) {
                              setState("hoverSession", undefined)
                              setState("hoverProject", undefined)
                            }
                            navigate(`/${base64Encode(p.worktree)}/session`)
                            layout.mobileSidebar.hide()
                          }}
                        >
                          {language.t("command.session.new")}
                        </Button>
                      </TooltipKeybind>
                    </div>
                    <div class="flex-1 min-h-0">
                      <LocalWorkspace project={p} mobile={panelProps.mobile} />
                    </div>
                  </>
                }
              >
                <>
                  <div class="py-4 px-3">
                    <TooltipKeybind
                      title={language.t("workspace.new")}
                      keybind={command.keybind("workspace.new")}
                      placement="top"
                    >
                      <Button size="large" icon="plus-small" class="w-full" onClick={() => createWorkspace(p)}>
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
                              <SortableWorkspace directory={directory} project={p} mobile={panelProps.mobile} />
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
        </Show>
      </div>
    )
  }

  const SidebarContent = (sidebarProps: { mobile?: boolean }) => {
    const expanded = () => sidebarProps.mobile || layout.sidebar.opened()

    command.register(() => [
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
    ])

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
                      <span>{language.t("command.project.open")}</span>
                      <Show when={!sidebarProps.mobile}>
                        <span class="text-icon-base text-12-medium">{command.keybind("project.open")}</span>
                      </Show>
                    </div>
                  }
                >
                  <IconButton
                    icon="plus"
                    variant="ghost"
                    size="large"
                    onClick={chooseProject}
                    aria-label={language.t("command.project.open")}
                  />
                </Tooltip>
              </div>
              <DragOverlay>
                <ProjectDragOverlay />
              </DragOverlay>
            </DragDropProvider>
          </div>
          <div class="shrink-0 w-full pt-3 pb-3 flex flex-col items-center gap-2">
            <TooltipKeybind
              placement={sidebarProps.mobile ? "bottom" : "right"}
              title={language.t("sidebar.settings")}
              keybind={command.keybind("settings.open")}
            >
              <IconButton
                icon="settings-gear"
                variant="ghost"
                size="large"
                onClick={openSettings}
                aria-label={language.t("sidebar.settings")}
              />
            </TooltipKeybind>
            <Tooltip placement={sidebarProps.mobile ? "bottom" : "right"} value={language.t("sidebar.help")}>
              <IconButton
                icon="help"
                variant="ghost"
                size="large"
                onClick={() => platform.openLink("https://opencode.ai/desktop-feedback")}
                aria-label={language.t("sidebar.help")}
              />
            </Tooltip>
          </div>
        </div>

        <Show when={expanded()}>
          <SidebarPanel project={currentProject()} mobile={sidebarProps.mobile} />
        </Show>
      </div>
    )
  }

  return (
    <div class="relative bg-background-base flex-1 min-h-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
      <Titlebar />
      <div class="flex-1 min-h-0 flex">
        <nav
          aria-label={language.t("sidebar.nav.projectsAndSessions")}
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
            if (!sidebarHovering()) return

            if (navLeave.current !== undefined) clearTimeout(navLeave.current)
            navLeave.current = window.setTimeout(() => {
              navLeave.current = undefined
              setState("hoverProject", undefined)
              setState("hoverSession", undefined)
            }, 300)
          }}
        >
          <div class="@container w-full h-full contain-strict">
            <SidebarContent />
          </div>
          <Show when={!layout.sidebar.opened() ? hoverProjectData() : undefined} keyed>
            {(project) => (
              <div class="absolute inset-y-0 left-16 z-50 flex">
                <SidebarPanel project={project} />
              </div>
            )}
          </Show>
          <Show when={layout.sidebar.opened()}>
            <ResizeHandle
              direction="horizontal"
              size={layout.sidebar.width()}
              min={244}
              max={window.innerWidth * 0.3 + 64}
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
            classList={{
              "@container fixed top-10 bottom-0 left-0 z-50 w-72 bg-background-base transition-transform duration-200 ease-out": true,
              "translate-x-0": layout.mobileSidebar.opened(),
              "-translate-x-full": !layout.mobileSidebar.opened(),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent mobile />
          </nav>
        </div>

        <main
          classList={{
            "size-full overflow-x-hidden flex flex-col items-start contain-strict border-t border-border-weak-base": true,
            "xl:border-l xl:rounded-tl-sm": !layout.sidebar.opened(),
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

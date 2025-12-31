import {
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
import { DateTime } from "luxon"
import { A, useNavigate, useParams } from "@solidjs/router"
import { useLayout, getAvatarColors, LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { base64Decode, base64Encode } from "@opencode-ai/util/encode"
import { Avatar } from "@opencode-ai/ui/avatar"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { Spinner } from "@opencode-ai/ui/spinner"
import { getFilename } from "@opencode-ai/util/path"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Session } from "@opencode-ai/sdk/v2/client"
import { usePlatform } from "@/context/platform"
import { createStore, produce } from "solid-js/store"
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
import { Binary } from "@opencode-ai/util/binary"
import { Header } from "@/components/header"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { DialogEditProject } from "@/components/dialog-edit-project"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useCommand, type CommandOption } from "@/context/command"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { useServer } from "@/context/server"

export default function Layout(props: ParentProps) {
  const [store, setStore] = createStore({
    lastSession: {} as { [directory: string]: string },
    activeDraggable: undefined as string | undefined,
    mobileSidebarOpen: false,
    mobileProjectsExpanded: {} as Record<string, boolean>,
  })

  const mobileSidebar = {
    open: () => store.mobileSidebarOpen,
    show: () => setStore("mobileSidebarOpen", true),
    hide: () => setStore("mobileSidebarOpen", false),
    toggle: () => setStore("mobileSidebarOpen", (x) => !x),
  }

  const mobileProjects = {
    expanded: (directory: string) => store.mobileProjectsExpanded[directory] ?? true,
    expand: (directory: string) => setStore("mobileProjectsExpanded", directory, true),
    collapse: (directory: string) => setStore("mobileProjectsExpanded", directory, false),
  }

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
  const platform = usePlatform()
  const server = useServer()
  const notification = useNotification()
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

  onMount(async () => {
    if (platform.checkUpdate && platform.update && platform.restart) {
      const { updateAvailable, version } = await platform.checkUpdate()
      if (updateAvailable) {
        showToast({
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
  })

  onMount(() => {
    const seenSessions = new Set<string>()
    const toastBySession = new Map<string, number>()
    const unsub = globalSDK.event.listen((e) => {
      if (e.details?.type !== "permission.updated") return
      const directory = e.name
      const permission = e.details.properties
      const currentDir = params.dir ? base64Decode(params.dir) : undefined
      const currentSession = params.id
      const [store] = globalSync.child(directory)
      const session = store.session.find((s) => s.id === permission.sessionID)
      const sessionTitle = session?.title ?? "New session"
      const projectName = getFilename(directory)
      const description = `${sessionTitle} in ${projectName} needs permission`
      const href = `/${base64Encode(directory)}/session/${permission.sessionID}`
      void platform.notify("Permission required", description, href)

      if (directory === currentDir && permission.sessionID === currentSession) return
      if (directory === currentDir && session?.parentID === currentSession) return

      const sessionKey = `${directory}:${permission.sessionID}`
      if (seenSessions.has(sessionKey)) return
      seenSessions.add(sessionKey)

      const toastId = showToast({
        persistent: true,
        icon: "checklist",
        title: "Permission required",
        description,
        actions: [
          {
            label: "Go to session",
            onClick: () => {
              navigate(href)
            },
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
        seenSessions.delete(sessionKey)
      }
      const [store] = globalSync.child(currentDir)
      const childSessions = store.session.filter((s) => s.parentID === currentSession)
      for (const child of childSessions) {
        const childKey = `${currentDir}:${child.id}`
        const childToastId = toastBySession.get(childKey)
        if (childToastId !== undefined) {
          toaster.dismiss(childToastId)
          toastBySession.delete(childKey)
          seenSessions.delete(childKey)
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

  function projectSessions(directory: string) {
    if (!directory) return []
    const sessions = globalSync.child(directory)[0].session.toSorted(sortSessions)
    return (sessions ?? []).filter((s) => !s.parentID)
  }

  const currentSessions = createMemo(() => {
    if (!params.dir) return []
    const directory = base64Decode(params.dir)
    return projectSessions(directory)
  })

  function navigateSessionByOffset(offset: number) {
    const projects = layout.projects.list()
    if (projects.length === 0) return

    const currentDirectory = params.dir ? base64Decode(params.dir) : undefined
    const projectIndex = currentDirectory ? projects.findIndex((p) => p.worktree === currentDirectory) : -1

    if (projectIndex === -1) {
      const targetProject = offset > 0 ? projects[0] : projects[projects.length - 1]
      if (targetProject) navigateToProject(targetProject.worktree)
      return
    }

    const sessions = currentSessions()
    const sessionIndex = params.id ? sessions.findIndex((s) => s.id === params.id) : -1

    let targetIndex: number
    if (sessionIndex === -1) {
      targetIndex = offset > 0 ? 0 : sessions.length - 1
    } else {
      targetIndex = sessionIndex + offset
    }

    if (targetIndex >= 0 && targetIndex < sessions.length) {
      const session = sessions[targetIndex]
      navigateToSession(session)
      queueMicrotask(() => scrollToSession(session.id))
      return
    }

    const nextProjectIndex = projectIndex + (offset > 0 ? 1 : -1)
    const nextProject = projects[nextProjectIndex]
    if (!nextProject) return

    const nextProjectSessions = projectSessions(nextProject.worktree)
    if (nextProjectSessions.length === 0) {
      navigateToProject(nextProject.worktree)
      return
    }

    const targetSession = offset > 0 ? nextProjectSessions[0] : nextProjectSessions[nextProjectSessions.length - 1]
    navigate(`/${base64Encode(nextProject.worktree)}/session/${targetSession.id}`)
    queueMicrotask(() => scrollToSession(targetSession.id))
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
    mobileSidebar.hide()
  }

  function navigateToSession(session: Session | undefined) {
    if (!session) return
    navigate(`/${params.dir}/session/${session?.id}`)
    mobileSidebar.hide()
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
    if (!params.dir || !params.id) return
    const directory = base64Decode(params.dir)
    const id = params.id
    setStore("lastSession", directory, id)
    notification.session.markViewed(id)
    untrack(() => layout.projects.expand(directory))
    requestAnimationFrame(() => scrollToSession(id))
  })

  createEffect(() => {
    if (isLargeViewport()) {
      const sidebarWidth = layout.sidebar.opened() ? layout.sidebar.width() : 48
      document.documentElement.style.setProperty("--dialog-left-margin", `${sidebarWidth}px`)
    } else {
      document.documentElement.style.setProperty("--dialog-left-margin", "0px")
    }
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
    setStore("activeDraggable", id)
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
    setStore("activeDraggable", undefined)
  }

  const ProjectAvatar = (props: {
    project: LocalProject
    class?: string
    expandable?: boolean
    notify?: boolean
  }): JSX.Element => {
    const notification = useNotification()
    const notifications = createMemo(() => notification.project.unseen(props.project.worktree))
    const hasError = createMemo(() => notifications().some((n) => n.type === "error"))
    const name = createMemo(() => props.project.name || getFilename(props.project.worktree))
    const mask = "radial-gradient(circle 5px at calc(100% - 2px) 2px, transparent 5px, black 5.5px)"
    const opencode = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

    return (
      <div class="relative size-5 shrink-0 rounded-sm">
        <Avatar
          fallback={name()}
          src={props.project.id === opencode ? "https://opencode.ai/favicon.svg" : props.project.icon?.url}
          {...getAvatarColors(props.project.icon?.color)}
          class={`size-full ${props.class ?? ""}`}
          style={
            notifications().length > 0 && props.notify ? { "-webkit-mask-image": mask, "mask-image": mask } : undefined
          }
        />
        <Show when={props.expandable}>
          <Icon
            name="chevron-right"
            size="normal"
            class="hidden size-full items-center justify-center text-text-subtle group-hover/session:flex group-data-[expanded]/trigger:rotate-90 transition-transform duration-50"
          />
        </Show>
        <Show when={notifications().length > 0 && props.notify}>
          <div
            classList={{
              "absolute -top-0.5 -right-0.5 size-1.5 rounded-full": true,
              "bg-icon-critical-base": hasError(),
              "bg-text-interactive-base": !hasError(),
            }}
          />
        </Show>
      </div>
    )
  }

  const ProjectVisual = (props: { project: LocalProject; class?: string }): JSX.Element => {
    const name = createMemo(() => props.project.name || getFilename(props.project.worktree))
    const current = createMemo(() => base64Decode(params.dir ?? ""))
    return (
      <Switch>
        <Match when={layout.sidebar.opened()}>
          <Button
            as={"div"}
            variant="ghost"
            data-active
            class="flex items-center justify-between gap-3 w-full px-1 self-stretch h-8 border-none rounded-lg"
          >
            <div class="flex items-center gap-3 p-0 text-left min-w-0 grow">
              <ProjectAvatar project={props.project} />
              <span class="truncate text-14-medium text-text-strong">{name()}</span>
            </div>
          </Button>
        </Match>
        <Match when={true}>
          <Button
            variant="ghost"
            size="large"
            class="flex items-center justify-center p-0 aspect-square border-none rounded-lg"
            data-selected={props.project.worktree === current()}
            onClick={() => navigateToProject(props.project.worktree)}
          >
            <ProjectAvatar project={props.project} notify />
          </Button>
        </Match>
      </Switch>
    )
  }

  const SessionItem = (props: {
    session: Session
    slug: string
    project: LocalProject
    mobile?: boolean
  }): JSX.Element => {
    const notification = useNotification()
    const updated = createMemo(() => DateTime.fromMillis(props.session.time.updated))
    const notifications = createMemo(() => notification.session.unseen(props.session.id))
    const hasError = createMemo(() => notifications().some((n) => n.type === "error"))
    const hasPermissions = createMemo(() => {
      const store = globalSync.child(props.project.worktree)[0]
      const permissions = store.permission?.[props.session.id] ?? []
      if (permissions.length > 0) return true
      const childSessions = store.session.filter((s) => s.parentID === props.session.id)
      for (const child of childSessions) {
        const childPermissions = store.permission?.[child.id] ?? []
        if (childPermissions.length > 0) return true
      }
      return false
    })
    const isWorking = createMemo(() => {
      if (props.session.id === params.id) return false
      if (hasPermissions()) return false
      const status = globalSync.child(props.project.worktree)[0].session_status[props.session.id]
      return status?.type === "busy" || status?.type === "retry"
    })
    return (
      <>
        <div
          data-session-id={props.session.id}
          class="group/session relative w-full pr-2 py-1 rounded-md cursor-default transition-colors
                 hover:bg-surface-raised-base-hover focus-within:bg-surface-raised-base-hover has-[.active]:bg-surface-raised-base-hover"
          style={{ "padding-left": "16px" }}
        >
          <Tooltip placement={props.mobile ? "bottom" : "right"} value={props.session.title} gutter={10}>
            <A
              href={`${props.slug}/session/${props.session.id}`}
              class="flex flex-col min-w-0 text-left w-full focus:outline-none"
            >
              <div class="flex items-center self-stretch gap-6 justify-between transition-[padding] group-hover/session:pr-7 group-focus-within/session:pr-7 group-active/session:pr-7">
                <span
                  classList={{
                    "text-14-regular text-text-strong overflow-hidden text-ellipsis truncate": true,
                    "animate-pulse": isWorking(),
                  }}
                >
                  {props.session.title}
                </span>
                <div class="shrink-0 group-hover/session:hidden group-active/session:hidden group-focus-within/session:hidden">
                  <Switch>
                    <Match when={isWorking()}>
                      <Spinner class="size-2.5 mr-0.5" />
                    </Match>
                    <Match when={hasPermissions()}>
                      <div class="size-1.5 mr-1.5 rounded-full bg-surface-warning-strong" />
                    </Match>
                    <Match when={hasError()}>
                      <div class="size-1.5 mr-1.5 rounded-full bg-text-diff-delete-base" />
                    </Match>
                    <Match when={notifications().length > 0}>
                      <div class="size-1.5 mr-1.5 rounded-full bg-text-interactive-base" />
                    </Match>
                    <Match when={true}>
                      <span class="text-12-regular text-text-weak text-right whitespace-nowrap">
                        {Math.abs(updated().diffNow().as("seconds")) < 60
                          ? "Now"
                          : updated()
                              .toRelative({
                                style: "short",
                                unit: ["days", "hours", "minutes"],
                              })
                              ?.replace(" ago", "")
                              ?.replace(/ days?/, "d")
                              ?.replace(" min.", "m")
                              ?.replace(" hr.", "h")}
                      </span>
                    </Match>
                  </Switch>
                </div>
              </div>
              <Show when={props.session.summary?.files}>
                <div class="flex justify-between items-center self-stretch">
                  <span class="text-12-regular text-text-weak">{`${props.session.summary?.files || "No"} file${props.session.summary?.files !== 1 ? "s" : ""} changed`}</span>
                  <Show when={props.session.summary}>{(summary) => <DiffChanges changes={summary()} />}</Show>
                </div>
              </Show>
            </A>
          </Tooltip>
          <div class="hidden group-hover/session:flex group-active/session:flex group-focus-within/session:flex text-text-base gap-1 items-center absolute top-1 right-1">
            <Tooltip
              placement={props.mobile ? "bottom" : "right"}
              value={
                <div class="flex items-center gap-2">
                  <span>Archive session</span>
                  <span class="text-icon-base text-12-medium">{command.keybind("session.archive")}</span>
                </div>
              }
            >
              <IconButton icon="archive" variant="ghost" onClick={() => archiveSession(props.session)} />
            </Tooltip>
          </div>
        </div>
      </>
    )
  }

  const SortableProject = (props: { project: LocalProject; mobile?: boolean }): JSX.Element => {
    const sortable = createSortable(props.project.worktree)
    const showExpanded = createMemo(() => props.mobile || layout.sidebar.opened())
    const slug = createMemo(() => base64Encode(props.project.worktree))
    const name = createMemo(() => props.project.name || getFilename(props.project.worktree))
    const [store, setProjectStore] = globalSync.child(props.project.worktree)
    const sessions = createMemo(() => store.session.toSorted(sortSessions))
    const rootSessions = createMemo(() => sessions().filter((s) => !s.parentID))
    const hasMoreSessions = createMemo(() => store.session.length >= store.limit)
    const loadMoreSessions = async () => {
      setProjectStore("limit", (limit) => limit + 5)
      await globalSync.project.loadSessions(props.project.worktree)
    }
    const isExpanded = createMemo(() =>
      props.mobile ? mobileProjects.expanded(props.project.worktree) : props.project.expanded,
    )
    const handleOpenChange = (open: boolean) => {
      if (props.mobile) {
        if (open) mobileProjects.expand(props.project.worktree)
        else mobileProjects.collapse(props.project.worktree)
      } else {
        if (open) layout.projects.expand(props.project.worktree)
        else layout.projects.collapse(props.project.worktree)
      }
    }
    return (
      // @ts-ignore
      <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
        <Switch>
          <Match when={showExpanded()}>
            <Collapsible variant="ghost" open={isExpanded()} class="gap-2 shrink-0" onOpenChange={handleOpenChange}>
              <Button
                as={"div"}
                variant="ghost"
                class="group/session flex items-center justify-between gap-3 w-full px-1.5 self-stretch h-auto border-none rounded-lg"
              >
                <Collapsible.Trigger class="group/trigger flex items-center gap-3 p-0 text-left min-w-0 grow border-none">
                  <ProjectAvatar
                    project={props.project}
                    class="group-hover/session:hidden"
                    expandable
                    notify={!isExpanded()}
                  />
                  <span class="truncate text-14-medium text-text-strong">{name()}</span>
                </Collapsible.Trigger>
                <div class="flex invisible gap-1 items-center group-hover/session:visible has-[[data-expanded]]:visible">
                  <DropdownMenu>
                    <DropdownMenu.Trigger as={IconButton} icon="dot-grid" variant="ghost" />
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content>
                        <DropdownMenu.Item
                          onSelect={() => dialog.show(() => <DialogEditProject project={props.project} />)}
                        >
                          <DropdownMenu.ItemLabel>Edit project</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => closeProject(props.project.worktree)}>
                          <DropdownMenu.ItemLabel>Close project</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                  <Tooltip
                    placement="top"
                    value={
                      <div class="flex items-center gap-2">
                        <span>New session</span>
                        <span class="text-icon-base text-12-medium">{command.keybind("session.new")}</span>
                      </div>
                    }
                  >
                    <IconButton as={A} href={`${slug()}/session`} icon="plus-small" variant="ghost" />
                  </Tooltip>
                </div>
              </Button>
              <Collapsible.Content>
                <nav class="hidden @[4rem]:flex w-full flex-col gap-1.5">
                  <For each={rootSessions()}>
                    {(session) => (
                      <SessionItem session={session} slug={slug()} project={props.project} mobile={props.mobile} />
                    )}
                  </For>
                  <Show when={rootSessions().length === 0}>
                    <div
                      class="group/session relative w-full pl-4 pr-2 py-1 rounded-md cursor-default transition-colors
                             hover:bg-surface-raised-base-hover focus-within:bg-surface-raised-base-hover has-[.active]:bg-surface-raised-base-hover"
                    >
                      <div class="flex items-center self-stretch w-full">
                        <div class="flex-1 min-w-0">
                          <Tooltip placement={props.mobile ? "bottom" : "right"} value="New session">
                            <A
                              href={`${slug()}/session`}
                              class="flex flex-col gap-1 min-w-0 text-left w-full focus:outline-none"
                            >
                              <div class="flex items-center self-stretch gap-6 justify-between">
                                <span class="text-14-regular text-text-strong overflow-hidden text-ellipsis truncate">
                                  New session
                                </span>
                              </div>
                            </A>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  </Show>
                  <Show when={hasMoreSessions()}>
                    <div class="relative w-full py-1">
                      <Button
                        variant="ghost"
                        class="flex w-full text-left justify-start text-12-medium opacity-50 px-3.5"
                        size="large"
                        onClick={loadMoreSessions}
                      >
                        Load more
                      </Button>
                    </div>
                  </Show>
                </nav>
              </Collapsible.Content>
            </Collapsible>
          </Match>
          <Match when={true}>
            <Tooltip placement="right" value={props.project.worktree}>
              <ProjectVisual project={props.project} />
            </Tooltip>
          </Match>
        </Switch>
      </div>
    )
  }

  const ProjectDragOverlay = (): JSX.Element => {
    const project = createMemo(() => layout.projects.list().find((p) => p.worktree === store.activeDraggable))
    return (
      <Show when={project()}>
        {(p) => (
          <div class="bg-background-base rounded-md">
            <ProjectVisual project={p()} />
          </div>
        )}
      </Show>
    )
  }

  const SidebarContent = (sidebarProps: { mobile?: boolean }) => {
    const expanded = () => sidebarProps.mobile || layout.sidebar.opened()
    return (
      <>
        <div class="flex flex-col items-start self-stretch gap-4 p-2 min-h-0 overflow-hidden">
          <Show when={!sidebarProps.mobile}>
            <Tooltip
              class="shrink-0"
              placement="right"
              value={
                <div class="flex items-center gap-2">
                  <span>Toggle sidebar</span>
                  <span class="text-icon-base text-12-medium">{command.keybind("sidebar.toggle")}</span>
                </div>
              }
              inactive={expanded()}
            >
              <Button
                variant="ghost"
                size="large"
                class="group/sidebar-toggle shrink-0 w-full text-left justify-start rounded-lg px-2"
                onClick={layout.sidebar.toggle}
              >
                <div class="relative -ml-px flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                  <Icon
                    name={layout.sidebar.opened() ? "layout-left" : "layout-right"}
                    size="small"
                    class="group-hover/sidebar-toggle:hidden"
                  />
                  <Icon
                    name={layout.sidebar.opened() ? "layout-left-partial" : "layout-right-partial"}
                    size="small"
                    class="hidden group-hover/sidebar-toggle:inline-block"
                  />
                  <Icon
                    name={layout.sidebar.opened() ? "layout-left-full" : "layout-right-full"}
                    size="small"
                    class="hidden group-active/sidebar-toggle:inline-block"
                  />
                </div>
                <Show when={layout.sidebar.opened()}>
                  <div class="hidden group-hover/sidebar-toggle:block group-active/sidebar-toggle:block text-text-base">
                    Toggle sidebar
                  </div>
                </Show>
              </Button>
            </Tooltip>
          </Show>
          <DragDropProvider
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragXAxis />
            <div
              ref={(el) => {
                if (!sidebarProps.mobile) scrollContainerRef = el
              }}
              class="w-full min-w-8 flex flex-col gap-2 min-h-0 overflow-y-auto no-scrollbar"
            >
              <SortableProvider ids={layout.projects.list().map((p) => p.worktree)}>
                <For each={layout.projects.list()}>
                  {(project) => <SortableProject project={project} mobile={sidebarProps.mobile} />}
                </For>
              </SortableProvider>
            </div>
            <DragOverlay>
              <ProjectDragOverlay />
            </DragOverlay>
          </DragDropProvider>
        </div>
        <div class="flex flex-col gap-1.5 self-stretch items-start shrink-0 px-2 py-3">
          <Switch>
            <Match when={providers.all().length > 0 && !providers.paid().length && expanded()}>
              <div class="rounded-md bg-background-stronger shadow-xs-border-base">
                <div class="p-3 flex flex-col gap-2">
                  <div class="text-12-medium text-text-strong">Getting started</div>
                  <div class="text-text-base">OpenCode includes free models so you can start immediately.</div>
                  <div class="text-text-base">Connect any provider to use models, inc. Claude, GPT, Gemini etc.</div>
                </div>
                <Tooltip placement="right" value="Connect provider" inactive={expanded()}>
                  <Button
                    class="flex w-full text-left justify-start text-12-medium text-text-strong stroke-[1.5px] rounded-lg rounded-t-none shadow-none border-t border-border-weak-base pl-2.25 pb-px"
                    size="large"
                    icon="plus"
                    onClick={connectProvider}
                  >
                    Connect provider
                  </Button>
                </Tooltip>
              </div>
            </Match>
            <Match when={providers.all().length > 0}>
              <Tooltip placement="right" value="Connect provider" inactive={expanded()}>
                <Button
                  class="flex w-full text-left justify-start text-text-base stroke-[1.5px] rounded-lg px-2"
                  variant="ghost"
                  size="large"
                  icon="plus"
                  onClick={connectProvider}
                >
                  <Show when={expanded()}>Connect provider</Show>
                </Button>
              </Tooltip>
            </Match>
          </Switch>
          <Tooltip
            placement="right"
            value={
              <div class="flex items-center gap-2">
                <span>Open project</span>
                <Show when={!sidebarProps.mobile}>
                  <span class="text-icon-base text-12-medium">{command.keybind("project.open")}</span>
                </Show>
              </div>
            }
            inactive={expanded()}
          >
            <Button
              class="flex w-full text-left justify-start text-text-base stroke-[1.5px] rounded-lg px-2"
              variant="ghost"
              size="large"
              icon="folder-add-left"
              onClick={chooseProject}
            >
              <Show when={expanded()}>Open project</Show>
            </Button>
          </Tooltip>
          <Tooltip placement="right" value="Share feedback" inactive={expanded()}>
            <Button
              as={"a"}
              href="https://opencode.ai/desktop-feedback"
              target="_blank"
              class="flex w-full text-left justify-start text-text-base stroke-[1.5px] rounded-lg px-2"
              variant="ghost"
              size="large"
              icon="bubble-5"
            >
              <Show when={expanded()}>Share feedback</Show>
            </Button>
          </Tooltip>
        </div>
      </>
    )
  }

  return (
    <div class="relative flex-1 min-h-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
      <Header
        navigateToProject={navigateToProject}
        navigateToSession={navigateToSession}
        onMobileMenuToggle={mobileSidebar.toggle}
      />
      <div class="flex-1 min-h-0 flex">
        <div
          classList={{
            "hidden xl:flex": true,
            "relative @container w-12 pb-5 shrink-0 bg-background-base": true,
            "flex-col gap-5.5 items-start self-stretch justify-between": true,
            "border-r border-border-weak-base contain-strict": true,
          }}
          style={{ width: layout.sidebar.opened() ? `${layout.sidebar.width()}px` : undefined }}
        >
          <Show when={layout.sidebar.opened()}>
            <ResizeHandle
              direction="horizontal"
              size={layout.sidebar.width()}
              min={150}
              max={window.innerWidth * 0.3}
              collapseThreshold={80}
              onResize={layout.sidebar.resize}
              onCollapse={layout.sidebar.close}
            />
          </Show>
          <SidebarContent />
        </div>
        <div class="xl:hidden">
          <div
            classList={{
              "fixed inset-0 bg-black/50 z-40 transition-opacity duration-200": true,
              "opacity-100 pointer-events-auto": mobileSidebar.open(),
              "opacity-0 pointer-events-none": !mobileSidebar.open(),
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) mobileSidebar.hide()
            }}
          />
          <div
            classList={{
              "@container fixed inset-y-0 left-0 z-50 w-72 bg-background-base border-r border-border-weak-base flex flex-col gap-5.5 items-start self-stretch justify-between pt-12 pb-5 transition-transform duration-200 ease-out": true,
              "translate-x-0": mobileSidebar.open(),
              "-translate-x-full": !mobileSidebar.open(),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent mobile />
          </div>
        </div>

        <main class="size-full overflow-x-hidden flex flex-col items-start contain-strict">{props.children}</main>
      </div>
      <Toast.Region />
    </div>
  )
}

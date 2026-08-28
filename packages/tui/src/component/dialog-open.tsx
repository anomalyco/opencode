import { createMemo, createResource, createSignal } from "solid-js"
import path from "path"
import type { SessionInfo } from "@opencode-ai/client"
import { useTerminalDimensions } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { dialogWidth, useDialog } from "../ui/dialog"
import { DialogSelect, dialogSelectContentWidth, type DialogSelectRef } from "../ui/dialog-select"
import { useRoute } from "../context/route"
import { useData } from "../context/data"
import { useClient } from "../context/client"
import { useLocation } from "../context/location"
import { useSessionTabs } from "../context/session-tabs"
import { useTheme, useThemes } from "../context/theme"
import { Keymap } from "../context/keymap"
import { Locale } from "../util/locale"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "../context/runtime"
import { truncateFilePath } from "../ui/file-path"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { stringWidth } from "../util/string-width"
import { withTimestampedFallback } from "@opencode-ai/util/session-title-fallback"
import { Spinner } from "./spinner"
import { projectName } from "../util/project"

const RECENT_LIMIT = 8
export const DialogOpenKey = Symbol("DialogOpen")

type OpenTarget =
  | { type: "session"; sessionID: string }
  | { type: "project"; directory: string; projectID?: string }
  | { type: "browse"; directory: string }
  | { type: "new"; projectID: string }

export async function loadDialogOpen(data: ReturnType<typeof useData>, client: ReturnType<typeof useClient>) {
  const [, sessions] = await Promise.all([
    data.project.sync().catch(() => {}),
    client.api.session
      .list({ limit: 50, order: "desc", parentID: null })
      .then((response) => response.data)
      .catch(() => [] as SessionInfo[]),
  ])
  return sessions
}

export function DialogOpen(props: { sessions: SessionInfo[] }) {
  const dialog = useDialog()
  const route = useRoute()
  const data = useData()
  const client = useClient()
  const location = useLocation()
  const sessionTabs = useSessionTabs()
  const toast = useToast()
  const themes = useThemes()
  const theme = useTheme("elevated")
  const mode = themes.mode
  const paths = useTuiPaths()
  const dimensions = useTerminalDimensions()
  const shortcuts = Keymap.useShortcuts()
  const [filter, setFilter] = createSignal("")
  const [selectionMoved, setSelectionMoved] = createSignal(false)
  const [selected, setSelected] = createSignal<OpenTarget>()
  const [directory, setDirectory] = createSignal<string>()
  const [projectID, setProjectID] = createSignal<string>()
  let select: DialogSelectRef<OpenTarget> | undefined
  function browse(next?: string) {
    select?.clearFilter()
    setSelectionMoved(false)
    setSelected(undefined)
    setProjectID(undefined)
    setDirectory(next)
  }
  const [worktrees] = createResource(projectID, (projectID) =>
    client.api.worktree.list({ projectID }).catch((error: unknown) => {
      toast.show({ title: "Loading worktrees failed", message: errorMessage(error), variant: "error" })
      return []
    }),
  )
  const [entries] = createResource(directory, (directory) =>
    client.api.file
      .list({ location: { directory, workspace: location.ref?.workspaceID ?? data.location.default().workspaceID } })
      .then((result) => result.data.filter((entry) => entry.type === "directory"))
      .catch(() => undefined),
  )

  const [matched] = createResource(
    () => {
      const value = filter().trim()
      return /^ses_[0-9A-Za-z]{26}$/.test(value) ? value : undefined
    },
    (sessionID) =>
      client.api.session
        .get({ sessionID })
        .then((session) => (session.id === sessionID ? session : undefined))
        .catch(() => undefined),
  )

  const openTabs = createMemo(
    () => new Set(sessionTabs.enabled() ? sessionTabs.tabs().map((tab) => tab.sessionID) : []),
  )
  const currentSessionID = createMemo(() =>
    route.data.type === "session" ? data.session.root(route.data.sessionID) : undefined,
  )
  const sessions = createMemo(() => {
    const seen = new Set<string>()
    const match = matched()
    return [...data.session.list(), ...props.sessions, ...(match ? [match] : [])]
      .filter((session) => {
        if (session.parentID || seen.has(session.id)) return false
        seen.add(session.id)
        return true
      })
      .toSorted((a, b) => b.time.updated - a.time.updated)
  })

  const options = createMemo(() => {
    const tabs = openTabs()
    // With an empty query the menu shows what is not already one keystroke away: open tabs are
    // visible in the strip, so recents exclude them. Typing widens the pool to every session so
    // matching a loaded tab by name still switches to it.
    const recent = filter().trim()
      ? sessions()
      : sessions()
          .filter((session) => !tabs.has(session.id))
          .slice(0, RECENT_LIMIT)
    const sessionOptions = recent.map((session) => {
      const project = data.project.get(session.projectID)
      const name = projectName(project)
      const basename = path.basename(session.location.directory)
      const label = name && name.toLowerCase() !== basename.toLowerCase() ? `${name} · ${basename}` : name || basename
      const running =
        data.session.status(session.id) === "running" ||
        data.session.family(session.id).some((id) => data.session.status(id) === "running")
      return {
        title: withTimestampedFallback(session),
        searchText: `${session.id} ${session.location.directory}`,
        value: { type: "session", sessionID: session.id } as OpenTarget,
        category: "Sessions",
        footer: `${label ? `${Locale.truncate(label, 30)} · ` : ""}${timeAgo(session.time.updated)}`,
        onSelect: () => location.set(session.location),
        gutter: running
          ? (color: RGBA) => <Spinner color={color} />
          : tabs.has(session.id)
            ? () => <text fg={theme.hue.accent[mode() === "light" ? 800 : 200]}>▪</text>
            : undefined,
      }
    })

    const current = location.ref?.directory ?? location.current?.directory
    const seen = new Set<string>()
    const projectOptions = [
      ...data.project
        .list()
        .flatMap((project) => [project.canonical, ...project.sandboxes].map((directory) => ({ directory, project }))),
      ...sessions().map((session) => ({
        directory: session.location.directory,
        project: data.project.get(session.projectID),
      })),
    ]
      .filter((item) => {
        if (item.directory === "/" || seen.has(item.directory)) return false
        seen.add(item.directory)
        return true
      })
      .map((item) => {
        const title =
          item.directory === item.project?.canonical
            ? (projectName(item.project) ?? path.basename(item.directory))
            : path.basename(item.directory)
        const footer = abbreviateHome(item.directory, paths.home)
        const git = item.project?.vcs === "git"
        const width =
          dialogSelectContentWidth(Math.min(dialogWidth("large"), dimensions().width - 2)) -
          stringWidth(title) -
          (git ? 2 : 0)
        return {
          title,
          footer: `${truncateFilePath(footer, width)}${git ? " →" : ""}`,
          searchText: `${footer} ${projectName(item.project) ?? ""}`,
          value: {
            type: "project",
            directory: item.directory,
            ...(git ? { projectID: item.project!.id } : {}),
          } as OpenTarget,
          category: "Projects",
          gutter:
            item.directory === current ||
            (item.directory === location.current?.project.canonical && (!current || !seen.has(current)))
              ? () => <text fg={theme.text.formfield.selected}>●</text>
              : undefined,
        }
      })

    return [...sessionOptions, ...projectOptions]
  })

  const worktreeOptions = createMemo(() => {
    const id = projectID()
    if (!id) return []
    const project = data.project.get(id)
    if (!project) return []
    const current = location.ref?.directory ?? location.current?.directory
    const directories = [project.canonical, ...(worktrees() ?? []).map((worktree) => worktree.directory)]
    return [
      ...directories
        .filter((directory, index) => directories.indexOf(directory) === index)
        .toSorted((a, b) => {
          if (a === project.canonical) return -1
          if (b === project.canonical) return 1
          if (a === current) return -1
          if (b === current) return 1
          return 0
        })
        .map((directory) => {
          const title =
            directory === project.canonical
              ? (projectName(project) ?? path.basename(directory))
              : path.basename(directory)
          return {
            title,
            footer: truncateFilePath(
              abbreviateHome(directory, paths.home),
              dialogSelectContentWidth(Math.min(dialogWidth("large"), dimensions().width - 2)) - stringWidth(title),
            ),
            value: { type: "project", directory } as OpenTarget,
            category: "Worktrees",
            gutter: directory === current ? () => <text fg={theme.text.formfield.selected}>●</text> : undefined,
          }
        }),
      {
        title: "+ New worktree",
        value: { type: "new", projectID: id } as OpenTarget,
        category: "Worktrees",
      },
    ]
  })

  const directoryOptions = createMemo(() => {
    const current = directory()
    if (!current) return []
    return [
      {
        title: "Open this directory",
        footer: truncateFilePath(
          abbreviateHome(current, paths.home),
          dialogSelectContentWidth(Math.min(dialogWidth("large"), dimensions().width - 2)) -
            stringWidth("Open this directory"),
        ),
        value: { type: "project", directory: current } as OpenTarget,
        category: "Current",
      },
      ...(path.dirname(current) !== current
        ? [
            {
              title: "..",
              value: { type: "browse", directory: path.dirname(current) } as OpenTarget,
              category: "Current",
            },
          ]
        : []),
      ...(entries() ?? [])
        .toSorted((a, b) => a.path.localeCompare(b.path))
        .map((entry) => ({
          title: path.basename(entry.path),
          value: { type: "browse", directory: path.resolve(current, entry.path) } as OpenTarget,
          category: "Directories",
        })),
    ]
  })

  return (
    <DialogSelect
      ref={(value) => (select = value)}
      title={projectID() ? "Worktrees" : "Open"}
      placeholder={
        directory()
          ? abbreviateHome(directory()!, paths.home)
          : projectID()
            ? "Search worktrees…"
            : "Search sessions and projects…"
      }
      options={directory() ? directoryOptions() : projectID() ? worktreeOptions() : options()}
      current={
        directory()
          ? ({ type: "project", directory: directory()! } as OpenTarget)
          : projectID() && (location.ref?.directory ?? location.current?.directory)
            ? ({ type: "project", directory: (location.ref?.directory ?? location.current?.directory)! } as OpenTarget)
            : currentSessionID()
              ? ({ type: "session", sessionID: currentSessionID()! } as OpenTarget)
              : undefined
      }
      focusCurrent={Boolean(directory() || projectID())}
      sectionNavigation={true}
      preserveSelection={selectionMoved()}
      onMove={(option) => {
        setSelectionMoved(true)
        setSelected(option.value)
      }}
      onFilter={setFilter}
      bindings={[
        {
          bind: "ctrl+o",
          title: directory() ? "Return to projects" : "Browse directories",
          group: "Dialog",
          run: () =>
            browse(directory() ? undefined : (location.ref?.directory ?? location.current?.directory ?? paths.cwd)),
        },
        ...(!directory() && !projectID()
          ? [
              {
                bind: "right",
                title: "Show project worktrees",
                group: "Dialog",
                run: () => {
                  const target = selected() ?? select?.filtered[0]?.value
                  if (target?.type !== "project" || !target.projectID) return
                  select?.clearFilter()
                  setSelectionMoved(false)
                  setSelected(undefined)
                  setProjectID(target.projectID)
                },
              },
            ]
          : []),
        ...(projectID()
          ? [
              {
                bind: "left",
                title: "Return to projects",
                group: "Dialog",
                run: () => browse(),
              },
            ]
          : []),
        ...(directory() && path.dirname(directory()!) !== directory()
          ? [
              {
                bind: "ctrl+u",
                title: "Browse parent directory",
                group: "Dialog",
                run: () => browse(path.dirname(directory()!)),
              },
            ]
          : []),
      ]}
      footerHints={[
        ...(projectID() ? [{ title: "back", label: "←" }] : []),
        { title: directory() ? "back" : "browse directories", label: "ctrl+o" },
        ...(directory() && path.dirname(directory()!) !== directory() ? [{ title: "parent", label: "ctrl+u" }] : []),
      ]}
      noMatchView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.subdued}>
            {directory()
              ? entries.loading
                ? "Loading directories…"
                : "No matching directories"
              : shortcuts.get("session.list")
                ? `No matches · search all sessions with ${shortcuts.get("session.list")}`
                : "No matches"}
          </text>
        </box>
      }
      onSelect={(option) => {
        if (option.value.type === "browse") {
          browse(option.value.directory)
          return
        }
        if (option.value.type === "new") {
          const id = option.value.projectID
          void client.api.worktree
            .create({ projectID: id, strategy: "git", directory: path.join(paths.worktree, id.slice(0, 6)) })
            .then((created) => {
              const target = {
                directory: created.directory,
                ...(location.ref?.workspaceID ? { workspaceID: location.ref.workspaceID } : {}),
              }
              dialog.clear()
              route.navigate({ type: "home", location: target })
              location.set(target)
            })
            .catch((error: unknown) =>
              toast.show({ title: "Creating worktree failed", message: errorMessage(error), variant: "error" }),
            )
          return
        }
        dialog.clear()
        if (option.value.type === "session") {
          route.navigate({ type: "session", sessionID: option.value.sessionID })
          return
        }
        const target = {
          directory: option.value.directory,
          ...((directory() || projectID()) && location.ref?.workspaceID
            ? { workspaceID: location.ref.workspaceID }
            : {}),
        }
        route.navigate({ type: "home", location: target })
        location.set(target)
      }}
    />
  )
}

function timeAgo(timestamp: number) {
  const minutes = Math.floor((Date.now() - timestamp) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(days / 365)}y`
}

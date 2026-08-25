import { createMemo, createResource, createSignal, onCleanup, Show } from "solid-js"
import type { OpenCodeEvent, SessionInfo } from "@opencode-ai/client"
import path from "path"
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
import { stringWidth } from "../util/string-width"
import { withTimestampedFallback } from "@opencode-ai/util/session-title-fallback"
import { Spinner } from "./spinner"
import { projectName } from "../util/project"

const RECENT_LIMIT = 8
export const DialogOpenKey = Symbol("DialogOpen")

type OpenTarget =
  | { type: "session"; sessionID: string }
  | { type: "project"; directory: string }
  | { type: "browse"; directory: string }

export function DialogOpen(props: { sessions: SessionInfo[]; onLoad: (sessions: SessionInfo[]) => void }) {
  const dialog = useDialog()
  const route = useRoute()
  const data = useData()
  const client = useClient()
  const location = useLocation()
  const sessionTabs = useSessionTabs()
  const themes = useThemes()
  const theme = useTheme("elevated")
  const mode = themes.mode
  const paths = useTuiPaths()
  const dimensions = useTerminalDimensions()
  const shortcuts = Keymap.useShortcuts()
  const [filter, setFilter] = createSignal("")
  const [selectionMoved, setSelectionMoved] = createSignal(false)
  let closed = false
  onCleanup(() => {
    closed = true
  })
  const [recent] = createResource(() => {
    // A late read must not overwrite deletion or placement facts observed in flight.
    const changed = new Map<string, Extract<OpenCodeEvent, { type: "session.deleted" | "session.moved" }>>()
    const unsubscribe = client.event.listen((message) => {
      const event = message.details
      if (event.type === "session.deleted" || event.type === "session.moved") changed.set(event.data.sessionID, event)
    })
    onCleanup(unsubscribe)
    return client.api.session
      .list({ limit: 50, order: "desc", parentID: null })
      .then((response) => {
        if (!closed)
          props.onLoad(
            response.data.flatMap((session) => {
              const event = changed.get(session.id)
              if (!event) return [session]
              if (event.type === "session.deleted") return []
              return [moveOpenSession(props.sessions.find((entry) => entry.id === session.id) ?? session, event)]
            }),
          )
        return true
      })
      .catch(() => false)
      .finally(unsubscribe)
  })
  const [projects] = createResource(() =>
    data.project.sync().then(
      () => true,
      () => false,
    ),
  )
  const [directory, setDirectory] = createSignal<string>()
  let select: DialogSelectRef<OpenTarget> | undefined
  function browse(next?: string) {
    select?.clearFilter()
    setSelectionMoved(false)
    setDirectory(next)
  }
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
        const width =
          dialogSelectContentWidth(Math.min(dialogWidth("large"), dimensions().width - 2)) - stringWidth(title)
        return {
          title,
          footer: truncateFilePath(footer, width),
          searchText: `${footer} ${projectName(item.project) ?? ""}`,
          value: { type: "project", directory: item.directory } as OpenTarget,
          category: "Projects",
          gutter:
            item.directory === current ||
            (item.directory === location.current?.project.canonical && (!current || !seen.has(current)))
              ? () => <text fg={theme.text.formfield.selected}>●</text>
              : undefined,
        }
      })

    return [
      ...sessionOptions,
      ...projectOptions,
      {
        title: "Browse directories",
        footer: truncateFilePath(
          abbreviateHome(current ?? paths.cwd, paths.home),
          dialogSelectContentWidth(Math.min(dialogWidth("large"), dimensions().width - 2)) -
            stringWidth("Browse directories"),
        ),
        value: { type: "browse", directory: current ?? paths.cwd } as OpenTarget,
        category: "Projects",
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
      title="Open"
      placeholder={directory() ? abbreviateHome(directory()!, paths.home) : "Search sessions and projects…"}
      options={directory() ? directoryOptions() : options()}
      current={
        directory()
          ? ({ type: "project", directory: directory()! } as OpenTarget)
          : currentSessionID()
            ? ({ type: "session", sessionID: currentSessionID()! } as OpenTarget)
            : undefined
      }
      focusCurrent={Boolean(directory())}
      sectionNavigation={true}
      preserveSelection={selectionMoved()}
      onMove={() => setSelectionMoved(true)}
      onFilter={setFilter}
      emptyView={
        <Show when={!recent.loading && !projects.loading}>
          <box paddingLeft={4} paddingRight={4}>
            <text fg={theme.text.subdued}>No recent sessions or projects</text>
          </box>
        </Show>
      }
      footer={
        <box>
          <Show when={recent.loading || projects.loading}>
            <Spinner color={theme.text.subdued}>Refreshing sessions and projects…</Spinner>
          </Show>
          <Show when={recent() === false || projects() === false}>
            <text fg={theme.text.feedback.error.default}>
              Could not refresh{" "}
              {recent() === false ? (projects() === false ? "sessions and projects" : "sessions") : "projects"}.
            </text>
          </Show>
        </box>
      }
      bindings={[
        {
          bind: "ctrl+o",
          title: directory() ? "Return to projects" : "Browse directories",
          group: "Dialog",
          run: () =>
            browse(directory() ? undefined : (location.ref?.directory ?? location.current?.directory ?? paths.cwd)),
        },
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
        { title: directory() ? "back" : "browse", label: "ctrl+o" },
        ...(directory() && path.dirname(directory()!) !== directory() ? [{ title: "parent", label: "ctrl+u" }] : []),
      ]}
      noMatchView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.subdued}>
            {directory()
              ? entries.loading
                ? "Loading directories…"
                : "No matching directories"
              : recent.loading || projects.loading || matched.loading
                ? "Searching sessions and projects…"
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
        dialog.clear()
        if (option.value.type === "session") {
          route.navigate({ type: "session", sessionID: option.value.sessionID })
          return
        }
        const target = {
          directory: option.value.directory,
          ...(directory() && location.ref?.workspaceID ? { workspaceID: location.ref.workspaceID } : {}),
        }
        route.navigate({ type: "home", location: target })
        location.set(target)
      }}
    />
  )
}

export function moveOpenSession(session: SessionInfo, event: Extract<OpenCodeEvent, { type: "session.moved" }>) {
  return {
    ...session,
    location: event.data.location,
    projectID: event.data.projectID ?? session.projectID,
    subpath: event.data.subpath,
    time: { ...session.time, updated: Math.max(session.time.updated, event.created) },
  }
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

import { createMemo, createResource, createSignal, onCleanup, Show } from "solid-js"
import type { OpenCodeEvent, SessionInfo } from "@opencode-ai/client"
import { useTerminalDimensions } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { dialogWidth, useDialog } from "../ui/dialog"
import { DialogSelect, dialogSelectContentWidth } from "../ui/dialog-select"
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

type OpenTarget = { type: "session"; sessionID: string } | { type: "project"; directory: string }

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
      const running =
        data.session.status(session.id) === "running" ||
        data.session.family(session.id).some((id) => data.session.status(id) === "running")
      return {
        title: withTimestampedFallback(session),
        searchText: session.id,
        value: { type: "session", sessionID: session.id } as OpenTarget,
        category: "Sessions",
        footer: `${name ? `${Locale.truncate(name, 20)} · ` : ""}${timeAgo(session.time.updated)}`,
        onSelect: () => location.set(session.location),
        gutter: running
          ? (color: RGBA) => <Spinner color={color} />
          : tabs.has(session.id)
            ? () => <text fg={theme.hue.accent[mode() === "light" ? 800 : 200]}>▪</text>
            : undefined,
      }
    })

    const current = location.current?.project
    const seen = new Set<string>()
    const projectOptions = data.project
      .list()
      .filter((project) => {
        if (project.canonical === "/" || seen.has(project.canonical)) return false
        seen.add(project.canonical)
        return true
      })
      .map((project) => {
        const title = projectName(project) ?? project.canonical
        const footer = abbreviateHome(project.canonical, paths.home)
        const width =
          dialogSelectContentWidth(Math.min(dialogWidth("large"), dimensions().width - 2)) - stringWidth(title)
        return {
          title,
          footer: truncateFilePath(footer, width),
          searchText: footer,
          value: { type: "project", directory: project.canonical } as OpenTarget,
          category: "Projects",
          gutter:
            project.canonical === current?.canonical
              ? () => <text fg={theme.text.formfield.selected}>●</text>
              : undefined,
        }
      })

    return [...sessionOptions, ...projectOptions]
  })

  return (
    <DialogSelect
      title="Open"
      placeholder="Search sessions and projects…"
      options={options()}
      current={currentSessionID() ? ({ type: "session", sessionID: currentSessionID()! } as OpenTarget) : undefined}
      focusCurrent={false}
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
      noMatchView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.subdued}>
            {recent.loading || projects.loading || matched.loading
              ? "Searching sessions and projects…"
              : shortcuts.get("session.list")
                ? `No matches · search all sessions with ${shortcuts.get("session.list")}`
                : "No matches"}
          </text>
        </box>
      }
      onSelect={(option) => {
        dialog.clear()
        if (option.value.type === "session") {
          route.navigate({ type: "session", sessionID: option.value.sessionID })
          return
        }
        const target = { directory: option.value.directory }
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

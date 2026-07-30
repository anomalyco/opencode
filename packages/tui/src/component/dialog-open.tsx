import path from "path"
import { createMemo, createResource, createSignal, onMount } from "solid-js"
import type { SessionInfo } from "@opencode-ai/client"
import { useTerminalDimensions } from "@opentui/solid"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
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
import { Spinner } from "./spinner"

const RECENT_LIMIT = 8

type OpenTarget = { type: "session"; sessionID: string } | { type: "project"; directory: string }

export function DialogOpen() {
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

  data.project.invalidate()
  void data.project.sync().catch(() => {})

  // One background fetch fills in recent sessions from other projects; the menu renders
  // immediately from the local store and never blocks on the network.
  const [fetched] = createResource(
    () =>
      client.api.session
        .list({ limit: 50, order: "desc", parentID: null })
        .then((response) => response.data)
        .catch(() => [] as SessionInfo[]),
    { initialValue: [] },
  )

  const openTabs = createMemo(() => new Set(sessionTabs.tabs().map((tab) => tab.sessionID)))
  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const sessions = createMemo(() => {
    const seen = new Set<string>()
    return [...data.session.list(), ...fetched()]
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
    // matching a tab by name still switches to it.
    const recent = filter().trim()
      ? sessions()
      : sessions()
          .filter((session) => !tabs.has(session.id))
          .slice(0, RECENT_LIMIT)
    const sessionOptions = recent.map((session) => {
      const project = data.project.get(session.projectID)
      const name = project?.name || path.basename(project?.canonical ?? session.location.directory)
      const running = data.session.family(session.id).some((id) => data.session.status(id) === "running")
      return {
        title: session.title,
        value: { type: "session", sessionID: session.id } as OpenTarget,
        category: "Sessions",
        footer: `${Locale.truncate(name, 20)} · ${timeAgo(session.time.updated)}`,
        gutter: running
          ? () => <Spinner />
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
        if (project.canonical === "/" || project.id === current?.id || seen.has(project.canonical)) return false
        seen.add(project.canonical)
        return true
      })
      .map((project) => {
        const title = project.name ?? path.basename(project.canonical)
        const description = abbreviateHome(project.canonical, paths.home)
        // Dialog padding, the gutter column, title padding, and the separating space use nine columns.
        const width = Math.min(60, dimensions().width - 2) - 9 - stringWidth(title)
        return {
          title,
          description: truncateFilePath(description, width),
          searchText: description,
          value: { type: "project", directory: project.canonical } as OpenTarget,
          category: "Projects",
        }
      })

    return [...sessionOptions, ...projectOptions]
  })

  onMount(() => dialog.setSize("large"))

  return (
    <DialogSelect
      title="Open"
      placeholder="Search sessions and projects…"
      options={options()}
      current={currentSessionID() ? ({ type: "session", sessionID: currentSessionID()! } as OpenTarget) : undefined}
      focusCurrent={false}
      onFilter={setFilter}
      noMatchView={
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.text.subdued}>
            {shortcuts.get("session.list")
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

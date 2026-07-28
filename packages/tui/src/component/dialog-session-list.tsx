import { createMemo, createResource, createSignal, onMount } from "solid-js"
import path from "path"
import type { SessionInfo } from "@opencode-ai/client"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useRoute } from "../context/route"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { Locale } from "../util/locale"
import { useThemes } from "../context/theme"
import { useClient } from "../context/client"
import { useLocal } from "../context/local"
import { createDebouncedSignal } from "../util/signal"
import { useToast } from "../ui/toast"
import { DialogSessionRename } from "./dialog-session-rename"
import { Spinner } from "./spinner"
import { errorMessage } from "../util/error"

export function DialogSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const data = useData()
  const themes = useThemes()
  const theme = themes.contextual("elevated")
  const mode = themes.mode
  const client = useClient()
  const local = useLocal()
  const toast = useToast()
  const [filter, setFilter] = createSignal("")
  const shortcuts = Keymap.useShortcuts()
  const [search, setSearch] = createDebouncedSignal("", 150)
  const [toDelete, setToDelete] = createSignal<string>()

  const [searchResults] = createResource(search, async (query) => {
    if (!query) return
    try {
      if (!data.location.info()) await data.location.sync()
      const current = data.location.info()
      if (!current) throw new Error("Location unavailable")
      const response = await client.api.session.list({
        project: current.project.id,
        search: query,
        limit: 50,
        order: "desc",
        parentID: null,
      })
      return { query, sessions: response.data, error: undefined }
    } catch (error) {
      // A transient transport failure must degrade search, not crash the TUI
      // through the root ErrorBoundary when the errored resource is read.
      return { query, sessions: [] as SessionInfo[], error }
    }
  })

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const localSessions = createMemo(() => {
    const query = filter().trim().toLowerCase()
    const sessions = data.session.list()
    if (!query) return sessions
    return sessions.filter((session) => !session.parentID && session.title.toLowerCase().includes(query))
  })
  const sessions = createMemo(() => {
    const query = filter()
    const local = localSessions()
    if (!query) return local
    if (query !== search() || searchResults.loading) return local
    const result = searchResults()
    if (result?.query !== query || result.error) return local
    return result.sessions
  })
  const searchState = createMemo(() => {
    const query = filter()
    if (!query) return { message: "No sessions available", error: false }
    if (query !== search() || searchResults.loading) return { message: "Searching sessions…", error: false }
    const result = searchResults()
    if (result?.query === query && result.error)
      return { message: "Could not search sessions. Change the search to try again.", error: true }
    return { message: "No sessions found", error: false }
  })

  const quickSwitchHint = createMemo(() => {
    const first = shortcuts.get("session.quick_switch.1")
    const last = shortcuts.get("session.quick_switch.9")
    if (!first || !last) return
    return quickSwitchRange(first, last)
  })
  const quickSwitchFooterHints = createMemo(() => {
    const hint = quickSwitchHint()
    return hint && local.session.slots().length > 0 ? [{ title: "switch", label: hint }] : []
  })

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const sessionMap = new Map(
      sessions()
        .filter((session) => !session.parentID)
        .map((session) => [session.id, session]),
    )
    const pinned = local.session.pinned().filter((sessionID) => sessionMap.has(sessionID))
    const pinnedSet = new Set(pinned)
    const slotByID = new Map(local.session.slots().map((sessionID, index) => [sessionID, index + 1]))

    const option = (session: SessionInfo, category: string) => {
      const directory = session.location.directory
      const footer =
        directory !== data.location.info()?.project.directory ? Locale.truncate(path.basename(directory), 20) : ""
      const slot = slotByID.get(session.id)
      const deleting = toDelete() === session.id
      return {
        title: deleting ? `Press ${shortcuts.get("session.delete")} again to confirm` : session.title,
        value: session.id,
        category,
        footer,
        bg: deleting ? theme.background.action.destructive.focused : undefined,
        fg: deleting ? theme.text.action.destructive.focused : undefined,
        gutter: data.session.family(session.id).some((id) => data.session.status(id) === "running")
          ? () => <Spinner />
          : slot === undefined
            ? undefined
            : () => <text fg={theme.hue.accent[mode() === "light" ? 800 : 200]}>{slot}</text>,
      }
    }

    const remaining = sessions()
      .filter((session) => !session.parentID && !pinnedSet.has(session.id))
      .map((session) => {
        const date = new Date(session.time.updated).toDateString()
        return option(session, date === today ? "Today" : date)
      })

    return [...pinned.map((sessionID) => option(sessionMap.get(sessionID)!, "Pinned")), ...remaining]
  })

  onMount(() => dialog.setSize("large"))

  return (
    <DialogSelect
      title="Sessions"
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={(query) => {
        setFilter(query)
        setSearch(query)
      }}
      emptyView={
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.text.subdued}>No sessions available</text>
        </box>
      }
      noMatchView={
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={searchState().error ? theme.text.feedback.error.default : theme.text.subdued}>
            {searchState().message}
          </text>
        </box>
      }
      onMove={() => setToDelete(undefined)}
      onSelect={(option) => {
        route.navigate({ type: "session", sessionID: option.value })
        dialog.clear()
      }}
      actions={[
        {
          command: "session.pin.toggle",
          title: "pin/unpin",
          onTrigger: (option: { value: string }) => local.session.togglePin(option.value),
        },
        {
          command: "session.delete",
          title: "delete",
          onTrigger: (option: { value: string }) => {
            if (toDelete() !== option.value) {
              setToDelete(option.value)
              return
            }
            void client.api.session.remove({ sessionID: option.value }).catch((error) => {
              setToDelete(undefined)
              toast.show({
                message: `Failed to delete session: ${errorMessage(error)}`,
                variant: "error",
                duration: 5000,
              })
            })
          },
        },
        {
          command: "session.rename",
          title: "rename",
          onTrigger: (option: { value: string }) =>
            DialogSessionRename.show(dialog, option.value, data.session.get(option.value)?.title),
        },
      ]}
      footerHints={quickSwitchFooterHints()}
    />
  )
}

function quickSwitchRange(first: string, last: string) {
  const prefix = first.slice(0, -1)
  if (first.endsWith("1") && last === `${prefix}9`) return `${prefix}1-9`
  return `${first} through ${last}`
}

import { createMemo, createResource, createSignal, onMount } from "solid-js"
import path from "path"
import type { SessionInfo } from "@opencode-ai/sdk/v2"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useRoute } from "../context/route"
import { useData } from "../context/data"
import { Locale } from "../util/locale"
import { useProject } from "../context/project"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { useLocal } from "../context/local"
import { createDebouncedSignal } from "../util/signal"
import { useToast } from "../ui/toast"
import { useCommandShortcut } from "../keymap"
import { DialogSessionRename } from "./dialog-session-rename"
import { Spinner } from "./spinner"
import { errorMessage } from "../util/error"

export function DialogSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const data = useData()
  const project = useProject()
  const { theme } = useTheme()
  const sdk = useSDK()
  const local = useLocal()
  const toast = useToast()
  const [search, setSearch] = createDebouncedSignal("", 150)
  const [toDelete, setToDelete] = createSignal<string>()
  const quickSwitch1 = useCommandShortcut("session.quick_switch.1")
  const quickSwitch9 = useCommandShortcut("session.quick_switch.9")
  const deleteHint = useCommandShortcut("session.delete")

  const [searchResults] = createResource(search, async (query) => {
    if (!query) return
    const location = data.location.default()
    const response = await sdk.api.session.list({
      search: query,
      limit: 50,
      order: "desc",
      parentID: null,
      directory: location.directory,
      workspace: location.workspaceID,
    })
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- generated client output is readonly; session list UI reuses legacy mutable session types.
    return { query, sessions: structuredClone(response.data) as SessionInfo[] }
  })

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const sessions = createMemo(() => {
    const query = search()
    if (!query) return data.session.list()
    const result = searchResults()
    return result?.query === query ? result.sessions : []
  })

  const quickSwitchHint = createMemo(() => {
    const first = quickSwitch1()
    const last = quickSwitch9()
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
      const footer = directory !== project.data.project.mainDir ? Locale.truncate(path.basename(directory), 20) : ""
      const slot = slotByID.get(session.id)
      const deleting = toDelete() === session.id
      return {
        title: deleting ? `Press ${deleteHint()} again to confirm` : session.title,
        value: session.id,
        category,
        footer,
        bg: deleting ? theme.error : undefined,
        gutter: data.session.family(session.id).some((id) => data.session.status(id) === "running")
          ? () => <Spinner />
          : slot === undefined
            ? undefined
            : () => <text fg={theme.accent}>{slot}</text>,
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
      onFilter={setSearch}
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
            void sdk.client.v2.session.remove({ sessionID: option.value }, { throwOnError: true }).catch((error) => {
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

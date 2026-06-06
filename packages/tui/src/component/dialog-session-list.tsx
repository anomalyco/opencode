import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useRoute } from "../context/route"
import { useSync } from "../context/sync"
import { createEffect, createMemo, createResource, createSignal, onMount } from "solid-js"
import path from "path"
import { Locale } from "../util/locale"
import { useProject } from "../context/project"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { useLocal } from "../context/local"
import { DialogSessionRename } from "./dialog-session-rename"
import { createDebouncedSignal } from "../util/signal"
import { useToast } from "../ui/toast"
import { openWorkspaceSelect, type WorkspaceSelection, warpWorkspaceSession } from "./dialog-workspace-create"
import { Spinner } from "./spinner"
import { errorMessage } from "../util/error"
import { DialogSessionDeleteFailed } from "./dialog-session-delete-failed"
import { useCommandShortcut } from "../keymap"

type SessionListFilter = {
  scope?: "project"
  path?: string
}

type SessionListItem = {
  id: string
  parentID?: string
  title?: string
  time: {
    updated: number
  }
}

type SessionListResult<T extends SessionListItem> = {
  key: string
  query: string
  sessions: T[]
}

export function createDialogSessionListQuery(input: { query: string; filter: SessionListFilter }) {
  return {
    ...input.filter,
    roots: true,
    limit: input.query ? 30 : 100,
    ...(input.query ? { search: input.query } : {}),
  }
}

export function createDialogSessionListKey(input: { query: string; filter: SessionListFilter }) {
  return [input.query, input.filter.scope ?? "", input.filter.path ?? ""].join("\x00")
}

export function orderDialogSessionsByRecency(sessions: SessionListItem[]) {
  return sessions
    .filter((session) => session.parentID === undefined)
    .toSorted((a, b) => b.time.updated - a.time.updated)
    .map((session) => session.id)
}

export function nextDialogSessionBrowseOrder(input: {
  current: { key: string; ids: string[] } | undefined
  result: SessionListResult<SessionListItem> | undefined
}) {
  if (!input.result) return input.current
  if (input.current?.key === input.result.key) return input.current
  return { key: input.result.key, ids: orderDialogSessionsByRecency(input.result.sessions) }
}

export function createDialogSessionItems<T extends SessionListItem>(input: {
  browse: T[] | undefined
  remote: T[] | undefined
  synced: T[]
  pinned: string[]
  current: string | undefined
  query: string
}) {
  const query = input.query.trim().toLowerCase()
  const map = new Map(
    (input.browse ?? input.synced)
      .filter((session) => session.parentID === undefined)
      .map((session) => [session.id, session] as const),
  )
  const pinned = new Set(input.pinned)

  const remote = query ? (input.remote ?? []) : []
  remote.filter((session) => session.parentID === undefined).forEach((session) => map.set(session.id, session))

  input.synced
    .filter((session) => session.parentID === undefined)
    .filter((session) => map.has(session.id) || pinned.has(session.id) || session.id === input.current)
    .forEach((session) => map.set(session.id, session))

  const sessions = [...map.values()]
  if (!query) return sessions
  return sessions.filter((session) => (session.title ?? "").toLowerCase().includes(query))
}

export function currentDialogSessionSearch<T extends SessionListItem>(input: {
  result: SessionListResult<T> | undefined
  key: string
  query: string
}) {
  if (!input.result) return undefined
  if (input.result.key !== input.key) return undefined
  if (input.result.query !== input.query) return undefined
  return input.result.sessions
}

export function DialogSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const project = useProject()
  const { theme } = useTheme()
  const sdk = useSDK()
  const local = useLocal()
  const toast = useToast()
  const [toDelete, setToDelete] = createSignal<string>()
  const [filterText, setFilterText] = createSignal("")
  const [serverSearch, setServerSearch] = createDebouncedSignal("", 150)
  const deleteHint = useCommandShortcut("session.delete")
  const quickSwitch1 = useCommandShortcut("session.quick_switch.1")
  const quickSwitch9 = useCommandShortcut("session.quick_switch.9")
  const sessionFilter = createMemo(() => sync.session.query())
  const query = createMemo(() => filterText().trim())
  const searchKey = createMemo(() => createDialogSessionListKey({ query: serverSearch(), filter: sessionFilter() }))
  const currentSearchKey = createMemo(() => createDialogSessionListKey({ query: query(), filter: sessionFilter() }))
  const browseKey = createMemo(() => createDialogSessionListKey({ query: "", filter: sessionFilter() }))

  function onFilter(value: string) {
    setFilterText(value)
    setServerSearch(value.trim())
  }

  const [searchResults, { refetch: refetchSearch }] = createResource(
    () => ({ key: searchKey(), query: serverSearch(), filter: sessionFilter() }),
    async (input) => {
      if (!input.query) return undefined
      const result = await sdk.client.session.list(createDialogSessionListQuery(input))
      return { key: input.key, query: input.query, sessions: result.data ?? [] }
    },
  )

  const [browseResults, { refetch: refetchBrowse }] = createResource(
    () => ({ key: browseKey(), filter: sessionFilter() }),
    async (input) => {
      const result = await sdk.client.session.list(createDialogSessionListQuery({ query: "", filter: input.filter }))
      return { key: input.key, query: "", sessions: result.data ?? [] }
    },
  )

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const currentRootSessionID = createMemo(() => {
    const current = currentSessionID()
    if (!current) return undefined
    return sync.session.get(current)?.parentID ?? current
  })
  const sessions = createMemo(() => {
    const searchResult = searchResults()

    return createDialogSessionItems({
      browse: browseResults()?.sessions,
      remote: currentDialogSessionSearch({ result: searchResult, key: currentSearchKey(), query: query() }),
      synced: sync.data.session,
      pinned: local.session.pinned(),
      current: currentRootSessionID(),
      query: query(),
    })
  })

  function recover(session: NonNullable<ReturnType<typeof sessions>[number]>) {
    const workspace = project.workspace.get(session.workspaceID!)
    const list = () => dialog.replace(() => <DialogSessionList />)
    const warp = async (selection: WorkspaceSelection) => {
      const workspaceID = await (async () => {
        if (selection.type === "none") return null
        if (selection.type === "existing") return selection.workspaceID
        let result
        try {
          result = await sdk.client.experimental.workspace.create({ type: selection.workspaceType, branch: null })
        } catch (err) {
          toast.show({
            title: "Failed to create workspace",
            message: errorMessage(err),
            variant: "error",
          })
          return
        }
        const workspace = result?.data
        if (!workspace) {
          toast.show({
            title: "Failed to create workspace",
            message: errorMessage(result?.error ?? "no response"),
            variant: "error",
          })
          return
        }
        await project.workspace.sync()
        return workspace.id
      })()
      if (workspaceID === undefined) return
      await warpWorkspaceSession({
        dialog,
        sdk,
        sync,
        project,
        toast,
        sourceWorkspaceID: session.workspaceID,
        workspaceID,
        sessionID: session.id,
        copyChanges: false,
        done: list,
      })
    }
    dialog.replace(() => (
      <DialogSessionDeleteFailed
        session={session.title}
        workspace={workspace?.name ?? session.workspaceID!}
        onDone={list}
        onDelete={async () => {
          const current = currentSessionID()
          const info = current ? sync.data.session.find((item) => item.id === current) : undefined
          const result = await sdk.client.experimental.workspace.remove({ id: session.workspaceID! })
          if (result.error) {
            toast.show({
              variant: "error",
              title: "Failed to delete workspace",
              message: errorMessage(result.error),
            })
            return false
          }
          await project.workspace.sync()
          await sync.session.refresh()
          await refreshBrowse()
          if (query()) await refetchSearch()
          if (info?.workspaceID === session.workspaceID) {
            route.navigate({ type: "home" })
          }
          return true
        }}
        onRestore={() => {
          void openWorkspaceSelect({
            dialog,
            sdk,
            sync,
            project,
            toast,
            onSelect: (selection) => {
              void warp(selection)
            },
          })
          return false
        }}
      />
    ))
  }

  const [browseOrder, setBrowseOrder] = createSignal<{ key: string; ids: string[] }>()
  createEffect(() => {
    const current = browseOrder()
    const next = nextDialogSessionBrowseOrder({ current, result: browseResults() })
    if (next !== current) setBrowseOrder(next)
  })
  const browsePending = createMemo(() => !query() && browseResults.loading && browseOrder() === undefined)
  const refreshBrowse = async () => {
    await refetchBrowse()
  }

  const quickSwitchHint = createMemo(() => {
    const first = quickSwitch1()
    const last = quickSwitch9()
    if (!first || !last) return undefined
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
        .filter((x) => x.parentID === undefined)
        .map((x) => [x.id, x]),
    )

    const searching = query().length > 0
    const rootOrder = browseOrder()?.ids ?? orderDialogSessionsByRecency(sessions())
    const current = currentRootSessionID()
    const displayOrder = searching
      ? orderDialogSessionsByRecency(sessions())
      : current && sessionMap.has(current) && !rootOrder.includes(current)
        ? [...rootOrder, current]
        : rootOrder

    const pinned = local.session.pinned().filter((id) => sessionMap.has(id))
    const pinnedSet = new Set(pinned)
    const slotByID = new Map<string, number>(local.session.slots().map((id, i) => [id, i + 1]))

    function buildOption(id: string, category: string) {
      const x = sessionMap.get(id)
      if (!x) return undefined
      const directory = x.path
        ? x.directory.endsWith(x.path)
          ? x.directory.slice(0, -x.path.length).replace(/\/$/, "")
          : undefined
        : x.directory
      const footer =
        directory && directory !== project.data.project.mainDir ? Locale.truncate(path.basename(directory), 20) : ""

      const isDeleting = toDelete() === x.id
      const status = sync.data.session_status?.[x.id]
      const isWorking = status?.type === "busy" || status?.type === "retry"
      const slot = slotByID.get(x.id)
      const gutter = isWorking
        ? () => <Spinner />
        : slot !== undefined
          ? () => <text fg={theme.accent}>{slot}</text>
          : undefined
      return {
        title: isDeleting ? `Press ${deleteHint()} again to confirm` : x.title,
        bg: isDeleting ? theme.error : undefined,
        value: x.id,
        category,
        footer,
        gutter,
      }
    }

    const remaining = displayOrder
      .filter((id) => !pinnedSet.has(id))
      .map((id) => {
        const x = sessionMap.get(id)
        if (!x) return undefined
        const label = new Date(x.time.updated).toDateString()
        return buildOption(id, label === today ? "Today" : label)
      })
      .filter((x) => x !== undefined)

    return [...pinned.map((id) => buildOption(id, "Pinned")).filter((x) => x !== undefined), ...remaining]
  })
  const loading = createMemo(() => browsePending() && options().length === 0)
  const selectOptions = createMemo(() =>
    loading() ? [{ title: "Loading sessions...", value: "", disabled: true }] : options(),
  )

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Sessions"
      options={selectOptions()}
      skipFilter={true}
      locked={loading()}
      current={currentRootSessionID()}
      onFilter={onFilter}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      actions={[
        {
          command: "session.pin.toggle",
          title: "pin/unpin",
          onTrigger: (option: { value: string }) => {
            local.session.togglePin(option.value)
          },
        },
        {
          command: "session.delete",
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              const session = sessions().find((item) => item.id === option.value)
              const status = session?.workspaceID ? project.workspace.status(session.workspaceID) : undefined

              try {
                const result = await sdk.client.session.delete({
                  sessionID: option.value,
                })
                if (result.error) {
                  if (session?.workspaceID) {
                    recover(session)
                  } else {
                    toast.show({
                      variant: "error",
                      title: "Failed to delete session",
                      message: errorMessage(result.error),
                    })
                  }
                  setToDelete(undefined)
                  return
                }
              } catch (err) {
                if (session?.workspaceID) {
                  recover(session)
                } else {
                  toast.show({
                    variant: "error",
                    title: "Failed to delete session",
                    message: errorMessage(err),
                  })
                }
                setToDelete(undefined)
                return
              }
              if (status && status !== "connected") {
                await sync.session.refresh()
              }
              await refreshBrowse()
              if (query()) await refetchSearch()
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
        {
          command: "session.rename",
          title: "rename",
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
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

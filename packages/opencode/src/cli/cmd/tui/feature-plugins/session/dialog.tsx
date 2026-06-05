import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useProject } from "@tui/context/project"
import { useTheme } from "@tui/context/theme"
import { useSDK } from "@tui/context/sdk"
import { useLocal } from "@tui/context/local"
import { useToast } from "@tui/ui/toast"
import { useCommandShortcut } from "@tui/keymap"
import { createEffect, createMemo, createResource, createSignal, on, Show, untrack } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { Spinner } from "@tui/component/spinner"
import { DialogSessionRename } from "@tui/component/dialog-session-rename"
import { DialogSessionDeleteFailed } from "@tui/component/dialog-session-delete-failed"
import {
  openWorkspaceSelect,
  type WorkspaceSelection,
  warpWorkspaceSession,
} from "@tui/component/dialog-workspace-create"
import { createDebouncedSignal } from "@tui/util/signal"
import { errorMessage } from "@/util/error"
import { SessionPreviewPane, createLeadingTrailingSignal } from "./preview-pane"
import { relativeTime } from "./util"

export function SessionSwitcherDialog() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const project = useProject()
  const { theme } = useTheme()
  const sdk = useSDK()
  const local = useLocal()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)
  const deleteHint = useCommandShortcut("session.delete")
  const quickSwitch1 = useCommandShortcut("session.quick_switch.1")
  const quickSwitch9 = useCommandShortcut("session.quick_switch.9")
  let select: DialogSelectRef<string> | undefined

  const [searchResults, { refetch }] = createResource(
    () => ({ query: search(), filter: sync.session.query() }),
    async (input) => {
      if (!input.query) return undefined
      const result = await sdk.client.session.list({ search: input.query, limit: 30, ...input.filter })
      return result.data ?? []
    },
  )

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const sessions = createMemo(() => searchResults() ?? sync.data.session)
  const [focusedSession, setFocusedSession, scheduleFocused] = createLeadingTrailingSignal<string | undefined>(
    undefined,
    150,
  )
  const focusedSessionInfo = createMemo(() => {
    const id = focusedSession()
    if (!id) return undefined
    return sessions().find((session) => session.id === id) ?? sync.data.session.find((session) => session.id === id)
  })

  function recoverFailed(session: NonNullable<ReturnType<typeof sessions>[number]>) {
    const workspace = project.workspace.get(session.workspaceID!)
    const list = () => dialog.replace(() => <SessionSwitcherDialog />)
    const warp = async (selection: WorkspaceSelection) => {
      const workspaceID = await (async () => {
        if (selection.type === "none") return null
        if (selection.type === "existing") return selection.workspaceID
        const result = await sdk.client.experimental.workspace
          .create({ type: selection.workspaceType, branch: null })
          .catch(() => undefined)
        const created = result?.data
        if (!created) {
          toast.show({
            message: `Failed to create workspace: ${errorMessage(result?.error ?? "no response")}`,
            variant: "error",
          })
          return
        }
        await project.workspace.sync()
        return created.id
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
          if (search()) await refetch()
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

  function orderByRecency(sessionsList: NonNullable<ReturnType<typeof sessions>>) {
    return sessionsList
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((x) => x.id)
  }

  const [browseOrder] = createSignal<string[]>(orderByRecency(sync.data.session))

  const quickSwitchHint = createMemo(() => {
    const first = quickSwitch1()
    const last = quickSwitch9()
    if (!first || !last) return undefined
    return quickSwitchRange(first, last)
  })
  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const today = new Date().toDateString()
    const sessionMap = new Map(
      sessions()
        .filter((x) => x.parentID === undefined)
        .map((x) => [x.id, x]),
    )

    const searchResult = searchResults()
    const displayOrder = searchResult ? orderByRecency(searchResult) : browseOrder()

    const pinned = local.session.pinned().filter((id) => sessionMap.has(id))
    const pinnedSet = new Set(pinned)
    const slotByID = new Map<string, number>(local.session.slots().map((id, i) => [id, i + 1]))

    function buildOption(id: string, category: string): DialogSelectOption<string> | undefined {
      const x = sessionMap.get(id)
      if (!x) return undefined
      const workspace = x.workspaceID ? project.workspace.get(x.workspaceID) : undefined

      const footer = relativeTime(x.time.updated)
      const isWorktree = workspace?.type === "worktree"

      const isDeleting = toDelete() === x.id
      const status = sync.data.session_status?.[x.id]
      const isWorking = status?.type === "busy" || status?.type === "retry"
      const slot = slotByID.get(x.id)
      const gutter =
        slot !== undefined || isWorking
          ? () => (
              <box flexDirection="row" gap={1}>
                <Show when={slot !== undefined}>
                  <text fg={theme.accent}>{slot}</text>
                </Show>
                <Show when={isWorking}>
                  <Spinner />
                </Show>
              </box>
            )
          : undefined
      const titleText = isDeleting ? `Press ${deleteHint()} again to confirm` : isWorktree ? `⎇ ${x.title}` : x.title
      return {
        title: titleText,
        bg: isDeleting ? theme.error : undefined,
        value: x.id,
        category,
        categoryView:
          category === "Pinned" ? (
            <text>
              <span style={{ fg: theme.accent }}>
                <b>Pinned</b>
              </span>
              <Show when={quickSwitchHint()}>
                {(hint) => <span style={{ fg: theme.textMuted }}> · switch {hint()}</span>}
              </Show>
            </text>
          ) : undefined,
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
      .filter((x): x is DialogSelectOption<string> => x !== undefined)

    return [
      ...pinned.map((id) => buildOption(id, "Pinned")).filter((x): x is DialogSelectOption<string> => x !== undefined),
      ...remaining,
    ]
  })

  createEffect(
    on([options, currentSessionID], ([items, current]) => {
      const selected = untrack(() => select?.selected)
      const selectedID = selected && items.some((item) => item.value === selected.value) ? selected.value : undefined
      const currentID = current && items.some((item) => item.value === current) ? current : undefined
      setFocusedSession(selectedID ?? currentID ?? items[0]?.value)
    }),
  )

  const showPreview = createMemo(() => dimensions().width >= 100)
  const height = createMemo(() => Math.max(8, Math.floor(dimensions().height / 2) - 4))

  createEffect(() => {
    dialog.setSize(showPreview() ? "xlarge" : "large")
  })

  const list = (
    <DialogSelect
      ref={(value) => (select = value)}
      title="Sessions"
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={(option) => {
        setToDelete(undefined)
        scheduleFocused(option.value)
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
            queueMicrotask(() => select?.moveTo(option.value))
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
                    recoverFailed(session)
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
                  recoverFailed(session)
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
              if (search()) await refetch()
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
    />
  )

  return (
    <box flexDirection="row" width="100%" height={height()}>
      <box flexBasis={showPreview() ? 68 : undefined} flexGrow={showPreview() ? 0 : 1} flexShrink={0}>
        {list}
      </box>
      <Show when={showPreview()}>
        <box width={1} height={height() - 1} flexShrink={0} border={["left"]} borderColor={theme.borderSubtle} />
        <box flexGrow={1} flexShrink={1} flexDirection="column">
          <SessionPreviewPane sessionID={focusedSession} session={focusedSessionInfo} />
        </box>
      </Show>
    </box>
  )
}

function quickSwitchRange(first: string, last: string) {
  const prefix = first.slice(0, -1)
  if (first.endsWith("1") && last === `${prefix}9`) return `${prefix}1-9`
  return `${first} through ${last}`
}

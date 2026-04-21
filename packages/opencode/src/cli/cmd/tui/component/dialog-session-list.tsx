import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createEffect, createMemo, createResource, createSignal, onMount } from "solid-js"
import { Locale } from "@/util"
import { useProject } from "@tui/context/project"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { Flag } from "@/flag/flag"
import { DialogSessionRename } from "./dialog-session-rename"
import { Keybind } from "@/util"
import { createDebouncedSignal } from "../util/signal"
import { useToast } from "../ui/toast"
import { DialogWorkspaceCreate, openWorkspaceSession, restoreWorkspaceSession } from "./dialog-workspace-create"
import { Spinner } from "./spinner"
import { errorMessage } from "@/util/error"
import { DialogSessionDeleteFailed } from "./dialog-session-delete-failed"
import { createStore } from "solid-js/store"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { deriveSessionRecap, type SessionRecap } from "./session-recap"

type WorkspaceStatus = "connected" | "connecting" | "disconnected" | "error"

export function DialogSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const project = useProject()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const sdk = useSDK()
  const toast = useToast()
  const [toDelete, setToDelete] = createSignal<string>()
  const [activeSessionID, setActiveSessionID] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)
  const [recapBySession, setRecapBySession] = createStore<
    Record<
      string,
      {
        state: "loading" | "ready" | "error"
        version?: string
        recap?: SessionRecap
      }
    >
  >({})

  const loadingRecap = new Set<string>()

  const [searchResults, { refetch }] = createResource(search, async (query) => {
    if (!query) return undefined
    const result = await sdk.client.session.list({ search: query, limit: 30 })
    return result.data ?? []
  })

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const sessions = createMemo(() => searchResults() ?? sync.data.session)

  const sessionStatus = createMemo<Record<string, SessionStatus>>(() => sync.data.session_status ?? {})

  function recapVersion(sessionID: string) {
    const session = sessions().find((item) => item.id === sessionID)
    const updated = session?.time.updated ?? 0
    const status = sessionStatus()[sessionID]
    const state =
      !status ? "idle" : "attempt" in status ? `${status.type}:${status.attempt}:${status.message ?? ""}` : status.type
    return `${updated}:${state}`
  }

  async function ensureRecap(sessionID: string | undefined) {
    if (!sessionID) return
    if (loadingRecap.has(sessionID)) return
    const version = recapVersion(sessionID)
    if (recapBySession[sessionID]?.state === "ready" && recapBySession[sessionID]?.version === version) return

    loadingRecap.add(sessionID)
    setRecapBySession(sessionID, {
      state: "loading",
      version,
    })

    try {
      const [messagesResult, todosResult] = await Promise.all([
        sdk.client.session.messages({ sessionID, limit: 100 }),
        sdk.client.session.todo({ sessionID }),
      ])
      const recap = deriveSessionRecap({
        messages: messagesResult.data ?? [],
        todos: todosResult.data ?? [],
        status: sessionStatus()[sessionID],
      })
      setRecapBySession(sessionID, {
        state: "ready",
        version,
        recap,
      })
    } catch {
      setRecapBySession(sessionID, {
        state: "error",
        version,
      })
    } finally {
      loadingRecap.delete(sessionID)
    }
  }

  createEffect(() => {
    const current = currentSessionID()
    if (!current) return
    setActiveSessionID(current)
    void ensureRecap(current)
  })

  createEffect(() => {
    const active = activeSessionID()
    if (!active) return
    void ensureRecap(active)
  })

  function createWorkspace() {
    dialog.replace(() => (
      <DialogWorkspaceCreate
        onSelect={(workspaceID) =>
          openWorkspaceSession({
            dialog,
            route,
            sdk,
            sync,
            toast,
            workspaceID,
          })
        }
      />
    ))
  }

  function recover(session: NonNullable<ReturnType<typeof sessions>[number]>) {
    const workspace = project.workspace.get(session.workspaceID!)
    const list = () => dialog.replace(() => <DialogSessionList />)
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
          dialog.replace(() => (
            <DialogWorkspaceCreate
              onSelect={(workspaceID) =>
                restoreWorkspaceSession({
                  dialog,
                  sdk,
                  sync,
                  project,
                  toast,
                  workspaceID,
                  sessionID: session.id,
                  done: list,
                })
              }
            />
          ))
          return false
        }}
      />
    ))
  }

  const options = createMemo(() => {
    const today = new Date().toDateString()
    return sessions()
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => {
        const updatedDay = new Date(b.time.updated).setHours(0, 0, 0, 0) - new Date(a.time.updated).setHours(0, 0, 0, 0)
        if (updatedDay !== 0) return updatedDay
        return b.time.created - a.time.created
      })
      .map((x) => {
        const workspace = x.workspaceID ? project.workspace.get(x.workspaceID) : undefined

        let workspaceStatus: WorkspaceStatus | null = null
        if (x.workspaceID) {
          workspaceStatus = project.workspace.status(x.workspaceID) || "error"
        }

        let footer = ""
        if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
          if (x.workspaceID) {
            let desc = "unknown"
            if (workspace) {
              desc = `${workspace.type}: ${workspace.name}`
            }

            footer = (
              <>
                {desc}{" "}
                <span
                  style={{
                    fg: workspaceStatus === "connected" ? theme.success : theme.error,
                  }}
                >
                  ●
                </span>
              </>
            )
          }
        } else {
          footer = Locale.time(x.time.updated)
        }

        const date = new Date(x.time.updated)
        let category = date.toDateString()
        if (category === today) {
          category = "Today"
        }
        const isDeleting = toDelete() === x.id
        const status = sync.data.session_status?.[x.id]
        const isWorking = status?.type === "busy"
        return {
          title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : x.title,
          bg: isDeleting ? theme.error : undefined,
          value: x.id,
          category,
          footer,
          gutter: isWorking ? <Spinner /> : undefined,
        }
      })
  })

  createEffect(() => {
    if (activeSessionID()) return
    const first = options()[0]?.value
    if (!first) return
    setActiveSessionID(first)
    void ensureRecap(first)
  })

  onMount(() => {
    dialog.setSize("large")
  })

  const selectedRecap = createMemo(() => {
    const sessionID = activeSessionID()
    if (!sessionID) return
    return recapBySession[sessionID]
  })

  return (
    <DialogSelect
      title="Sessions"
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={(option) => {
        setToDelete(undefined)
        setActiveSessionID(option.value)
      }}
      selectedDetails={() => {
        const sessionID = activeSessionID()
        if (!sessionID) return
        const recap = selectedRecap()
        return (
          <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="column">
            <text fg={theme.accent}>
              <b>Resume Aid</b>
            </text>
            {recap?.state === "loading" && (
              <text fg={theme.textMuted} paddingTop={1}>
                Loading recap...
              </text>
            )}
            {recap?.state === "error" && (
              <text fg={theme.warning} paddingTop={1}>
                Recap unavailable.
              </text>
            )}
            {recap?.state === "ready" && recap.recap && (
              <box flexDirection="column" paddingTop={1}>
                <text fg={theme.textMuted}>
                  <b>Done:</b> {recap.recap.done}
                </text>
                <text fg={theme.textMuted}>
                  <b>Blocked:</b> {recap.recap.blocked}
                </text>
                <text fg={theme.textMuted}>
                  <b>Next:</b> {recap.recap.next}
                </text>
              </box>
            )}
          </box>
        )
      }}
      onSelect={(option) => {
        setActiveSessionID(option.value)
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
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
              if (search()) await refetch()
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
        {
          keybind: keybind.all.session_rename?.[0],
          title: "rename",
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
        {
          keybind: Keybind.parse("ctrl+w")[0],
          title: "new workspace",
          side: "right",
          disabled: !Flag.OPENCODE_EXPERIMENTAL_WORKSPACES,
          onTrigger: () => {
            createWorkspace()
          },
        },
      ]}
    />
  )
}

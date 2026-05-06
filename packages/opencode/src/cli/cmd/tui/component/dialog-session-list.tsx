import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createResource, createSignal, onMount, type JSX } from "solid-js"
import { Locale } from "@/util/locale"
import { useProject } from "@tui/context/project"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { Flag } from "@opencode-ai/core/flag/flag"
import { DialogSessionRename } from "./dialog-session-rename"
import { createDebouncedSignal } from "../util/signal"
import { useToast } from "../ui/toast"
import { openWorkspaceSelect, type WorkspaceSelection, warpWorkspaceSession } from "./dialog-workspace-create"
import { Spinner } from "./spinner"
import { errorMessage } from "@/util/error"
import { DialogSessionDeleteFailed } from "./dialog-session-delete-failed"
import { WorkspaceLabel } from "./workspace-label"

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
  const [search, setSearch] = createDebouncedSignal("", 150)

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

  function recover(session: NonNullable<ReturnType<typeof sessions>[number]>) {
    const workspace = project.workspace.get(session.workspaceID!)
    const list = () => dialog.replace(() => <DialogSessionList />)
    const warp = async (selection: WorkspaceSelection) => {
      const workspaceID = await (async () => {
        if (selection.type === "none") return null
        if (selection.type === "existing") return selection.workspaceID
        const result = await sdk.client.experimental.workspace
          .create({ type: selection.workspaceType, branch: null })
          .catch(() => undefined)
        const workspace = result?.data
        if (!workspace) {
          toast.show({
            message: `Failed to create workspace: ${errorMessage(result?.error ?? "no response")}`,
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
        workspaceID,
        sessionID: session.id,
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

        let footer: JSX.Element | string = ""
        if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
          if (x.workspaceID) {
            footer = workspace ? (
              <WorkspaceLabel
                type={workspace.type}
                name={workspace.name}
                status={project.workspace.status(x.workspaceID) ?? "error"}
              />
            ) : (
              <WorkspaceLabel type="unknown" name={x.workspaceID} status="error" />
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
          gutter: isWorking ? () => <Spinner /> : undefined,
        }
      })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Sessions"
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={setSearch}
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
      ]}
    />
  )
}

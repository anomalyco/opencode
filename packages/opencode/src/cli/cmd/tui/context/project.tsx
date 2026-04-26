import { batch } from "solid-js"
import type { Path, Workspace } from "@opencode-ai/sdk/v2"
import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

type WorkspaceStatus = "connected" | "connecting" | "disconnected" | "error"

export const { use: useProject, provider: ProjectProvider } = createSimpleContext({
  name: "Project",
  init: () => {
    const sdk = useSDK()

    const defaultPath = {
      home: "",
      state: "",
      config: "",
      worktree: "",
      directory: sdk.directory ?? "",
    } satisfies Path

    const [store, setStore] = createStore({
      project: {
        id: undefined as string | undefined,
      },
      instance: {
        path: defaultPath,
      },
      workspace: {
        current: undefined as string | undefined,
        list: [] as Workspace[],
        status: {} as Record<string, WorkspaceStatus>,
      },
    })

    async function sync() {
      const workspace = store.workspace.current
      const [path, project] = await Promise.all([
        sdk.client.path.get({ workspace }),
        sdk.client.project.current({ workspace }),
      ])

      batch(() => {
        setStore("instance", "path", reconcile(path.data || defaultPath))
        setStore("project", "id", project.data?.id)
      })
    }

    async function syncWorkspace() {
      const listed = await sdk.client.experimental.workspace.list().catch(() => undefined)
      if (!listed?.data) return
      const status = await sdk.client.experimental.workspace.status().catch(() => undefined)
      const next = Object.fromEntries((status?.data ?? []).map((item) => [item.workspaceID, item.status]))

      batch(() => {
        setStore("workspace", "list", reconcile(listed.data))
        setStore("workspace", "status", reconcile(next))
        if (!listed.data.some((item) => item.id === store.workspace.current)) {
          setStore("workspace", "current", undefined)
        }
      })
    }

    sdk.event.on("event", (event) => {
      if (event.payload.type === "workspace.status") {
        setStore("workspace", "status", event.payload.properties.workspaceID, event.payload.properties.status)
      }
    })

    return {
      data: store,
      project() {
        return store.project.id
      },
      instance: {
        path() {
          return store.instance.path
        },
        directory() {
          return store.instance.path.directory
        },
      },
      workspace: {
        current() {
          return store.workspace.current
        },
        set(next?: string | null) {
          const workspace = next ?? undefined
          if (store.workspace.current === workspace) return
          setStore("workspace", "current", workspace)
        },
        list() {
          return store.workspace.list
        },
        get(workspaceID: string) {
          return store.workspace.list.find((item) => item.id === workspaceID)
        },
        status(workspaceID: string) {
          return store.workspace.status[workspaceID]
        },
        statuses() {
          return store.workspace.status
        },
        sync: syncWorkspace,
      },
      sync,
    }
  },
})

import { createSimpleContext } from "@opencode-ai/ui/context"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { batch, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "./global-sdk"
import { useLayout } from "./layout"
import { Persist, persisted } from "@/utils/persist"

type WorkspaceFolder = { path: string; name?: string }

type Workspace = {
  id: string
  name: string
  filePath: string
  folders: WorkspaceFolder[]
}

type WorkspaceState = {
  workspaces: Workspace[]
  currentWorkspaceId: string | undefined
}

export const { use: useWorkspace, provider: WorkspaceProvider } = createSimpleContext({
  name: "Workspace",
  init: () => {
    const globalSdk = useGlobalSDK()
    const layout = useLayout()

    const [store, setStore] = persisted(
      Persist.global("workspace", ["workspace.v1"]),
      createStore<WorkspaceState>({
        workspaces: [],
        currentWorkspaceId: undefined,
      }),
    )

    const currentWorkspace = createMemo(() =>
      store.workspaces.find((w) => w.id === store.currentWorkspaceId),
    )

    async function create(name: string, folders: WorkspaceFolder[]): Promise<Workspace | undefined> {
      const workspace = await globalSdk.client.workspace.create({ name, folders }).then((result) => result.data)
      if (!workspace) return
      setStore("workspaces", (prev) => [workspace, ...prev])
      return workspace
    }

    async function open(workspaceId: string): Promise<void> {
      const workspace = store.workspaces.find((w) => w.id === workspaceId)
      if (!workspace) {
        const fetched = await globalSdk.client.workspace.get({ id: workspaceId }).then((result) => result.data)
        if (!fetched) return
        setStore("workspaces", (prev) => {
          const exists = prev.find((w) => w.id === fetched.id)
          if (exists) return prev
          return [...prev, fetched]
        })
        setStore("currentWorkspaceId", fetched.id)
        batch(() => {
          for (const folder of fetched.folders) {
            layout.projects.open(folder.path)
          }
        })
        return
      }

      setStore("currentWorkspaceId", workspaceId)
      batch(() => {
        for (const folder of workspace.folders) {
          layout.projects.open(folder.path)
        }
      })
    }

    function close(): void {
      setStore("currentWorkspaceId", undefined)
    }

    async function addFolder(
      workspaceId: string,
      folder: WorkspaceFolder,
    ): Promise<Workspace | undefined> {
      const updated = await globalSdk.client.workspace
        .update({
          id: workspaceId,
          body: { action: "addFolder", folder },
        })
        .then((result) => result.data)
      if (!updated) return
      setStore(
        "workspaces",
        (w) => w.id === workspaceId,
        (w) => ({ ...w, folders: updated.folders }),
      )
      return updated
    }

    async function removeFolder(workspaceId: string, path: string): Promise<Workspace | undefined> {
      const updated = await globalSdk.client.workspace
        .update({
          id: workspaceId,
          body: { action: "removeFolder", path },
        })
        .then((result) => result.data)
      if (!updated) return
      setStore(
        "workspaces",
        (w) => w.id === workspaceId,
        (w) => ({ ...w, folders: updated.folders }),
      )
      return updated
    }

    async function createSession(title: string): Promise<Session | undefined> {
      const workspace = currentWorkspace()
      const directory = workspace?.folders[0]?.path
      if (!workspace || !directory) return
      return globalSdk
        .createClient({
          directory,
          multiRootWorkspaceID: workspace.id,
          throwOnError: true,
        })
        .session.create({
          title,
          multiRootWorkspaceID: workspace.id,
        })
        .then((result) => result.data)
    }

    return {
      current: currentWorkspace,
      workspaces: {
        list: () => store.workspaces,
        current: () => currentWorkspace(),
        open,
        create,
        close,
        addFolder,
        removeFolder,
        createSession,
      },
    }
  },
})

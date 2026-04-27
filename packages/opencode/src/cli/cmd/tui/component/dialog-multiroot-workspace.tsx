// TUI components run outside the Effect runtime, so we use node:path directly
// instead of the Effect Path.Path service.
import path from "node:path"
import { homedir } from "os"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useRoute } from "@tui/context/route"
import { createMemo, createResource, createSignal } from "solid-js"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useProject } from "../context/project"
import { errorMessage } from "@/util/error"
import * as Log from "@opencode-ai/core/util/log"

type Workspace = {
  id: string
  name: string
  filePath: string
  folders: Array<{ path: string; name?: string }>
  time: { created: number; updated: number }
}

const NEW_WORKSPACE_VALUE = "__new_workspace__"
const ADD_FOLDER_VALUE = "__add_folder_to_ws__"
const BACK_VALUE = "__back_to_workspaces__"

const log = Log.Default.clone().tag("service", "tui-multiroot-workspace")

function expandPath(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  return trimmed.startsWith("~") ? trimmed.replace("~", homedir()) : trimmed
}

async function fetchWorkspaces(sdk: ReturnType<typeof useSDK>): Promise<Workspace[]> {
  const res = await Promise.race([
    sdk.fetch(new URL("/workspace", sdk.url)),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Request timed out after 5s")), 5000)),
  ])
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return (await res.json()) as Workspace[]
}

export function DialogMultiRootWorkspaceList() {
  const dialog = useDialog()
  const route = useRoute()
  const sdk = useSDK()
  const toast = useToast()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const project = useProject()
  const [toDelete, setToDelete] = createSignal<string>()

  const [workspaces, { refetch }] = createResource(async () => {
    try {
      const data = await fetchWorkspaces(sdk)
      log.info("workspaces loaded", { count: data.length })
      return data
    } catch (err) {
      log.error("failed to load workspaces", { error: errorMessage(err) })
      throw err
    }
  })

  const deleteKey = () => keybind.all.session_delete?.[0]
  const deleteLabel = () => `Press ${keybind.print("session_delete")} again to confirm`

  const reopenList = () => dialog.replace(() => <DialogMultiRootWorkspaceList />)

  const openFolder = async (workspace: Workspace) => {
    log.info("setting active workspace", { workspaceID: workspace.id })
    dialog.clear()
    try {
      project.multiRootWorkspace.set(workspace.id)
      await project.multiRootWorkspace.sync().catch((err) => {
        log.error("sync failed", { error: errorMessage(err) })
        toast.show({ message: `Sync failed: ${errorMessage(err)}`, variant: "error" })
      })
      await project.sync()
      toast.show({
        message: `Workspace active: ${workspace.name} (${workspace.folders.length} folder${workspace.folders.length === 1 ? "" : "s"})`,
        variant: "success",
      })
    } catch (err) {
      toast.show({
        message: `Failed to open workspace: ${errorMessage(err)}`,
        variant: "error",
      })
    }
  }

  const openWorkspace = (ws: Workspace) => {
    if (ws.folders.length === 0) {
      dialog.replace(() => <DialogMultiRootWorkspaceFolders workspace={ws} />)
      return
    }
    void openFolder(ws)
  }

  const handleNewWorkspace = async () => {
    const value = await DialogPrompt.show(dialog, "New workspace", {
      placeholder: "~/project or /path/to/project",
    })
    if (value === null) {
      // dismissed via escape; reopen list for convenience
      reopenList()
      return
    }
    const expanded = expandPath(value)
    if (!expanded) {
      toast.show({ message: "Folder path is required", variant: "error" })
      reopenList()
      return
    }
    await createWorkspaceFromFolder(expanded)
  }

  const createWorkspaceFromFolder = async (folderPath: string) => {
    const name = path.basename(folderPath) || "workspace"
    log.info("creating workspace from folder", { folderPath, name })
    toast.show({ message: `Creating workspace "${name}"...`, variant: "info" })

    try {
      const res = await sdk.fetch(new URL("/workspace", sdk.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          folders: [{ path: folderPath }],
        }),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        toast.show({
          message: `Failed to create workspace: ${text}`,
          variant: "error",
        })
        reopenList()
        return
      }

      const ws = (await res.json()) as Workspace
      log.info("workspace created", { id: ws.id, name: ws.name })
      await project.multiRootWorkspace.sync().catch((err) => {
        log.error("sync failed", { error: errorMessage(err) })
        toast.show({ message: `Sync failed: ${errorMessage(err)}`, variant: "error" })
      })
      await openFolder(ws)
    } catch (err) {
      toast.show({
        message: errorMessage(err),
        variant: "error",
      })
      reopenList()
    }
  }

  const deleteWorkspace = async (workspaceId: string) => {
    log.info("deleting workspace", { workspaceId })

    try {
      const res = await sdk.fetch(new URL(`/workspace/${workspaceId}`, sdk.url), {
        method: "DELETE",
      })

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        toast.show({
          message: `Failed to delete workspace: ${text}`,
          variant: "error",
        })
        return
      }

      log.info("workspace deleted", { workspaceId })
      toast.show({ message: "Workspace deleted", variant: "success" })
      if (project.multiRootWorkspace.current() === workspaceId) {
        project.multiRootWorkspace.set(undefined)
        // If current route is a session in this workspace, navigate home
        const currentRoute = route.data
        if (currentRoute.type === "session") {
          route.navigate({ type: "home" })
        }
      }
      await refetch()
      await project.multiRootWorkspace.sync().catch((err) => {
        log.error("sync failed", { error: errorMessage(err) })
        toast.show({ message: `Sync failed: ${errorMessage(err)}`, variant: "error" })
      })
    } catch (err) {
      toast.show({
        message: errorMessage(err),
        variant: "error",
      })
    }
  }

  const workspaceOptions = createMemo(() => {
    const list = workspaces() ?? []
    return list.map((ws) => {
      const isDeleting = toDelete() === ws.id
      return {
        title: isDeleting ? deleteLabel() : ws.name,
        value: ws.id,
        description: `${ws.folders.length} folder${ws.folders.length === 1 ? "" : "s"}`,
        bg: isDeleting ? theme.error : undefined,
      }
    })
  })

  return (
    <DialogSelect
      title="Workspaces"
      placeholder="Search workspaces..."
      options={[
        {
          title: "New workspace...",
          value: NEW_WORKSPACE_VALUE,
          description: "Create a workspace from a folder",
          category: "Actions",
        },
        ...workspaceOptions(),
      ]}
      onMove={() => setToDelete(undefined)}
      onSelect={(option) => {
        if (option.value === NEW_WORKSPACE_VALUE) {
          void handleNewWorkspace()
          return
        }
        const list = workspaces() ?? []
        const ws = list.find((w) => w.id === option.value)
        if (!ws) return
        setToDelete(undefined)
        openWorkspace(ws)
      }}
      keybind={[
        {
          keybind: deleteKey(),
          title: "delete",
          onTrigger: (option) => {
            if (option.value === NEW_WORKSPACE_VALUE) return
            if (toDelete() === option.value) {
              void deleteWorkspace(option.value as string)
              setToDelete(undefined)
              return
            }
            setToDelete(option.value as string)
          },
        },
      ]}
    />
  )
}

async function createSessionForFolder(
  sdk: ReturnType<typeof useSDK>,
  folderPath: string,
  multiRootWorkspaceID?: string,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-opencode-directory": folderPath,
  }
  if (multiRootWorkspaceID) headers["x-opencode-multiroot-workspace"] = multiRootWorkspaceID

  const body: Record<string, unknown> = {}
  if (multiRootWorkspaceID) body.multiRootWorkspaceID = multiRootWorkspaceID

  const res = await sdk.fetch(new URL("/session", sdk.url), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || res.statusText)
  }
  return (await res.json()) as { id: string }
}

export function DialogMultiRootWorkspaceFolders(props: { workspace: Workspace }) {
  const dialog = useDialog()
  const route = useRoute()
  const sdk = useSDK()
  const toast = useToast()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const project = useProject()
  const [workspace, setWorkspace] = createSignal<Workspace>(props.workspace)
  const [toDelete, setToDelete] = createSignal<string>()

  const deleteKey = () => keybind.all.session_delete?.[0]
  const deleteLabel = () => `Press ${keybind.print("session_delete")} again to confirm`

  const reopenList = () => dialog.replace(() => <DialogMultiRootWorkspaceList />)
  const reopenFolders = (ws: Workspace) => dialog.replace(() => <DialogMultiRootWorkspaceFolders workspace={ws} />)

  const openFolder = async (folderPath: string) => {
    const ws = workspace()
    log.info("opening folder", { folderPath, workspaceID: ws.id })
    dialog.clear()
    try {
      project.multiRootWorkspace.set(ws.id)
      await project.multiRootWorkspace.sync().catch((err) => {
        log.error("sync failed", { error: errorMessage(err) })
        toast.show({ message: `Sync failed: ${errorMessage(err)}`, variant: "error" })
      })
      const data = await createSessionForFolder(sdk, folderPath, ws.id)
      log.info("session created", { sessionID: data.id, multiRootWorkspaceID: ws.id })
      toast.show({
        message: `Opened ${folderPath} (workspace: ${ws.name})`,
        variant: "success",
      })
      route.navigate({ type: "session", sessionID: data.id })
    } catch (err) {
      toast.show({
        message: `Failed to create session: ${errorMessage(err)}`,
        variant: "error",
      })
    }
  }

  const handleAddFolder = async () => {
    const ws = workspace()
    const value = await DialogPrompt.show(dialog, `Add folder to "${ws.name}"`, {
      placeholder: "~/project or /path/to/project",
    })
    if (value === null) {
      reopenFolders(ws)
      return
    }
    const expanded = expandPath(value)
    if (!expanded) {
      toast.show({ message: "Folder path is required", variant: "error" })
      reopenFolders(ws)
      return
    }
    await addFolder(expanded)
  }

  const addFolder = async (folderPath: string) => {
    const ws = workspace()
    log.info("adding folder to workspace", { workspaceId: ws.id, folderPath })

    try {
      const res = await sdk.fetch(new URL(`/workspace/${ws.id}`, sdk.url), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addFolder",
          folder: { path: folderPath },
        }),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        toast.show({
          message: `Failed to add folder: ${text}`,
          variant: "error",
        })
        reopenFolders(ws)
        return
      }

      const updated = (await res.json()) as Workspace
      log.info("folder added", { workspaceId: ws.id, folderPath })
      await project.multiRootWorkspace.sync().catch((err) => {
        log.error("sync failed", { error: errorMessage(err) })
        toast.show({ message: `Sync failed: ${errorMessage(err)}`, variant: "error" })
      })
      reopenFolders(updated)
    } catch (err) {
      toast.show({
        message: errorMessage(err),
        variant: "error",
      })
      reopenFolders(ws)
    }
  }

  const removeFolder = async (folderPath: string) => {
    const ws = workspace()
    log.info("removing folder from workspace", { workspaceId: ws.id, folderPath })

    try {
      const res = await sdk.fetch(new URL(`/workspace/${ws.id}`, sdk.url), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "removeFolder",
          path: folderPath,
        }),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        toast.show({
          message: `Failed to remove folder: ${text}`,
          variant: "error",
        })
        return
      }

      const updated = (await res.json()) as Workspace
      log.info("folder removed", { workspaceId: ws.id, folderPath })
      setWorkspace(updated)
      await project.multiRootWorkspace.sync().catch((err) => {
        log.error("sync failed", { error: errorMessage(err) })
        toast.show({ message: `Sync failed: ${errorMessage(err)}`, variant: "error" })
      })
    } catch (err) {
      toast.show({
        message: errorMessage(err),
        variant: "error",
      })
    }
  }

  const folderOptions = createMemo(() => {
    const ws = workspace()
    const list = ws.folders.map((f) => {
      const isDeleting = toDelete() === f.path
      return {
        title: isDeleting ? deleteLabel() : f.name ?? f.path,
        value: f.path,
        description: f.path,
        bg: isDeleting ? theme.error : undefined,
      }
    })
    list.push({
      title: "Add folder...",
      value: ADD_FOLDER_VALUE,
      description: "Add another folder to this workspace",
      bg: undefined,
    })
    list.push({
      title: "← Back to workspaces",
      value: BACK_VALUE,
      description: "Return to the workspace list",
      bg: undefined,
    })
    return list
  })

  return (
    <DialogSelect
      title={`${workspace().name} — Select folder`}
      placeholder="Search folders..."
      options={folderOptions()}
      onMove={() => setToDelete(undefined)}
      onSelect={(option) => {
        if (option.value === BACK_VALUE) {
          setToDelete(undefined)
          reopenList()
          return
        }
        if (option.value === ADD_FOLDER_VALUE) {
          void handleAddFolder()
          return
        }
        void openFolder(option.value)
      }}
      keybind={[
        {
          keybind: deleteKey(),
          title: "remove folder",
          onTrigger: (option) => {
            if (option.value === BACK_VALUE || option.value === ADD_FOLDER_VALUE) return
            if (toDelete() === option.value) {
              void removeFolder(option.value as string)
              setToDelete(undefined)
              return
            }
            setToDelete(option.value as string)
          },
        },
      ]}
    />
  )
}

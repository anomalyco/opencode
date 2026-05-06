import type { Workspace } from "@opencode-ai/sdk/v2"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useSync } from "@tui/context/sync"
import { useProject } from "@tui/context/project"
import { createMemo, createSignal, onMount } from "solid-js"
import { errorMessage } from "@/util/error"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"

type Adapter = {
  type: string
  name: string
  description: string
}

export type WorkspaceSelection =
  | {
      type: "none"
    }
  | {
      type: "new"
      workspaceType: string
      workspaceName: string
    }
  | {
      type: "existing"
      workspaceID: string
      workspaceType: string
      workspaceName: string
    }

type WorkspaceSelectValue = WorkspaceSelection | { type: "existing-list" }
type ExistingWorkspaceSelectValue = { workspace: Workspace }

async function loadWorkspaceAdapters(input: {
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
}) {
  const dir = input.sync.path.directory || input.sdk.directory
  const url = new URL("/experimental/workspace/adapter", input.sdk.url)
  if (dir) url.searchParams.set("directory", dir)
  const res = await input.sdk
    .fetch(url)
    .then((x) => x.json() as Promise<Adapter[]>)
    .catch(() => undefined)
  if (res) return res
  input.toast.show({
    message: "Failed to load workspace adapters",
    variant: "error",
  })
}

export async function openWorkspaceSelect(input: {
  dialog: ReturnType<typeof useDialog>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
  onSelect: (selection: WorkspaceSelection) => Promise<void> | void
}) {
  input.dialog.clear()
  const adapters = await loadWorkspaceAdapters(input)
  if (!adapters) return
  input.dialog.replace(() => <DialogWorkspaceSelect adapters={adapters} onSelect={input.onSelect} />)
}

export async function warpWorkspaceSession(input: {
  dialog: ReturnType<typeof useDialog>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  project: ReturnType<typeof useProject>
  toast: ReturnType<typeof useToast>
  workspaceID: string | null
  sessionID: string
  done?: () => void
}): Promise<boolean> {
  const result = await input.sdk.client.experimental.workspace
    .warp({
      id: input.workspaceID ?? undefined,
      sessionID: input.sessionID,
    })
    .catch(() => undefined)
  if (!result?.data) {
    input.toast.show({
      message: `Failed to warp session: ${errorMessage(result?.error ?? "no response")}`,
      variant: "error",
    })
    return false
  }

  input.project.workspace.set(input.workspaceID)

  await input.sync.bootstrap({ fatal: false }).catch(() => undefined)

  await Promise.all([input.project.workspace.sync(), input.sync.session.refresh()])

  input.done?.()
  if (input.done) return true
  input.dialog.clear()
  return true
}

export function DialogWorkspaceSelect(props: {
  adapters?: Adapter[]
  onSelect: (selection: WorkspaceSelection) => Promise<void> | void
}) {
  const dialog = useDialog()
  const project = useProject()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const [adapters, setAdapters] = createSignal<Adapter[] | undefined>(props.adapters)

  onMount(() => {
    dialog.setSize("medium")
    void (async () => {
      if (adapters()) return
      const res = await loadWorkspaceAdapters({ sdk, sync, toast })
      if (!res) return
      setAdapters(res)
    })()
  })

  const options = createMemo<DialogSelectOption<WorkspaceSelectValue>[]>(() => {
    const list = adapters()
    if (!list) return []
    const recent = sync.data.session
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .flatMap((session) => (session.workspaceID ? [session.workspaceID] : []))
      .filter((workspaceID, index, list) => list.indexOf(workspaceID) === index)
      .flatMap((workspaceID) => {
        const workspace = project.workspace.get(workspaceID)
        return workspace && project.workspace.status(workspace.id) === "connected" ? [workspace] : []
      })
      .slice(0, 3)
    return [
      ...list.map((adapter) => ({
        title: adapter.name,
        value: { type: "new" as const, workspaceType: adapter.type, workspaceName: adapter.name },
        description: adapter.description,
        category: "New workspace",
      })),
      {
        title: "None",
        value: { type: "none" as const },
        description: "Use the local project",
        category: "Choose workspace",
      },
      ...recent.map((workspace: Workspace) => ({
        title: workspace.name,
        description: `(${workspace.type})`,
        value: {
          type: "existing" as const,
          workspaceID: workspace.id,
          workspaceType: workspace.type,
          workspaceName: workspace.name,
        },
        category: "Choose workspace",
      })),
      {
        title: "View all workspaces",
        value: { type: "existing-list" as const },
        description: "Choose from all workspaces",
        category: "Choose workspace",
      },
    ]
  })

  if (!adapters()) return null
  return (
    <DialogSelect<WorkspaceSelectValue>
      title="Warp"
      skipFilter={true}
      renderFilter={false}
      options={options()}
      onSelect={(option) => {
        if (!option.value) return
        if (option.value.type === "none") {
          void props.onSelect(option.value)
          return
        }
        if (option.value.type === "new") {
          void props.onSelect(option.value)
          return
        }
        if (option.value.type === "existing") {
          void props.onSelect(option.value)
          return
        }

        dialog.replace(() => <DialogExistingWorkspaceSelect onSelect={props.onSelect} />)
      }}
    />
  )
}

function DialogExistingWorkspaceSelect(props: { onSelect: (selection: WorkspaceSelection) => Promise<void> | void }) {
  const project = useProject()

  const options = createMemo<DialogSelectOption<ExistingWorkspaceSelectValue>[]>(() =>
    project.workspace
      .list()
      .filter((workspace) => project.workspace.status(workspace.id) === "connected")
      .map((workspace: Workspace) => ({
        title: workspace.name,
        description: `(${workspace.type})`,
        value: { workspace },
      })),
  )

  return (
    <DialogSelect<ExistingWorkspaceSelectValue>
      title="Existing Workspace"
      options={options()}
      onSelect={(option) => {
        void props.onSelect({
          type: "existing",
          workspaceID: option.value.workspace.id,
          workspaceType: option.value.workspace.type,
          workspaceName: option.value.workspace.name,
        })
      }}
    />
  )
}

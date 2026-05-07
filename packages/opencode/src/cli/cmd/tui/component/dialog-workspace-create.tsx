import type { Workspace } from "@opencode-ai/sdk/v2"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useSync } from "@tui/context/sync"
import { useProject } from "@tui/context/project"
import { useRoute } from "@tui/context/route"
import { createMemo, createSignal, onMount } from "solid-js"
import { errorMessage } from "@/util/error"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { DialogAlert } from "../ui/dialog-alert"
import { DialogWorkspaceFileChanges } from "./dialog-workspace-file-changes"

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

export function recentConnectedWorkspaces<WorkspaceInfo extends { id: string }>(input: {
  sessions: readonly { workspaceID?: string; time: { updated: number } }[]
  get: (workspaceID: string) => WorkspaceInfo | undefined
  status: (workspaceID: string) => string | undefined
  limit?: number
  omitWorkspaceID?: string
}) {
  const workspaces = input.sessions
    .toSorted((a, b) => b.time.updated - a.time.updated)
    .flatMap((session) => {
      const workspace = session.workspaceID ? input.get(session.workspaceID) : undefined
      return workspace && input.status(workspace.id) === "connected" ? [workspace] : []
    })
    .filter((workspace) => workspace.id !== input.omitWorkspaceID)
    .filter((workspace, index, list) => list.findIndex((item) => item.id === workspace.id) === index)
  const recent = workspaces.slice(0, input.limit ?? 3)

  return { recent, hasMore: recent.length < workspaces.length }
}

export function warpReminderText(dir: string) {
  return `<system-reminder>The user has changed the current working directory to "${dir}". This is still the same project but at a possibly new location; take this into account when working with any files from now on.</system-reminder>`
}

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
  sourceWorkspaceID?: string
  workspaceID: string | null
  sessionID: string
  copyChanges: boolean
  done?: () => void
}): Promise<boolean> {
  const result = await input.sdk.client.experimental.workspace
    .warp({
      id: input.workspaceID,
      sessionID: input.sessionID,
      copyChanges: input.copyChanges,
    })
    .catch(() => undefined)
  if (!result?.data) {
    if (result?.error?.name === "VcsApplyError") {
      await DialogAlert.show(
        input.dialog,
        "Unable to Warp Session",
        "Unable to apply file changes to this workspace. It has existing changes that conflict or is based off a different branch. Session has not been warped.",
      )
      return false
    }

    input.toast.show({
      message: `Failed to warp session: ${errorMessage(result?.error ?? "no response")}`,
      variant: "error",
    })
    return false
  }

  input.project.workspace.set(input.workspaceID)

  await input.sync.bootstrap({ fatal: false }).catch(() => undefined)

  const dir = input.project.instance.directory() || input.sync.path.directory
  if (dir) {
    await input.sdk.client.session
      .promptAsync({
        sessionID: input.sessionID,
        workspace: input.workspaceID ?? undefined,
        noReply: true,
        parts: [
          {
            type: "text",
            text: warpReminderText(dir),
            synthetic: true,
          },
        ],
      })
      .catch(() => undefined)
  }

  await Promise.all([input.project.workspace.sync(), input.sync.session.refresh()])

  if (input.done) {
    input.done()
    return true
  }
  input.dialog.clear()
  return true
}

export async function confirmWorkspaceFileChanges(input: {
  dialog: ReturnType<typeof useDialog>
  sdk: ReturnType<typeof useSDK>
  sourceWorkspaceID?: string
}) {
  const status = await input.sdk.client.vcs.status({ workspace: input.sourceWorkspaceID }).catch(() => undefined)
  const fileChangeChoice = status?.data?.length ? await DialogWorkspaceFileChanges.show(input.dialog, status.data) : "no"
  if (!fileChangeChoice) return
  return fileChangeChoice === "yes"
}

export function DialogWorkspaceSelect(props: {
  adapters?: Adapter[]
  onSelect: (selection: WorkspaceSelection) => Promise<void> | void
}) {
  const dialog = useDialog()
  const project = useProject()
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const [adapters, setAdapters] = createSignal<Adapter[] | undefined>(props.adapters)
  const omittedWorkspaceID = createMemo(() => (route.data.type === "session" ? project.workspace.current() : undefined))

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
    const { recent, hasMore } = recentConnectedWorkspaces({
      sessions: sync.data.session,
      get: project.workspace.get,
      status: project.workspace.status,
      omitWorkspaceID: omittedWorkspaceID(),
    })
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
      ...(hasMore
        ? [
            {
              title: "View all workspaces",
              value: { type: "existing-list" as const },
              description: "Choose from all workspaces",
              category: "Choose workspace",
            },
          ]
        : []),
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

        dialog.replace(() => <DialogExistingWorkspaceSelect omitWorkspaceID={omittedWorkspaceID()} onSelect={props.onSelect} />)
      }}
    />
  )
}

function DialogExistingWorkspaceSelect(props: {
  omitWorkspaceID?: string
  onSelect: (selection: WorkspaceSelection) => Promise<void> | void
}) {
  const project = useProject()

  const options = createMemo<DialogSelectOption<ExistingWorkspaceSelectValue>[]>(() =>
    project.workspace
      .list()
      .filter((workspace) => project.workspace.status(workspace.id) === "connected")
      .filter((workspace) => workspace.id !== props.omitWorkspaceID)
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

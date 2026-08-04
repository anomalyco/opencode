import type { ExperimentalWorkspaceAdapterListResponse, Workspace } from "@opencode-ai/sdk/v2"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useSync } from "../context/sync"
import { useProject } from "../context/project"
import { useRoute } from "../context/route"
import { createMemo, createSignal, onMount } from "solid-js"
import { errorMessage } from "../util/error"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { DialogAlert } from "../ui/dialog-alert"
import { DialogWorkspaceFileChanges } from "./dialog-workspace-file-changes"

type Adapter = ExperimentalWorkspaceAdapterListResponse[number]

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

export function recentConnectedWorkspaces<WorkspaceInfo extends { id: string; timeUsed: number | string }>(input: {
  workspaces: readonly WorkspaceInfo[]
  status: (workspaceID: string) => string | undefined
  limit?: number
  omitWorkspaceID?: string
}) {
  const allWorkspaces = input.workspaces.filter((workspace) => input.status(workspace.id) === "connected")
  const workspaces = allWorkspaces.toSorted((a, b) => Number(b.timeUsed) - Number(a.timeUsed))
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
  try {
    const response = await input.sdk.client.experimental.workspace.adapter.list({ directory: dir })
    if (response.error) throw response.error
    return response.data
  } catch (err) {
    input.toast.show({
      title: "加载工作区适配器失败",
      message: errorMessage(err),
      variant: "error",
    })
    return undefined
  }
}

export async function openWorkspaceSelect(input: {
  dialog: ReturnType<typeof useDialog>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  project: ReturnType<typeof useProject>
  toast: ReturnType<typeof useToast>
  onSelect: (selection: WorkspaceSelection) => Promise<void> | void
}) {
  input.dialog.clear()
  await input.sdk.client.experimental.workspace.syncList().catch(() => undefined)
  await input.project.workspace.sync().catch(() => undefined)
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
  let result
  try {
    result = await input.sdk.client.experimental.workspace.warp({
      id: input.workspaceID,
      sessionID: input.sessionID,
      copyChanges: input.copyChanges,
    })
  } catch (err) {
    input.toast.show({
      title: "迁移会话失败",
      message: errorMessage(err),
      variant: "error",
    })
    return false
  }
  if (!result?.data) {
    if (result?.error && "name" in result.error && result.error.name === "VcsApplyError") {
      await DialogAlert.show(
        input.dialog,
        "无法迁移会话",
        "无法将文件更改应用到该工作区。它存在冲突的现有更改，或基于不同的分支。会话尚未迁移。",
      )
      return false
    }

    input.toast.show({
      title: "迁移会话失败",
      message: errorMessage(result?.error ?? "无响应"),
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
  const fileChangeChoice = status?.data?.length
    ? await DialogWorkspaceFileChanges.show(input.dialog, status.data)
    : "no"
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
      workspaces: project.workspace.list(),
      status: project.workspace.status,
      omitWorkspaceID: omittedWorkspaceID(),
    })
    return [
      ...list.map((adapter) => ({
        title: adapter.name,
        value: { type: "new" as const, workspaceType: adapter.type, workspaceName: adapter.name },
        description: adapter.description,
        category: "新建工作区",
      })),
      {
        title: "无",
        value: { type: "none" as const },
        description: "使用本地项目",
        category: "选择工作区",
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
        category: "选择工作区",
      })),
      ...(hasMore
        ? [
            {
              title: "查看所有工作区",
              value: { type: "existing-list" as const },
              description: "从所有工作区中选择",
              category: "选择工作区",
            },
          ]
        : []),
    ]
  })

  if (!adapters()) return null
  return (
    <DialogSelect<WorkspaceSelectValue>
      title="迁移"
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

        dialog.replace(() => (
          <DialogExistingWorkspaceSelect omitWorkspaceID={omittedWorkspaceID()} onSelect={props.onSelect} />
        ))
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
      title="已有工作区"
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

import type { ExperimentalWorkspaceAdapterListResponse, Workspace } from "@opencode-ai/sdk/v2"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useProject } from "../context/project"
import { useRoute } from "../context/route"
import { createEffect, createMemo, createSignal, onMount } from "solid-js"
import { errorMessage } from "../util/error"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { DialogAlert } from "../ui/dialog-alert"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogWorkspaceFileChanges } from "./dialog-workspace-file-changes"

type Adapter = ExperimentalWorkspaceAdapterListResponse[number]

export type WorkspaceSelection =
  | { type: "none" }
  | { type: "new"; workspaceType: string; workspaceName: string; name?: string }
  | { type: "existing"; workspaceID: string; workspaceType: string; workspaceName: string }

type WorkspaceSelectValue = WorkspaceSelection

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return "now"
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  return `${months}mo`
}

export function buildDetails(workspace: Workspace): string[] | undefined {
  const lines: string[] = []
  if (workspace.directory) lines.push(workspace.directory)
  if (workspace.branch) lines.push(`branch: ${workspace.branch}`)
  if (workspace.timeUsed && typeof workspace.timeUsed === "number") {
    lines.push(`used ${relativeTime(workspace.timeUsed)} ago`)
  }
  return lines.length ? lines : undefined
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
      title: "Failed to load workspace adapters",
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
      title: "Failed to warp session",
      message: errorMessage(err),
      variant: "error",
    })
    return false
  }
  if (!result?.data) {
    if (result?.error && "name" in result.error && result.error.name === "VcsApplyError") {
      await DialogAlert.show(
        input.dialog,
        "Unable to Warp Session",
        "Unable to apply file changes to this workspace. It has existing changes that conflict or is based off a different branch. Session has not been warped.",
      )
      return false
    }

    input.toast.show({
      title: "Failed to warp session",
      message: errorMessage(result?.error ?? "no response"),
      variant: "error",
    })
    return false
  }

  input.project.workspace.set(input.workspaceID)

  const targetWorkspace = input.workspaceID
    ? input.project.workspace.get(input.workspaceID)
    : undefined
  if (targetWorkspace?.branch) {
    input.sync.set("vcs", { branch: targetWorkspace.branch })
  }

  await Promise.all([
    input.project.sync().catch(() => undefined),
    input.sdk.client.vcs.get({ workspace: input.workspaceID ?? undefined }).then((x) => input.sync.set("vcs", x.data)).catch(() => undefined),
  ])
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

  await Promise.all([input.project.workspace.syncKeepCurrent(), input.sync.session.refresh()])

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
  const { theme } = useTheme()
  const dialog = useDialog()
  const project = useProject()
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const [adapters, setAdapters] = createSignal<Adapter[] | undefined>(props.adapters)
  const [removing, setRemoving] = createSignal<string>()

  onMount(() => {
    dialog.setSize("large")
    void (async () => {
      if (adapters()) return
      const res = await loadWorkspaceAdapters({ sdk, sync, toast })
      if (!res) return
      setAdapters(res)
    })()
  })

  async function remove(workspace: Workspace) {
    if (removing()) return

    const confirmed = await DialogConfirm.show(
      dialog,
      "Delete workspace",
      `Are you sure you want to delete "${workspace.name}"?`,
      "delete",
    )
    if (confirmed !== true) return

    setRemoving(workspace.id)
    const result = await sdk.client.experimental.workspace.remove({ id: workspace.id }).catch((err) => ({
      error: err,
    }))
    if (result?.error) {
      setRemoving(undefined)
      toast.show({
        variant: "error",
        title: "Failed to delete workspace",
        message: errorMessage(result.error),
      })
      return
    }

    if (project.workspace.current() === workspace.id) {
      project.workspace.set(undefined)
      await project.sync().catch(() => undefined)
      route.navigate({ type: "home" })
    }
    await project.workspace.sync().catch(() => undefined)
    await project.sync().catch(() => undefined)
    setRemoving(undefined)
  }

  const options = createMemo<DialogSelectOption<WorkspaceSelectValue>[]>(() => {
    const list = adapters()
    if (!list) return []

    const workspaces = project
      .workspace.list()
      .toSorted((a, b) => Number(b.timeUsed) - Number(a.timeUsed))

    return [
      {
        title: "Workspace root",
        value: { type: "none" as const },
        description: "Use project root directory",
        category: "Switch to",
      },
      ...workspaces.map((workspace: Workspace) => {
        const isCurrent = workspace.id === project.workspace.current()
        return {
        title:
          removing() === workspace.id
            ? "Deleting..."
            : isCurrent
              ? `${workspace.name} (current)`
              : workspace.name,
        value: {
          type: "existing" as const,
          workspaceID: workspace.id,
          workspaceType: workspace.type,
          workspaceName: workspace.name,
        },
        category: "Workspaces",
        footer: workspace.type === "worktree" ? "linked" : workspace.type,
        gutter: () => {
          const status = project.workspace.status(workspace.id)
          return (
            <box alignItems="center" justifyContent="center" height={1}>
              <text fg={status === "connected" ? theme.success : theme.error}>•</text>
            </box>
          )
        },
        details: buildDetails(workspace),
      }
    }),
      ...list.map((adapter) => ({
        title: adapter.name,
        value: { type: "new" as const, workspaceType: adapter.type, workspaceName: adapter.name },
        description: adapter.description,
        category: "Create new",
      })),
    ]
  })

  if (!adapters()) return null
  return (
    <DialogSelect<WorkspaceSelectValue>
      title="Move session to..."
      renderFilter={true}
      options={options()}
      onSelect={async (option) => {
        if (!option.value) return
        if (option.value.type === "new") {
          const name = await DialogPrompt.show(dialog, "Worktree name (optional)", {
            placeholder: "leave empty for random name",
          })
          if (name === null) return
          option.value.name = name || undefined
        }
        void props.onSelect(option.value)
      }}
      actions={[
        {
          command: "session.delete",
          title: "delete",
          disabled: (option) => !option?.value || option.value.type !== "existing",
          onTrigger: (option) => {
            const val = option.value
            if (val?.type !== "existing") return
            const ws = project.workspace.list().find((w) => w.id === val.workspaceID)
            if (ws) void remove(ws)
          },
        },
      ]}
    />
  )
}

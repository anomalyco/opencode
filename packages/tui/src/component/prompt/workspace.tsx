import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useDialog } from "../../ui/dialog"
import { useSDK } from "../../context/sdk"
import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { useToast } from "../../ui/toast"
import { errorMessage } from "../../util/error"
import {
  confirmWorkspaceFileChanges,
  openWorkspaceSelect,
  warpWorkspaceSession,
  type WorkspaceSelection,
} from "../dialog-workspace-create"
import type { WorkspaceStatus } from "../workspace-label"

type TimedNoticeClock = {
  setTimeout(callback: () => void, duration: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
}

export function createTimedNotice(duration = 4000, clock: TimedNoticeClock = { setTimeout, clearTimeout }) {
  const [notice, setNotice] = createSignal<string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  function show(message: string) {
    if (timer) clock.clearTimeout(timer)
    setNotice(message)
    timer = clock.setTimeout(() => {
      setNotice(undefined)
      timer = undefined
    }, duration)
  }

  function clear() {
    if (timer) clock.clearTimeout(timer)
    timer = undefined
    setNotice(undefined)
  }

  onCleanup(clear)
  return { notice, show, clear }
}

export function usePromptWorkspace(sessionID?: string) {
  const dialog = useDialog()
  const sdk = useSDK()
  const project = useProject()
  const sync = useSync()
  const toast = useToast()
  const [selection, setSelection] = createSignal<WorkspaceSelection>()
  const [creating, setCreating] = createSignal(false)
  const [creatingDots, setCreatingDots] = createSignal(3)
  const timedNotice = createTimedNotice()

  async function create(selection: Extract<WorkspaceSelection, { type: "new" }>) {
    setCreating(true)
    let result
    try {
      result = await sdk.client.experimental.workspace.create({ type: selection.workspaceType, branch: null })
    } catch (err) {
      setSelection(undefined)
      setCreating(false)
      toast.show({ title: "Creating workspace failed", message: errorMessage(err), variant: "error" })
      return
    }
    if (result.error || !result.data) {
      setSelection(undefined)
      setCreating(false)
      toast.show({
        title: "Creating workspace failed",
        message: errorMessage(result.error ?? "no response"),
        variant: "error",
      })
      return
    }

    await project.workspace.sync()
    const workspace = result.data
    setSelection({
      type: "existing",
      workspaceID: workspace.id,
      workspaceType: workspace.type,
      workspaceName: workspace.name,
    })
    setCreating(false)
    return workspace
  }

  async function warp(selection: WorkspaceSelection) {
    if (!sessionID) {
      setSelection(selection)
      dialog.clear()
      if (selection.type === "new") void create(selection)
      return
    }
    const sourceWorkspaceID = project.workspace.current()
    const copyChanges = await confirmWorkspaceFileChanges({ dialog, sdk, sourceWorkspaceID })
    if (copyChanges === undefined) return
    setSelection(selection)
    dialog.clear()

    const workspace =
      selection.type === "none"
        ? { id: null, name: "local project" }
        : selection.type === "existing"
          ? { id: selection.workspaceID, name: selection.workspaceName }
          : await create(selection)
    if (!workspace) return

    const warped = await warpWorkspaceSession({
      dialog,
      sdk,
      sync,
      project,
      toast,
      sourceWorkspaceID,
      workspaceID: workspace.id,
      sessionID,
      copyChanges,
    })
    if (warped) showNotice(workspace.name)
  }

  function showNotice(name: string) {
    timedNotice.show(`Warped to ${name}`)
  }

  function clearNotice() {
    timedNotice.clear()
  }

  function open() {
    void openWorkspaceSelect({ dialog, sdk, sync, project, toast, onSelect: warp })
  }

  createEffect(() => {
    if (!creating()) {
      setCreatingDots(3)
      return
    }
    const timer = setInterval(() => setCreatingDots((dots) => (dots % 3) + 1), 1000)
    onCleanup(() => clearInterval(timer))
  })

  const label = createMemo<
    | { type: "new"; workspaceType: string }
    | { type: "existing"; workspaceType: string; workspaceName: string; status?: WorkspaceStatus }
    | undefined
  >(() => {
    const selected = selection()
    if (!selected) return
    if (selected.type === "none") return
    if (sessionID && !creating()) return
    if (selected.type === "new") return { type: "new", workspaceType: selected.workspaceType }
    return {
      type: "existing",
      workspaceType: selected.workspaceType,
      workspaceName: selected.workspaceName,
      status: selected.type === "existing" ? "connected" : undefined,
    }
  })

  return { selection, creating, creatingDots, notice: timedNotice.notice, label, open, warp, clearNotice }
}

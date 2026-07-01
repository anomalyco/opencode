import { createSignal } from "solid-js"

export type ActiveEditor = {
  tab: string
  editing: () => boolean
  dirty: () => boolean
  save: () => void | Promise<void>
  guard: () => Promise<boolean>
}

export async function guardTab(tab: string): Promise<boolean> {
  const editor = active()
  if (!editor || editor.tab !== tab) return true
  return editor.guard()
}

const [active, setActive] = createSignal<ActiveEditor | undefined>(undefined)

export const activeEditor = active

export function registerActiveEditor(editor: ActiveEditor) {
  setActive(editor)
}

export function clearActiveEditor(tab: string) {
  setActive((current) => (current?.tab === tab ? undefined : current))
}

export type PendingEditPos = { line: number; character: number }
type PendingEditOpen = { path: string; pos: PendingEditPos }

let pendingEditOpen: PendingEditOpen | undefined

export function setPendingEditOpen(path: string, pos: PendingEditPos) {
  pendingEditOpen = { path, pos }
}

export function takePendingEditOpen(path: string): PendingEditPos | undefined {
  if (!pendingEditOpen || pendingEditOpen.path !== path) return undefined
  const pos = pendingEditOpen.pos
  pendingEditOpen = undefined
  return pos
}

export function isDirtyAgainst(baseline: string, next: string) {
  return next !== baseline
}

export type WriteResult = { conflict?: boolean; sha?: string; written?: boolean }

export type FileSaverDeps = {
  editing: () => boolean
  currentText: () => string
  isDirty: () => boolean
  setDirty: (value: boolean) => void
  write: (content: string, expectedSha?: string) => Promise<WriteResult>
  reloadFromDisk: () => void | Promise<void>
  leaveEditMode: () => void
  promptConflict: () => Promise<"reload" | "overwrite" | undefined>
  promptUnsaved: () => Promise<"save" | "discard" | "cancel" | undefined>
  onSaved?: (content: string, sha?: string) => void
  onError?: () => void
}

export function createFileSaver(deps: FileSaverDeps) {
  let baseline = ""
  let baselineSha: string | undefined
  let saving = false

  const setBaseline = (content: string, sha?: string) => {
    baseline = content
    baselineSha = sha
  }

  const applySaved = (content: string, sha?: string) => {
    setBaseline(content, sha)
    deps.setDirty(false)
    deps.onSaved?.(content, sha)
  }

  const onChange = (next: string) => {
    deps.setDirty(isDirtyAgainst(baseline, next))
  }

  const save = async (): Promise<void> => {
    if (!deps.editing() || !deps.isDirty() || saving) return
    const content = deps.currentText()
    saving = true
    try {
      // A conflict is a normal result (stale baselineSha), not a throw; on save the baseline resets to the returned sha.
      const res = await deps.write(content, baselineSha)
      if (res.conflict) {
        const choice = await deps.promptConflict()
        if (choice === "reload") {
          await deps.reloadFromDisk()
          deps.leaveEditMode()
          return
        }
        if (choice === "overwrite") {
          const forced = await deps.write(content)
          if (forced.conflict) {
            deps.onError?.()
            return
          }
          applySaved(content, forced.sha)
        }
        return
      }
      applySaved(content, res.sha)
    } catch {
      deps.onError?.()
    } finally {
      saving = false
    }
  }

  const guard = async (): Promise<boolean> => {
    if (!deps.editing() || !deps.isDirty()) return true
    const choice = await deps.promptUnsaved()
    if (choice === "save") {
      await save()
      return !deps.isDirty()
    }
    if (choice === "discard") {
      deps.setDirty(false)
      return true
    }
    return false
  }

  return {
    onChange,
    save,
    guard,
    setBaseline,
    get baselineSha() {
      return baselineSha
    },
  }
}

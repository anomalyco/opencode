import path from "path"
import os from "os"
import fs from "fs/promises"
import type { DialogContext } from "@tui/ui/dialog"
import { DialogConfirm } from "@tui/ui/dialog-confirm"

export interface ChangeDirectoryDeps {
  getCurrentDirectory: () => string
  getWorktree: () => string
  setDirectory: (dir: string) => void
  syncProject: () => Promise<void>
  showToast: (opts: { message: string; variant: "info" | "success" | "warning" | "error" }) => void
}

export async function changeDirectory(
  targetPath: string,
  initialDirectory: string,
  deps: ChangeDirectoryDeps,
  dialog?: DialogContext,
): Promise<string | undefined> {
  const trimmed = targetPath.trim()
  if (!trimmed) return changeDirectory(initialDirectory, initialDirectory, deps, dialog)

  const expanded = trimmed.startsWith("~") ? path.join(os.homedir(), trimmed.slice(1)) : trimmed
  const resolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(deps.getCurrentDirectory(), expanded)

  const stat = await fs.stat(resolved).catch(() => null)
  if (!stat?.isDirectory()) {
    deps.showToast({ message: `Directory not found: ${resolved}`, variant: "error" })
    dialog?.clear()
    return
  }

  const worktree = deps.getWorktree()
  if (worktree && worktree !== "/" && !resolved.startsWith(worktree)) {
    if (!dialog) return
    const confirmed = await DialogConfirm.show(
      dialog,
      "Change Directory",
      `Target is outside the current project.\n${resolved}\nContinue?`,
    )
    if (confirmed !== true) return
  }

  const ok = await Promise.resolve()
    .then(() => process.chdir(resolved))
    .then(() => true)
    .catch(() => false)
  if (!ok) {
    deps.showToast({ message: `Failed to change directory to: ${resolved}`, variant: "error" })
    dialog?.clear()
    return
  }

  deps.setDirectory(resolved)
  await deps.syncProject()
  deps.showToast({ message: `Changed directory to ${resolved}`, variant: "success" })
  dialog?.clear()
  return resolved
}

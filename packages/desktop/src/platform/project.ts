import type { Platform } from "@opencode-ai/app"
import { open, save } from "@tauri-apps/plugin-dialog"
import { commands } from "../bindings"
import { t } from "../i18n"

type DirectoryOpts = Parameters<NonNullable<Platform["openDirectoryPickerDialog"]>>[0]
type FileOpts = Parameters<NonNullable<Platform["openFilePickerDialog"]>>[0]
type SaveOpts = Parameters<NonNullable<Platform["saveFilePickerDialog"]>>[0]

async function home(os: Platform["os"]) {
  if (os !== "windows" || !window.__OPENCODE__?.wsl) return undefined
  return commands.wslPath("~", "windows").catch(() => undefined)
}

async function map(path: string | string[] | null) {
  if (!path || !window.__OPENCODE__?.wsl) return path
  if (Array.isArray(path)) {
    return Promise.all(path.map((item) => commands.wslPath(item, "linux").catch(() => item)))
  }
  return commands.wslPath(path, "linux").catch(() => path)
}

async function file(path: string | null) {
  if (!path || !window.__OPENCODE__?.wsl) return path
  return commands.wslPath(path, "linux").catch(() => path)
}

export function createProjectPlatform(
  os: Platform["os"],
): Pick<
  Platform,
  | "openDirectoryPickerDialog"
  | "openFilePickerDialog"
  | "saveFilePickerDialog"
  | "normalizeProjectPath"
  | "cloneGitRepository"
  | "getDefaultCloneDirectory"
  | "setDefaultCloneDirectory"
  | "openPath"
> {
  return {
    async openDirectoryPickerDialog(opts: DirectoryOpts) {
      const path = await home(os)
      const res = await open({
        directory: true,
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFolder"),
        defaultPath: path,
      })
      return map(res)
    },

    async openFilePickerDialog(opts: FileOpts) {
      const res = await open({
        directory: false,
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFile"),
      })
      return map(res)
    },

    async saveFilePickerDialog(opts: SaveOpts) {
      const res = await save({
        title: opts?.title ?? t("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      return file(res)
    },

    async normalizeProjectPath(path: string) {
      if (os === "windows" && window.__OPENCODE__?.wsl) {
        return commands.wslPath(path, "linux").catch(() => path)
      }
      return path
    },

    cloneGitRepository(url: string, dir?: string) {
      return commands.cloneGitRepository(url, dir ?? null)
    },

    async getDefaultCloneDirectory() {
      return commands.getDefaultCloneDirectory().catch(() => null)
    },

    async setDefaultCloneDirectory(path: string | null) {
      await commands.setDefaultCloneDirectory(path)
    },

    async openPath(path: string, app?: string) {
      await commands.openPath(path, app ?? null)
    },
  }
}

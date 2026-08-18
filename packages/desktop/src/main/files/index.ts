import { execFile } from "node:child_process"
import { stat } from "node:fs/promises"
import { basename } from "node:path"
import { clipboard, dialog, shell } from "electron"
import type { DirectoryPickerOptions, FilePickerOptions, SaveFilePickerOptions } from "../../shared/ipc-contract"
import { writeLog } from "../native/logging"
import { nativeT } from "../native/translations"
import { assertAttachmentBudget, createPickedFileAuthorizations } from "./attachment-picker"
import { resolveExternalURL, resolveLocalFilePath } from "./external-url"

export function createFileCapabilities() {
  const pickedFiles = createPickedFileAuthorizations()

  return {
    async openDirectoryPicker(options?: DirectoryPickerOptions) {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", ...(options?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
        title: options?.title ?? nativeT("desktop.dialog.chooseFolder"),
        defaultPath: options?.defaultPath,
      })
      if (result.canceled) return null
      return options?.multiple ? result.filePaths : result.filePaths[0]
    },
    async openFilePicker(sender: number, options?: FilePickerOptions) {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", ...(options?.multiple ? ["multiSelections" as const] : [])],
        title: options?.title ?? nativeT("desktop.dialog.chooseFile"),
        defaultPath: options?.defaultPath,
        filters: pickerFilters(options?.extensions),
      })
      if (result.canceled) return null
      const files = await Promise.all(
        result.filePaths.map(async (path) => ({ path, name: basename(path), size: (await stat(path)).size })),
      )
      assertAttachmentBudget(files)
      return { token: pickedFiles.add(sender, result.filePaths), files }
    },
    readPickedFile: (sender: number, token: string, path: string) => pickedFiles.read(sender, token, path),
    releasePickedFiles: (sender: number, token: string) => pickedFiles.release(sender, token),
    async saveFilePicker(options?: SaveFilePickerOptions) {
      const result = await dialog.showSaveDialog({
        title: options?.title ?? nativeT("desktop.dialog.saveFile"),
        defaultPath: options?.defaultPath,
      })
      if (result.canceled) return null
      return result.filePath ?? null
    },
    async openPath(path: string, application?: string) {
      if (!application) return shell.openPath(path)
      await new Promise<void>((resolve, reject) => {
        const command =
          process.platform === "darwin"
            ? { file: "open", arguments: ["-a", application, path] }
            : { file: application, arguments: [path] }
        execFile(command.file, command.arguments, (error) => (error ? reject(error) : resolve()))
      })
    },
    async revealPath(path: string) {
      const exists = await stat(path).then(
        () => true,
        () => false,
      )
      if (!exists) return false
      shell.showItemInFolder(path)
      return true
    },
    readClipboardImage() {
      const image = clipboard.readImage()
      if (image.isEmpty()) return null
      const size = image.getSize()
      return { buffer: new Uint8Array(image.toPNG()).buffer, width: size.width, height: size.height }
    },
  }
}

export function openExternalURL(value: string) {
  const url = resolveExternalURL(value)
  if (!url) {
    writeLog("window", "blocked external target", { url: value }, "warn")
    return
  }
  void shell.openExternal(url)
}

export function openLocalFileURL(value: string) {
  const path = resolveLocalFilePath(value)
  if (!path) {
    writeLog("window", "blocked local file target", { url: value }, "warn")
    return
  }
  void shell.openPath(path).then((error) => {
    if (error) writeLog("window", "failed to open local file", { path, error }, "error")
  })
}

function pickerFilters(extensions?: string[]) {
  if (!extensions?.length) return undefined
  return [{ name: nativeT("desktop.dialog.files"), extensions }]
}

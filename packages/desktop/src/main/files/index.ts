export * as DesktopFiles from "./index"

import { execFile } from "node:child_process"
import { clipboard, dialog, shell } from "electron"
import { Context, Effect, FileSystem, Layer, Path } from "effect"
import type { DirectoryPickerOptions, FilePickerOptions, SaveFilePickerOptions } from "../../shared/ipc-contract"
import { scoped } from "../native/logging"
import { nativeT } from "../native/translations"
import { assertAttachmentBudget, createPickedFileAuthorizations, readAttachment } from "./attachment-picker"
import { resolveExternalURL, resolveLocalFilePath } from "./external-url"

export type Interface = ReturnType<typeof make>

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopFiles") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    return Service.of(make(fs, path))
  }),
)

function make(fs: FileSystem.FileSystem, path: Path.Path) {
  const pickedFiles = createPickedFileAuthorizations((file, maxBytes) =>
    readAttachment(file, maxBytes).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
  )

  return {
    openDirectoryPicker: Effect.fn("DesktopFiles.openDirectoryPicker")(function* (options?: DirectoryPickerOptions) {
      const result = yield* Effect.promise(() =>
        dialog.showOpenDialog({
          properties: ["openDirectory", ...(options?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
          title: options?.title ?? nativeT("desktop.dialog.chooseFolder"),
          defaultPath: options?.defaultPath,
        }),
      )
      if (result.canceled) return null
      return options?.multiple ? result.filePaths : result.filePaths[0]
    }),
    openFilePicker: Effect.fn("DesktopFiles.openFilePicker")(function* (sender: number, options?: FilePickerOptions) {
      const result = yield* Effect.promise(() =>
        dialog.showOpenDialog({
          properties: ["openFile", ...(options?.multiple ? ["multiSelections" as const] : [])],
          title: options?.title ?? nativeT("desktop.dialog.chooseFile"),
          defaultPath: options?.defaultPath,
          filters: pickerFilters(options?.extensions),
        }),
      )
      if (result.canceled) return null
      const files = yield* Effect.forEach(
        result.filePaths,
        Effect.fnUntraced(function* (file) {
          const info = yield* fs.stat(file)
          return { path: file, name: path.basename(file), size: Number(info.size) }
        }),
        { concurrency: "unbounded" },
      )
      assertAttachmentBudget(files)
      return { token: pickedFiles.add(sender, result.filePaths), files }
    }),
    readPickedFile: pickedFiles.read,
    releasePickedFiles: pickedFiles.release,
    saveFilePicker: Effect.fn("DesktopFiles.saveFilePicker")(function* (options?: SaveFilePickerOptions) {
      const result = yield* Effect.promise(() =>
        dialog.showSaveDialog({
          title: options?.title ?? nativeT("desktop.dialog.saveFile"),
          defaultPath: options?.defaultPath,
        }),
      )
      if (result.canceled) return null
      return result.filePath ?? null
    }),
    openPath: Effect.fn("DesktopFiles.openPath")(function* (target: string, application?: string) {
      if (!application) return yield* Effect.promise(() => shell.openPath(target))
      yield* Effect.tryPromise(() =>
        new Promise<void>((resolve, reject) => {
          const command =
            process.platform === "darwin"
              ? { file: "open", arguments: ["-a", application, target] }
              : { file: application, arguments: [target] }
          execFile(command.file, command.arguments, (error) => (error ? reject(error) : resolve()))
        }),
      )
    }),
    revealPath: Effect.fn("DesktopFiles.revealPath")(function* (target: string) {
      const exists = yield* fs.stat(target).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      )
      if (!exists) return false
      shell.showItemInFolder(target)
      return true
    }),
    readClipboardImage() {
      const image = clipboard.readImage()
      if (image.isEmpty()) return null
      const size = image.getSize()
      return { buffer: new Uint8Array(image.toPNG()).buffer, width: size.width, height: size.height }
    },
  }
}

export const openExternalURL = Effect.fn("DesktopFiles.openExternalURL")(function* (value: string) {
  const url = resolveExternalURL(value)
  if (!url) {
    yield* scoped("window", Effect.logWarning("blocked external target", { url: value }))
    return
  }
  yield* Effect.promise(() => shell.openExternal(url))
})

export const openLocalFileURL = Effect.fn("DesktopFiles.openLocalFileURL")(function* (value: string) {
  const path = resolveLocalFilePath(value)
  if (!path) {
    yield* scoped("window", Effect.logWarning("blocked local file target", { url: value }))
    return
  }
  const error = yield* Effect.promise(() => shell.openPath(path))
  if (error) yield* scoped("window", Effect.logError("failed to open local file", { path, error }))
})

function pickerFilters(extensions?: string[]) {
  if (!extensions?.length) return undefined
  return [{ name: nativeT("desktop.dialog.files"), extensions }]
}

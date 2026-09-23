export * as DesktopFiles from "./index"

import { execFile } from "node:child_process"
import { clipboard, dialog, nativeImage, shell } from "electron"
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
    saveFile: Effect.fn("DesktopFiles.saveFile")(function* (options: SaveFilePickerOptions, content: string) {
      const result = yield* Effect.promise(() =>
        dialog.showSaveDialog({
          title: options?.title ?? nativeT("desktop.dialog.saveFile"),
          defaultPath: options?.defaultPath,
        }),
      )
      if (result.canceled) return false
      if (!result.filePath) return false
      yield* fs.writeFile(result.filePath, new TextEncoder().encode(content))
      return true
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
      const exists = yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false))
      if (!exists) return false
      shell.showItemInFolder(target)
      return true
    }),
    readClipboardImage: Effect.fn("DesktopFiles.readClipboardImage")(function* () {
      const items = yield* Effect.promise(() => clipboard.read())
      const found = clipboardImageTypes
        .flatMap((mime) => items.filter((item) => item.types.includes(mime)).map((item) => ({ item, mime })))
        .at(0)
      if (!found) return null
      // getType() is typed as Blob | ClipboardBookmark; only the bookmark format yields the latter.
      const payload = yield* Effect.promise(async () => found.item.getType(found.mime))
      if (!(payload instanceof Blob)) return null
      const bytes = yield* Effect.promise(() => payload.arrayBuffer())
      // Re-encode through nativeImage so the renderer always receives PNG and the image dimensions.
      const image = nativeImage.createFromBuffer(Buffer.from(bytes))
      if (image.isEmpty()) return null
      const size = image.getSize()
      return { buffer: new Uint8Array(image.toPNG()), width: size.width, height: size.height }
    }),
    writeClipboardText: Effect.fn("DesktopFiles.writeClipboardText")(function* (text: string) {
      yield* Effect.promise(() => clipboard.writeText(text))
    }),
  }
}

// Chromium exposes copied bitmaps as image/png; JPEG only appears when an app placed one explicitly.
const clipboardImageTypes = ["image/png", "image/jpeg"]

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

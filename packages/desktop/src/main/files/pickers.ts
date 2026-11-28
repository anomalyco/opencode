import type { BrowserWindow, Dialog, OpenDialogOptions, SaveDialogOptions } from "electron"
import { Effect, FileSystem, Path } from "effect"
import type { DirectoryPickerOptions, FilePickerOptions, SaveFilePickerOptions } from "../../shared/ipc-contract"
import { nativeT } from "../native/translations"
import { assertAttachmentBudget, type createPickedFileAuthorizations } from "./attachment-picker"
import { pickerStarts } from "./picker-start"

export type PickerDialog = Pick<Dialog, "showOpenDialog" | "showSaveDialog">

export function createFilePickers(deps: {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly pickedFiles: ReturnType<typeof createPickedFileAuthorizations>
  readonly dialog: PickerDialog
  readonly home: () => string
}) {
  // The first start that exists; none when even home is gone, which leaves the system to choose.
  const start = Effect.fnUntraced(function* (requested: string | undefined, save = false) {
    for (const candidate of pickerStarts(requested, deps.home(), save)) {
      if (yield* deps.fs.exists(candidate.check).pipe(Effect.orElseSucceed(() => false))) return candidate.use
    }

    return undefined
  })

  return {
    openDirectoryPicker: Effect.fn("DesktopFiles.openDirectoryPicker")(function* (
      parent: BrowserWindow | null,
      options?: DirectoryPickerOptions,
    ) {
      const defaultPath = yield* start(options?.defaultPath)

      const result = yield* Effect.promise(() =>
        showOpenDialog(deps.dialog, parent, {
          properties: ["openDirectory", ...(options?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
          title: options?.title ?? nativeT("desktop.dialog.chooseFolder"),
          defaultPath,
        }),
      )

      if (result.canceled) return null

      return options?.multiple ? result.filePaths : result.filePaths[0]
    }),
    openFilePicker: Effect.fn("DesktopFiles.openFilePicker")(function* (
      sender: number,
      parent: BrowserWindow | null,
      options?: FilePickerOptions,
    ) {
      const picker = deps.pickedFiles.open(sender)

      if (picker === undefined) return null

      return yield* Effect.gen(function* () {
        const defaultPath = yield* start(options?.defaultPath)

        const result = yield* Effect.promise(() =>
          showOpenDialog(deps.dialog, parent, {
            properties: ["openFile", ...(options?.multiple ? ["multiSelections" as const] : [])],
            title: options?.title ?? nativeT("desktop.dialog.chooseFile"),
            defaultPath,
            filters: pickerFilters(options?.extensions),
          }),
        )

        if (result.canceled) return null

        const files = yield* Effect.forEach(
          result.filePaths,
          Effect.fnUntraced(function* (file) {
            const info = yield* deps.fs.stat(file)

            return { path: file, name: deps.path.basename(file), size: Number(info.size) }
          }),
          { concurrency: "unbounded" },
        )

        assertAttachmentBudget(files)
        const token = deps.pickedFiles.grant(picker, result.filePaths)

        return token === undefined ? null : { token, files }
      }).pipe(Effect.ensuring(Effect.sync(() => deps.pickedFiles.close(picker))))
    }),
    saveFile: Effect.fn("DesktopFiles.saveFile")(function* (
      parent: BrowserWindow | null,
      options: SaveFilePickerOptions,
      content: string,
    ) {
      const defaultPath = yield* start(options?.defaultPath, true)

      const result = yield* Effect.promise(() =>
        showSaveDialog(deps.dialog, parent, {
          title: options?.title ?? nativeT("desktop.dialog.saveFile"),
          defaultPath,
        }),
      )

      if (result.canceled) return false

      if (!result.filePath) return false
      yield* deps.fs.writeFile(result.filePath, new TextEncoder().encode(content))

      return true
    }),
  }
}

// Passing the owning window sets WM_TRANSIENT_FOR on X11/GTK so the native picker stays in front of the app.
function showOpenDialog(dialog: PickerDialog, parent: BrowserWindow | null, options: OpenDialogOptions) {
  return parent && !parent.isDestroyed() ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)
}

function showSaveDialog(dialog: PickerDialog, parent: BrowserWindow | null, options: SaveDialogOptions) {
  return parent && !parent.isDestroyed() ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options)
}

function pickerFilters(extensions?: string[]) {
  if (!extensions?.length) return undefined

  return [{ name: nativeT("desktop.dialog.files"), extensions }]
}

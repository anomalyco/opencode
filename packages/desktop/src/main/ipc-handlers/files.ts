import { Effect } from "effect"
import { FileRpcs } from "../../shared/ipc-rpc"
import { DesktopFiles, openExternalURL, openLocalFileURL } from "../files"
import { IpcPortHandoff } from "../ipc-transport"
import { sender } from "./context"

export const fileHandlers = FileRpcs.toLayer(
  Effect.gen(function* () {
    const files = yield* DesktopFiles.Service
    const handoff = yield* IpcPortHandoff
    return FileRpcs.of({
      FilesOpenDirectoryPicker: ({ options }) => files.openDirectoryPicker(options),
      FilesOpenFilePicker: ({ options }, context) =>
        files
          .openFilePicker(
            sender(handoff, context).id,
            options ? { ...options, extensions: options.extensions && [...options.extensions] } : undefined,
          )
          .pipe(Effect.orDie),
      FilesReadPickedFile: ({ token, path }, context) =>
        files
          .readPickedFile(sender(handoff, context).id, token, path)
          .pipe(Effect.map((buffer) => new Uint8Array(buffer)), Effect.orDie),
      FilesReleasePickedFiles: ({ token }, context) =>
        Effect.sync(() => files.releasePickedFiles(sender(handoff, context).id, token)),
      FilesSaveFilePicker: ({ options }) => files.saveFilePicker(options),
      FilesOpenExternal: ({ url }) => openExternalURL(url),
      FilesOpenLocalFile: ({ url }) => openLocalFileURL(url),
      FilesOpenPath: ({ path, application }) =>
        files.openPath(path, application).pipe(
          Effect.map((result) => result ?? null),
          Effect.orDie,
        ),
      FilesRevealPath: ({ path }) => files.revealPath(path),
      FilesReadClipboardImage: () =>
        Effect.sync(() => {
          const image = files.readClipboardImage()
          return image ? { ...image, buffer: new Uint8Array(image.buffer) } : null
        }),
      FilesWriteClipboardText: ({ text }) => Effect.sync(() => files.writeClipboardText(text)),
    })
  }),
)

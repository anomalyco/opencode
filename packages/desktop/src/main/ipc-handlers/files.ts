import { Effect } from "effect"
import { FileRpcs } from "../../shared/ipc-rpc"
import { createFileCapabilities, openExternalURL, openLocalFileURL } from "../files"
import { IpcPortHandoff } from "../ipc-transport"
import { sender } from "./context"

export function fileHandlers(files: ReturnType<typeof createFileCapabilities>) {
  return FileRpcs.toLayer(
    Effect.gen(function* () {
      const handoff = yield* IpcPortHandoff
      return FileRpcs.of({
        FilesOpenDirectoryPicker: ({ options }) => Effect.promise(() => files.openDirectoryPicker(options)),
        FilesOpenFilePicker: ({ options }, context) =>
          Effect.promise(() =>
            files.openFilePicker(
              sender(handoff, context).id,
              options ? { ...options, extensions: options.extensions && [...options.extensions] } : undefined,
            ),
          ),
        FilesReadPickedFile: ({ token, path }, context) =>
          Effect.promise(
            async () => new Uint8Array(await files.readPickedFile(sender(handoff, context).id, token, path)),
          ),
        FilesReleasePickedFiles: ({ token }, context) =>
          Effect.sync(() => files.releasePickedFiles(sender(handoff, context).id, token)),
        FilesSaveFilePicker: ({ options }) => Effect.promise(() => files.saveFilePicker(options)),
        FilesOpenExternal: ({ url }) => Effect.sync(() => openExternalURL(url)),
        FilesOpenLocalFile: ({ url }) => Effect.sync(() => openLocalFileURL(url)),
        FilesOpenPath: ({ path, application }) =>
          Effect.promise(async () => (await files.openPath(path, application)) ?? null),
        FilesRevealPath: ({ path }) => Effect.promise(() => files.revealPath(path)),
        FilesReadClipboardImage: () =>
          Effect.sync(() => {
            const image = files.readClipboardImage()
            return image ? { ...image, buffer: new Uint8Array(image.buffer) } : null
          }),
      })
    }),
  )
}

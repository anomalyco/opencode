import { Effect } from "effect"
import { AttachmentSizeLimitError, FileRpcs } from "../../shared/ipc-rpc"
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
          .pipe(attachmentSizeLimitFailure),
      FilesReadPickedFile: ({ token, path }, context) =>
        files.readPickedFile(sender(handoff, context).id, token, path).pipe(
          Effect.map((buffer) => new Uint8Array(buffer)),
          attachmentSizeLimitFailure,
        ),
      FilesReleasePickedFiles: ({ token }, context) =>
        Effect.sync(() => files.releasePickedFiles(sender(handoff, context).id, token)),
      FilesSaveFile: ({ options, content }) => files.saveFile(options, content).pipe(Effect.orDie),
      FilesOpenExternal: ({ url }) => openExternalURL(url).pipe(Effect.asVoid),
      FilesOpenBrowser: ({ url }) => (/^https?:/i.test(url) ? openExternalURL(url) : Effect.succeed(false)),
      FilesOpenLocalFile: ({ url }) => openLocalFileURL(url),
      FilesOpenPath: ({ path, application }) =>
        files.openPath(path, application).pipe(
          Effect.map((result) => result ?? null),
          Effect.orDie,
        ),
      FilesRevealPath: ({ path }) => files.revealPath(path),
      FilesReadClipboardImage: () => files.readClipboardImage(),
      FilesWriteClipboardText: ({ text }) => files.writeClipboardText(text),
    })
  }),
)

function attachmentSizeLimitFailure<A>(
  effect: Effect.Effect<A, unknown, never>,
): Effect.Effect<A, AttachmentSizeLimitError> {
  return effect.pipe(
    Effect.catch((error) => (error instanceof AttachmentSizeLimitError ? Effect.fail(error) : Effect.die(error))),
  )
}

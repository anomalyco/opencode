import { Effect } from "effect"
import { FileRpcs } from "../../shared/ipc-rpc"
import { DesktopFiles, openExternalURL, openLocalFileURL } from "../files"
import { IpcPortHandoff } from "../ipc-transport"
import { scoped } from "../native/logging"
import { sender } from "./context"

// Any failure raised by the handlers below - typed failures and thrown errors alike - must reach
// the renderer with its real message. The RPC contract only carries typed successes, so a failure
// travels as a defect; Effect treats thrown errors as defects too. Historically the renderer
// flattened any defect into a generic "Desktop IPC handler failed"; log the cause here and re-raise
// the readable message so the renderer can decode it.
const surfaced = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, never, R> =>
  effect.pipe(
    Effect.catch((error) =>
      scoped("files", Effect.logError("desktop file handler failed", { error })).pipe(
        Effect.andThen(Effect.die(toMessage(error))),
      ),
    ),
    Effect.catchDefect((defect) =>
      scoped("files", Effect.logError("desktop file handler crashed", { defect })).pipe(
        Effect.andThen(Effect.die(toMessage(defect))),
      ),
    ),
  )

const toMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const fileHandlers = FileRpcs.toLayer(
  Effect.gen(function* () {
    const files = yield* DesktopFiles.Service
    const handoff = yield* IpcPortHandoff
    return FileRpcs.of({
      FilesOpenDirectoryPicker: ({ options }) => files.openDirectoryPicker(options),
      FilesOpenFilePicker: ({ options }, context) =>
        Effect.suspend(() =>
          files
            .openFilePicker(
              sender(handoff, context).id,
              options ? { ...options, extensions: options.extensions && [...options.extensions] } : undefined,
            )
            .pipe(surfaced),
        ),
      FilesReadPickedFile: ({ token, path }, context) =>
        Effect.suspend(() =>
          files
            .readPickedFile(sender(handoff, context).id, token, path)
            .pipe(Effect.map((buffer) => new Uint8Array(buffer)), surfaced),
        ),
      FilesReleasePickedFiles: ({ token }, context) =>
        Effect.sync(() => files.releasePickedFiles(sender(handoff, context).id, token)).pipe(surfaced),
      FilesSaveFile: ({ options, content }) => files.saveFile(options, content).pipe(surfaced),
      FilesOpenExternal: ({ url }) => openExternalURL(url),
      FilesOpenLocalFile: ({ url }) => openLocalFileURL(url),
      FilesOpenPath: ({ path, application }) =>
        files.openPath(path, application).pipe(
          Effect.map((result) => result ?? null),
          surfaced,
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

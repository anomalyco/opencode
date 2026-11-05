import { randomUUID } from "node:crypto"
import { ByteSize, Effect, Exit, FileSystem } from "effect"
import { nativeT } from "../native/translations"
import {
  createPickedFileState,
  transitionPickedFiles,
  type PickedFileCommand,
  type PickedFileEvent,
  type PickedRejectReason,
} from "./attachment-picker-machine"

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

/**
 * The files each renderer picked and may read. `watch` follows a renderer while it holds an open dialog or a selection,
 * and calls `clear` once that renderer reloads or closes; it returns a function that stops following.
 */
export function createPickedFileAuthorizations(
  read: (path: string, maxBytes: number) => Effect.Effect<ArrayBuffer, unknown>,
  watch?: (sender: number, clear: () => void) => () => void,
) {
  let state = createPickedFileState()
  const watchers = new Map<number, () => void>()

  // Returns the command that answers the event, if any.
  const dispatch = (event: PickedFileEvent) => {
    const next = transitionPickedFiles(state, event)
    state = next.state
    next.commands.forEach((command) => {
      if (command.type === "watch-sender" && watch)
        watchers.set(
          command.sender,
          watch(command.sender, () => dispatch({ type: "sender.cleared", sender: command.sender })),
        )

      if (command.type !== "unwatch-sender") return
      watchers.get(command.sender)?.()
      watchers.delete(command.sender)
    })

    return next.commands.find((command) => command.type !== "watch-sender" && command.type !== "unwatch-sender")
  }

  return {
    /** Starts a native file dialog for `sender`; returns its id, or undefined once disposed. */
    open(sender: number) {
      const reply = dispatch({ type: "picker.opened", sender })

      return reply?.type === "picker-opened" ? reply.picker : undefined
    },
    /** Grants the dialog's files; undefined when its renderer reloaded or closed while the dialog was open. */
    grant(picker: number, paths: readonly string[]) {
      const reply = dispatch({
        type: "selection.granted",
        picker,
        token: randomUUID(),
        paths,
        budget: MAX_ATTACHMENT_BYTES,
      })

      return reply?.type === "granted" ? reply.token : undefined
    },
    /** Ends a dialog that granted nothing. */
    close(picker: number) {
      dispatch({ type: "picker.closed", picker })
    },
    read: Effect.fn("DesktopFiles.readPickedFile")(function* (sender: number, token: string, path: string) {
      const claim = dispatch({ type: "read.requested", sender, token, path })

      if (claim?.type !== "read") throw rejection(claim)

      const exit = yield* read(path, claim.maxBytes).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => dispatch({ type: "read.cancelled", attempt: claim.attempt, token, path })),
        ),
        Effect.exit,
      )

      const settled = dispatch(
        Exit.isSuccess(exit)
          ? { type: "read.succeeded", attempt: claim.attempt, token, path, bytes: exit.value }
          : { type: "read.failed", attempt: claim.attempt, token, path },
      )

      if (settled?.type === "resolve" || (settled?.type === "reject" && settled.reason === "read-failed"))
        return yield* exit

      throw rejection(settled)
    }),
    release(sender: number, token: string) {
      dispatch({ type: "selection.released", sender, token })
    },
    dispose() {
      dispatch({ type: "disposed" })
    },
  }
}

function rejection(reply: PickedFileCommand | undefined) {
  const reason: PickedRejectReason = reply?.type === "reject" ? reply.reason : "not-selected"

  if (reason === "size-limit")
    return new Error(nativeT("desktop.picker.error.sizeLimit", { limit: MAX_ATTACHMENT_BYTES / 1024 / 1024 }))

  return new Error(nativeT("desktop.picker.error.notSelected"))
}

export function assertAttachmentBudget(files: { size: number }[]) {
  const total = files.reduce((sum, file) => sum + file.size, 0)

  if (total <= MAX_ATTACHMENT_BYTES) return
  throw new Error(nativeT("desktop.picker.error.sizeLimit", { limit: MAX_ATTACHMENT_BYTES / 1024 / 1024 }))
}

export function readAttachment(filePath: string, maxBytes = MAX_ATTACHMENT_BYTES) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const file = yield* fs.open(filePath, { flag: "r" })
      const info = yield* file.stat

      if (info.size > ByteSize.bytes(maxBytes))
        throw new Error(nativeT("desktop.picker.error.sizeLimit", { limit: MAX_ATTACHMENT_BYTES / 1024 / 1024 }))

      const bytes = new Uint8Array(Number(info.size))
      let offset = 0

      while (offset < bytes.byteLength) {
        const read = Number(yield* file.read(bytes.subarray(offset)))

        if (read === 0) break
        offset += read
      }

      return bytes.buffer.slice(0, offset)
    }),
  )
}

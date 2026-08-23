import { randomUUID } from "node:crypto"
import { Effect, FileSystem } from "effect"
import { nativeT } from "../native/translations"

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export function createPickedFileAuthorizations(
  read: (path: string, maxBytes: number) => Effect.Effect<ArrayBuffer, unknown>,
  budget = MAX_ATTACHMENT_BYTES,
) {
  const selections = new Map<string, { sender: number; paths: Set<string>; remaining: number }>()

  return {
    add(sender: number, paths: string[]) {
      const token = randomUUID()
      selections.set(token, { sender, paths: new Set(paths), remaining: budget })
      return token
    },
    read: Effect.fn("DesktopFiles.readPickedFile")(function* (sender: number, token: string, path: string) {
      const selection = selections.get(token)
      if (selection?.sender !== sender || !selection.paths.delete(path))
        throw new Error(nativeT("desktop.picker.error.notSelected"))
      const bytes = yield* read(path, selection.remaining)
      selection.remaining -= bytes.byteLength
      if (selection.paths.size === 0) selections.delete(token)
      return bytes
    }),
    release(sender: number, token: string) {
      if (selections.get(token)?.sender === sender) selections.delete(token)
    },
  }
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
      if (info.size > FileSystem.Size(maxBytes))
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

import { randomUUID } from "node:crypto"
import { open } from "node:fs/promises"

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export function createPickedFileAuthorizations(
  read: (path: string, maxBytes: number) => Promise<ArrayBuffer> = readAttachment,
  budget = MAX_ATTACHMENT_BYTES,
) {
  const selections = new Map<string, { sender: number; paths: Set<string>; remaining: number }>()

  return {
    add(sender: number, paths: string[]) {
      const token = randomUUID()
      selections.set(token, { sender, paths: new Set(paths), remaining: budget })
      return token
    },
    async read(sender: number, token: string, path: string) {
      const selection = selections.get(token)
      if (selection?.sender !== sender || !selection.paths.delete(path))
        throw new Error("File was not selected by the picker")
      const bytes = await read(path, selection.remaining)
      selection.remaining -= bytes.byteLength
      if (selection.paths.size === 0) selections.delete(token)
      return bytes
    },
    release(sender: number, token: string) {
      if (selections.get(token)?.sender === sender) selections.delete(token)
    },
  }
}

export function assertAttachmentBudget(files: { size: number }[]) {
  const total = files.reduce((sum, file) => sum + file.size, 0)
  if (total <= MAX_ATTACHMENT_BYTES) return
  throw new Error(`Selected attachments exceed the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit`)
}

export async function readAttachment(filePath: string, maxBytes = MAX_ATTACHMENT_BYTES) {
  const file = await open(filePath, "r")
  try {
    const info = await file.stat()
    if (info.size > maxBytes)
      throw new Error(`Selected attachments exceed the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit`)
    const bytes = Buffer.allocUnsafe(info.size)
    let offset = 0
    while (offset < info.size) {
      const result = await file.read(bytes, offset, info.size - offset, offset)
      if (result.bytesRead === 0) break
      offset += result.bytesRead
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + offset) as ArrayBuffer
  } finally {
    await file.close()
  }
}

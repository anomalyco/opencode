import type { OpenCodeClient, SessionMessageInfo } from "@opencode/client/promise"
import type { MediaCache } from "@/runtime/server/media"

/** A file in a call's result, by the message it is in, the call's ID and its position in the call's content. */
export type ToolFileInput = {
  sessionID: string
  messageID: string
  callID: string
  index: number
  mime: string
}

export type ToolFileCache = {
  peek(callID: string, index: number): string | undefined
  load(input: ToolFileInput, signal?: AbortSignal): Promise<string | undefined>
  dispose(): void
}

/**
 * Reads tool-result files the store keeps without their bytes (`omitToolFileData`) again from their message, one at a
 * time as they show. A file comes back as a `media:` ref when the server stores media in blobs, and otherwise inline;
 * the inline bytes become an object URL, so the message read is the only copy of them on the heap, and only until it
 * is collected.
 */
export function createToolFileCache(getApi: () => Pick<OpenCodeClient, "session">, media: MediaCache): ToolFileCache {
  const urls = new Map<string, string>()
  const owned = new Set<string>()
  const reads = new Map<string, Promise<SessionMessageInfo>>()

  let disposed = false

  // Tiles of one message ask together, so they share its read.
  const read = (sessionID: string, messageID: string) => {
    const key = `${sessionID}:${messageID}`

    const pending =
      reads.get(key) ??
      getApi()
        .session.message.get({ sessionID, messageID })
        .finally(() => reads.delete(key))

    reads.set(key, pending)

    return pending
  }

  return {
    peek(callID, index) {
      if (disposed) return undefined

      return urls.get(`${callID}:${index}`)
    },
    load(input, signal) {
      const key = `${input.callID}:${input.index}`
      const cached = urls.get(key)

      if (disposed || signal?.aborted) return Promise.resolve(undefined)

      if (cached) return Promise.resolve(cached)

      return read(input.sessionID, input.messageID).then((message) => {
        const file = toolFile(message, input.callID, input.index)

        if (!file || disposed || signal?.aborted) return undefined

        if (!file.uri.startsWith("data:")) {
          return media.load(file.uri, file.mime, signal).then((url) => {
            if (url && !disposed) urls.set(key, url)

            return url
          })
        }

        const url = urls.get(key) ?? URL.createObjectURL(dataBlob(file.uri, file.mime))

        urls.set(key, url)
        owned.add(url)

        return url
      })
    },
    dispose() {
      disposed = true
      reads.clear()
      owned.forEach((url) => URL.revokeObjectURL(url))
      owned.clear()
      urls.clear()
    },
  }
}

function toolFile(message: SessionMessageInfo, callID: string, index: number) {
  if (message.type !== "assistant") return undefined
  const tool = message.content.findLast((part) => part.type === "tool" && part.id === callID)

  if (tool?.type !== "tool" || !("content" in tool.state)) return undefined
  const item = tool.state.content?.[index]

  return item?.type === "file" ? item : undefined
}

function dataBlob(uri: string, mime: string) {
  const comma = uri.indexOf(",")
  const body = uri.slice(comma + 1)

  if (!uri.slice(0, comma).endsWith(";base64")) return new Blob([decodeURIComponent(body)], { type: mime })

  return new Blob([Uint8Array.from(atob(body), (char) => char.charCodeAt(0))], { type: mime })
}

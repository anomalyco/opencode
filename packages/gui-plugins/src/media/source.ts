import { mediaHashFromUri } from "@opencode/client/promise"
import type { MountedSession } from "@opencode/plugin/gui"
import { onCleanup } from "solid-js"
import { mimeOf, type MediaSource } from "./collect"

export type MediaLoader = (session: MountedSession, source: MediaSource, mime: string) => Promise<string | undefined>

/**
 * Resolves item sources to URLs an `<img>` or `<video>` loads, once per item while the panel stays mounted. Object
 * URLs stay valid until the panel unmounts: a tile or an open preview keeps the URL it was given.
 */
export function createMediaLoader(): MediaLoader {
  const controller = new AbortController()
  const loaded = new Map<string, Promise<string | undefined>>()
  const objects = new Set<string>()

  onCleanup(() => {
    controller.abort()
    objects.forEach((url) => URL.revokeObjectURL(url))
  })

  const blob = (bytes: Uint8Array | ArrayBuffer, mime: string) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }))

    objects.add(url)

    return url
  }

  const media = async (session: MountedSession, uri: string, mime: string) => {
    const hash = mediaHashFromUri(uri)

    if (!hash) return undefined

    return blob(await session.server.client.experimental.media.get({ hash }, { signal: controller.signal }), mime)
  }

  // Like the timeline's Markdown images: an absolute path reads from its own folder, so files outside the project load.
  const path = async (session: MountedSession, file: string, mime: string) => {
    const drive = /^[a-z]:\//i.test(file)
    const absolute = drive || file.startsWith("/")
    const split = file.lastIndexOf("/")

    const bytes = await session.server.client.file.read(
      {
        path: absolute ? file.slice(split + 1) : file,
        location: { directory: absolute ? file.slice(0, split) || "/" : session.directory },
      },
      { signal: controller.signal },
    )

    return blob(bytes, mime === "application/octet-stream" ? mimeOf(file) : mime)
  }

  // The store keeps tool output without its inline bytes; the message as the server stores it still has them.
  const tool = async (session: MountedSession, source: Extract<MediaSource, { type: "tool" }>, mime: string) => {
    const message = await session.server.client.session.message.get(
      { sessionID: session.id, messageID: source.messageID },
      { signal: controller.signal },
    )

    if (message.type !== "assistant") return undefined
    const part = message.content.find((item) => item.type === "tool" && item.id === source.toolID)
    const state = part?.type === "tool" ? part.state : undefined

    const content =
      state?.status === "completed" || state?.status === "error" ? state.content?.[source.index] : undefined

    if (content?.type !== "file") return undefined

    if (content.uri.startsWith("media:")) return media(session, content.uri, mime)

    return content.uri === `data:${mime};base64,` ? undefined : content.uri
  }

  const load = (session: MountedSession, source: MediaSource, mime: string): Promise<string | undefined> => {
    if (source.type === "url") return Promise.resolve(source.url)

    if (source.type === "media") return media(session, source.uri, mime)

    if (source.type === "path") return path(session, source.path, mime)

    return tool(session, source, mime)
  }

  return (session, source, mime) => {
    const key = [session.key, session.directory, JSON.stringify(source)].join("\n")
    const existing = loaded.get(key)

    if (existing) return existing
    const pending = load(session, source, mime)

    loaded.set(key, pending)
    // A failed load can be tried again the next time its tile mounts.
    pending.catch(() => loaded.delete(key))

    return pending
  }
}

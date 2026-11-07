import { mediaHashFromUri, type PromptAttachment } from "@opencode/client/promise"
import type { MountedSession } from "@opencode/plugin/gui"
import type { SessionMedia } from "@opencode/schema/session-media"
import { createSignal, onCleanup } from "solid-js"

type MediaSource = SessionMedia.Source

export type MediaLoader = {
  /** The item's URL, or undefined when its bytes are gone (e.g. a deleted file). */
  load(session: MountedSession, source: MediaSource, mime: string): Promise<string | undefined>
  /** The last load of the item rejected or found no bytes, so the viewer can skip it. Reactive. */
  failed(session: MountedSession, source: MediaSource): boolean
}

/**
 * Resolves item sources to URLs an `<img>` or `<video>` loads, once per item while the panel stays mounted. Object
 * URLs stay valid until the panel unmounts: a tile or an open preview keeps the URL it was given.
 */
export function createMediaLoader(): MediaLoader {
  const controller = new AbortController()
  const loaded = new Map<string, Promise<string | undefined>>()
  const objects = new Set<string>()
  const [failures, setFailures] = createSignal<ReadonlySet<string>>(new Set())

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

    return blob(bytes, mime)
  }

  // Inline bytes stay in their message; a page names the message and where in it they are.
  const message = (session: MountedSession, messageID: string) =>
    session.server.client.session.message.get({ sessionID: session.id, messageID }, { signal: controller.signal })

  const attachment = async (session: MountedSession, source: Extract<MediaSource, { type: "attachment" }>) => {
    const found = await message(session, source.messageID)
    // Stored media comes back as a ref, which the generated message type does not list.
    const files: readonly PromptAttachment[] = found.type === "user" ? (found.files ?? []) : []
    const file = files[source.index]

    if (!file) return undefined

    if ("uri" in file) return media(session, file.uri, file.mime)

    return file.data ? `data:${file.mime};base64,${file.data}` : undefined
  }

  const tool = async (session: MountedSession, source: Extract<MediaSource, { type: "tool" }>, mime: string) => {
    const found = await message(session, source.messageID)

    if (found.type !== "assistant") return undefined
    const part = found.content.find((item) => item.type === "tool" && item.id === source.toolID)
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

    if (source.type === "attachment") return attachment(session, source)

    return tool(session, source, mime)
  }

  const keyOf = (session: MountedSession, source: MediaSource) =>
    [session.key, session.directory, JSON.stringify(source)].join("\n")

  const fail = (key: string) => {
    if (!controller.signal.aborted) setFailures((previous) => new Set([...previous, key]))
  }

  return {
    load(session, source, mime) {
      const key = keyOf(session, source)
      const existing = loaded.get(key)

      if (existing) return existing
      const pending = load(session, source, mime)

      loaded.set(key, pending)
      pending.then(
        (url) => url === undefined && fail(key),
        () => {
          // A failed load can be tried again the next time its card mounts.
          loaded.delete(key)
          fail(key)
        },
      )

      return pending
    },
    failed: (session, source) => failures().has(keyOf(session, source)),
  }
}

import { mediaHashFromUri, type LocationRef, type PromptAttachment, type SessionMessageInfo } from "@opencode/client"
import path from "node:path"
import { deduplicateVisibleImages } from "../../prompt/attachment"
import { toolDisplayContent } from "../../util/tool-display"

type MediaKind = "image" | "video" | "other"

export type MediaItem = Readonly<{
  /** Stable for the same message and position, so a clicked item can be found again in a recollected gallery. */
  id: string
  kind: MediaKind
  mime: string
  /** A `data:` URI, a `media:<hash>` ref, or a `file://` URL of a file on the server's machine. */
  uri: string
  name?: string
  /** An absolute path on this terminal's machine, such as a composer draft's file. Preferred when it exists. */
  path?: string
  /** The Location a `file://` uri lies in, so a remote server can still read it. */
  location?: LocationRef
}>

const PLAYABLE_VIDEO = new Set(["video/mp4", "video/quicktime", "video/x-m4v"])

const EXTENSIONS: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".webp": "image/webp",
}

/** The mime type for a file name with a known image or video extension. */
export function mediaMime(name: string) {
  return EXTENSIONS[path.extname(name).toLowerCase()]
}

/** The kind from the mime type, or from the name's extension when the mime type is missing or generic. */
export function mediaKind(mime: string, name?: string): MediaKind {
  const type = mime.toLowerCase()
  if (type.startsWith("image/")) return "image"
  if (type.startsWith("video/")) return "video"
  if (type && type !== "application/octet-stream") return "other"
  const sniffed = name ? mediaMime(name) : undefined
  if (sniffed) return mediaKind(sniffed)
  return "other"
}

/** Whether `<video>` can open the container: MP4, MOV, or M4V. The codec inside is only known once it opens. */
export function isPlayableVideo(item: Pick<MediaItem, "kind" | "mime" | "name" | "path">) {
  if (item.kind !== "video") return false
  if (PLAYABLE_VIDEO.has(item.mime.toLowerCase())) return true
  const name = item.path ?? item.name
  return name !== undefined && PLAYABLE_VIDEO.has(mediaMime(name) ?? "")
}

/**
 * Every image and video in a session, in transcript order: user attachments, tool file content, and the images of
 * finished image generation notices. `location` is the session's, for generated images saved as server files.
 */
export function collectSessionMedia(messages: readonly SessionMessageInfo[], location?: LocationRef): MediaItem[] {
  return messages.flatMap((message): MediaItem[] => {
    if (message.type === "user") return userMedia(message.id, message.files ?? [])
    if (message.type === "assistant")
      return message.content.flatMap((part) =>
        part.type === "tool"
          ? toolDisplayContent(part.state).flatMap((content, index) =>
              content.type === "file" &&
              (content.uri.startsWith("data:") || mediaHashFromUri(content.uri)) &&
              mediaKind(content.mime, content.name ?? undefined) !== "other"
                ? [
                    {
                      id: `${message.id}:tool:${part.id}:${index}`,
                      kind: mediaKind(content.mime, content.name ?? undefined),
                      mime: content.mime,
                      uri: content.uri,
                      ...(content.name ? { name: content.name } : {}),
                    },
                  ]
                : [],
            )
          : [],
      )
    if (message.type === "synthetic") return generatedImage(message, location)
    return []
  })
}

// Opted-in reads leave stored files as `media:` refs, a PromptAttachment variant the generated message type omits.
function userMedia(messageID: string, files: readonly PromptAttachment[]): MediaItem[] {
  return deduplicateVisibleImages(files).flatMap((file) => {
    const kind = mediaKind(file.mime, file.name)
    if (kind === "other") return []
    return [
      {
        id: `${messageID}:file:${files.indexOf(file)}`,
        kind,
        mime: file.mime,
        uri: "uri" in file ? file.uri : `data:${file.mime};base64,${file.data}`,
        ...(file.name ? { name: file.name } : {}),
      },
    ]
  })
}

function generatedImage(
  message: Extract<SessionMessageInfo, { type: "synthetic" }>,
  location: LocationRef | undefined,
): MediaItem[] {
  const metadata = message.metadata
  if (metadata?.source !== "experimental_image_generate" || metadata.state !== "completed") return []
  // The notice's metadata only has the path without its extension; the saved file is named in the notice text.
  const file = /Saved image: (.+) \([^()\r\n]+\)\./.exec(message.text)?.[1]
  // The server's path, POSIX or Windows regardless of this machine's OS.
  if (!file || !/^(?:\/|[a-z]:[\\/])/i.test(file)) return []
  const url = new URL("file:///")
  url.pathname = file.replaceAll("%", "%25").replaceAll("\\", "/")
  return [
    {
      id: `${message.id}:generated`,
      kind: "image",
      mime: mediaMime(file) ?? "image/png",
      uri: url.href,
      name: file.split(/[\\/]/).at(-1),
      ...(location ? { location } : {}),
    },
  ]
}

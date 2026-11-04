import { mediaHashFromUri, type LocationRef, type PromptAttachment, type SessionMessageInfo } from "@opencode/client"
import path from "node:path"
import { deduplicateVisibleImages } from "../../prompt/attachment"
import { toolDisplayContent } from "../../util/tool-display"

export type MediaItem = Readonly<{
  /** Stable for the same message and position, so a clicked item can be found again in a recollected gallery. */
  id: string
  kind: "image" | "video" | "other"
  mime: string
  /** A `data:` URI, a `media:<hash>` ref, or a `file://` URL of a file on the server's machine. */
  uri: string
  name?: string
  /** An absolute path on this terminal's machine, such as a composer draft's file. Preferred when it exists. */
  path?: string
  /** The Location a `file://` uri lies in, so a remote server can still read it. */
  location?: LocationRef
}>

export const MEDIA_EXTENSIONS: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
}

const PLAYABLE = Object.values(MEDIA_EXTENSIONS).filter((mime) => mime.startsWith("video/"))

export function mediaMime(name: string): string | undefined {
  return MEDIA_EXTENSIONS[path.extname(name).toLowerCase()]
}

/** The kind from the mime type, or from the name's extension when the mime type is missing or generic. */
export function mediaKind(mime: string, name?: string): MediaItem["kind"] {
  const type = mime.toLowerCase()
  if (type.startsWith("image/")) return "image"
  if (type.startsWith("video/")) return "video"
  if (type && type !== "application/octet-stream") return "other"
  const sniffed = name && mediaMime(name)
  return sniffed ? mediaKind(sniffed) : "other"
}

/** Whether `<video>` can open the container: MP4, MOV, or M4V. The codec inside is only known once it opens. */
export function isPlayableVideo(item: Pick<MediaItem, "kind" | "mime" | "name" | "path">) {
  return (
    item.kind === "video" &&
    [item.mime.toLowerCase(), mediaMime(item.path ?? item.name ?? "")].some((mime) => mime && PLAYABLE.includes(mime))
  )
}

/**
 * Every image and video in a session, in transcript order: user attachments, tool file content, and the images of
 * finished image generation notices. `location` is the session's, for generated images saved as server files.
 */
export function collectSessionMedia(messages: readonly SessionMessageInfo[], location?: LocationRef): MediaItem[] {
  return messages.flatMap((message): MediaItem[] => {
    // Opted-in reads leave stored files as `media:` refs, a PromptAttachment variant the generated type omits.
    if (message.type === "user") {
      const files: readonly PromptAttachment[] = message.files ?? []
      return deduplicateVisibleImages(files).flatMap((file) =>
        item(
          `${message.id}:file:${files.indexOf(file)}`,
          file.mime,
          "uri" in file ? file.uri : `data:${file.mime};base64,${file.data}`,
          file.name,
        ),
      )
    }
    if (message.type === "assistant")
      return message.content.flatMap((part) =>
        part.type !== "tool"
          ? []
          : toolDisplayContent(part.state).flatMap((content, index) =>
              content.type === "file" && (content.uri.startsWith("data:") || mediaHashFromUri(content.uri))
                ? item(`${message.id}:tool:${part.id}:${index}`, content.mime, content.uri, content.name ?? undefined)
                : [],
            ),
      )
    if (message.type !== "synthetic") return []
    const metadata = message.metadata
    if (metadata?.source !== "experimental_image_generate" || metadata.state !== "completed") return []
    // The metadata's path lacks the extension; the notice names the saved file, a POSIX or Windows server path.
    const file = /Saved image: (.+) \([^()\r\n]+\)\./.exec(message.text)?.[1]
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
  })
}

function item(id: string, mime: string, uri: string, name?: string): MediaItem[] {
  const kind = mediaKind(mime, name)
  return kind === "other" ? [] : [{ id, kind, mime, uri, ...(name ? { name } : {}) }]
}

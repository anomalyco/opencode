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
const PLAYABLE_EXTENSION = new RegExp(
  Object.keys(MEDIA_EXTENSIONS)
    .filter((extension) => PLAYABLE.includes(MEDIA_EXTENSIONS[extension]!))
    .map((extension) => `\\${extension}`)
    .join("|"),
  "i",
)

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

export type MentionedFiles = Readonly<{
  /** This machine's home directory, for `~/` paths, when the server runs here. */
  home?: string
  /** Whether a server file exists. Read while collecting, so it may be a reactive read that starts a check. */
  exists: (file: string, location: LocationRef, messageID: string) => boolean
}>

/**
 * Every image and video in a session, in transcript order: user attachments, tool file content, the images of
 * finished image generation notices, and, given `mentioned`, the existing videos a finished reply's text names.
 * `location` is the session's, for files on the server.
 */
export function collectSessionMedia(
  messages: readonly SessionMessageInfo[],
  location?: LocationRef,
  mentioned?: MentionedFiles,
): MediaItem[] {
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
    if (message.type === "assistant") {
      const texts = message.content.filter((part) => part.type === "text")
      // A file the reply names again keeps its first tile.
      const named = new Set<string>()
      return message.content.flatMap((part): MediaItem[] => {
        if (part.type === "text") {
          // Text is read once the reply is finished, not while it streams.
          if (!location || !mentioned || message.time.completed === undefined) return []
          return mentionedVideoPaths(part.text, location.directory, mentioned.home).flatMap(
            (file, index): MediaItem[] => {
              if (named.has(file)) return []
              named.add(file)
              if (!mentioned.exists(file, location, message.id)) return []
              const id = `${message.id}:text:${texts.indexOf(part)}:${index}`
              const name = file.split(/[\\/]/).at(-1)
              return [{ id, kind: "video", mime: mediaMime(file)!, uri: fileURL(file), name, location }]
            },
          )
        }
        if (part.type !== "tool") return []
        return toolDisplayContent(part.state).flatMap((content, index) =>
          content.type === "file" && (content.uri.startsWith("data:") || mediaHashFromUri(content.uri))
            ? item(`${message.id}:tool:${part.id}:${index}`, content.mime, content.uri, content.name ?? undefined)
            : [],
        )
      })
    }
    if (message.type !== "synthetic") return []
    const metadata = message.metadata
    if (metadata?.source !== "experimental_image_generate" || metadata.state !== "completed") return []
    // The metadata's path lacks the extension; the notice names the saved file, a POSIX or Windows server path.
    const file = /Saved image: (.+) \([^()\r\n]+\)\./.exec(message.text)?.[1]
    if (!file || !/^(?:\/|[a-z]:[\\/])/i.test(file)) return []
    return [
      {
        id: `${message.id}:generated`,
        kind: "image",
        mime: mediaMime(file) ?? "image/png",
        uri: fileURL(file),
        name: file.split(/[\\/]/).at(-1),
        ...(location ? { location } : {}),
      },
    ]
  })
}

// A span in backticks, quotes, or a markdown link target may hold spaces; elsewhere a path ends at whitespace or a
// delimiter. A quote inside a word, as in "it's", opens no span. Groups 1-5 are spans, group 6 a bare word.
const MENTION =
  /`([^`\n]+)`|(?<!\w)"([^"\n]+)"(?!\w)|(?<!\w)'([^'\n]+)'(?!\w)|\]\(<([^>\n]+)>\)|\]\(([^)\n]+?)(?:\s+"[^"\n]*")?\)|([^\s`"'()[\]<>]+)/g

/**
 * The server paths of the playable videos `text` names, deduplicated with the first mention first: absolute paths,
 * `file://` URLs, `~/` paths given `home`, and paths relative to `directory`, in the path flavor of `directory`.
 */
export function mentionedVideoPaths(text: string, directory: string, home?: string) {
  // Most replies name no video, and this skips tokenizing them.
  if (!PLAYABLE_EXTENSION.test(text)) return []
  const flavor = pathFlavor(directory)
  const files = mentions(text).flatMap((mention) => {
    const file = mentionPath(mention, flavor, home)
    return file ? [flavor.resolve(directory, file)] : []
  })
  return [...new Set(files)]
}

/** The path module for a server's paths, which follow its own OS, judged from one of its absolute paths. */
export function pathFlavor(directory: string) {
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(directory) ? path.win32 : path.posix
}

// The words and spans that end in a playable video extension. A span that does not, such as a quoted sentence, may
// hold words that do.
function mentions(text: string): string[] {
  return [...text.matchAll(MENTION)].flatMap((match) => {
    const mention = match.slice(1).find((group) => group !== undefined)!
    const trimmed = mention.trim().replace(/^\*+|[*.,;:!?]+$/g, "")
    const mime = mediaMime(trimmed)
    if (mime && PLAYABLE.includes(mime)) return [trimmed]
    return match[6] === undefined ? mentions(mention) : []
  })
}

function mentionPath(mention: string, flavor: typeof path.posix, home?: string) {
  const file = /^file:/i.test(mention) ? fileURLPath(mention) : mention
  if (!file) return undefined
  if (/^[a-z]:[\\/]/i.test(file)) return flavor === path.win32 ? file : undefined
  // Other schemes, such as http:, data:, and media:, name no server file.
  if (/^[a-z][a-z\d+.-]*:/i.test(file)) return undefined
  if (/^~[\\/]/.test(file)) return home && flavor.join(home, file.slice(2))
  return file
}

function fileURLPath(mention: string) {
  const url = URL.parse(mention)
  if (url?.protocol !== "file:" || (url.host !== "" && url.host !== "localhost")) return undefined
  // A malformed escape makes decodeURIComponent throw.
  try {
    return decodeURIComponent(url.pathname).replace(/^\/(?=[a-z]:\/)/i, "")
  } catch {
    return undefined
  }
}

// The `file://` URL of a POSIX or Windows server path.
function fileURL(file: string) {
  const url = new URL("file:///")
  url.pathname = file.replaceAll("%", "%25").replaceAll("\\", "/")
  return url.href
}

function item(id: string, mime: string, uri: string, name?: string): MediaItem[] {
  const kind = mediaKind(mime, name)
  return kind === "other" ? [] : [{ id, kind, mime, uri, ...(name ? { name } : {}) }]
}

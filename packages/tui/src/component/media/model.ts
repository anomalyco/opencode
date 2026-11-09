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

export function mediaMime(name: string, flavor = path): string | undefined {
  return MEDIA_EXTENSIONS[flavor.extname(name).toLowerCase()]
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
  exists: (file: string, location: LocationRef) => boolean
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
          return mentionedVideos(part.text, location.directory, mentioned.home).flatMap((video, index): MediaItem[] => {
            if (named.has(video.file)) return []
            named.add(video.file)
            if (!mentioned.exists(video.file, location)) return []
            const id = `${message.id}:text:${texts.indexOf(part)}:${index}`
            const name = video.file.split(/[\\/]/).at(-1)
            return [{ id, kind: "video", mime: video.mime, uri: fileURL(video.file), name, location }]
          })
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

// A span in backticks, quotes, or a link target may hold spaces; a link's label is skipped. Elsewhere a path ends at
// whitespace or a delimiter, and parens wrap it unless they pair inside it, as in demo(1).mp4. A quote inside a word,
// as in "it's", opens no span. No repeat runs past a delimiter it needs, so matching takes linear time. Groups 1-3
// are quoted spans, 4 and 5 link targets, 6 a bare word.
const MENTION =
  /`([^`\n]+)`|(?<![\p{L}\p{N}_])"([^"\n]+)"(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])'([^'\n]+)'(?![\p{L}\p{N}_])|\[[^[\]\n]*\]\((?:<([^<>\n]+)>|([^()\n]*(?:\([^()\n]*\)[^()\n]*)*))\)|\(?((?:[^\s`"'()[\]<>]|\([^\s`"'()[\]<>]*\))+)\)?/gu

/**
 * The playable videos `text` names, deduplicated with the first mention first, as server paths in the path flavor of
 * `directory`: absolute paths, `file://` URLs, `~/` paths given `home`, and paths relative to `directory`.
 */
export function mentionedVideos(text: string, directory: string, home?: string) {
  const flavor = pathFlavor(directory)
  // Most replies name no video, and only the lines that do are tokenized.
  const files = text
    .split("\n")
    .filter((line) => PLAYABLE_EXTENSION.test(line))
    .flatMap(mentions)
    .flatMap((mention) => {
      const file = mentionPath(mention, flavor, home)
      return file ? [flavor.resolve(directory, file)] : []
    })
  // A UNC path, as in a session under `\\wsl.localhost`, has no file URL this terminal reads.
  return [...new Set(files)].flatMap((file) => {
    const mime = mediaMime(file, flavor)
    return mime && PLAYABLE.includes(mime) && !file.startsWith("\\\\") ? [{ file, mime }] : []
  })
}

/** The path module for a server's paths, which follow its own OS, judged from one of its absolute paths. */
export function pathFlavor(directory: string) {
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(directory) ? path.win32 : path.posix
}

// The paths a line's words and spans may be. A span with spaces may also hold several, as in `ffmpeg -i in.mov
// out.mp4`, so its words count too. A `key=value` word, such as `--output=out.mp4`, names its value.
function mentions(text: string): string[] {
  return [...text.matchAll(MENTION)].flatMap((match) => {
    // A link target is a URL: a title may follow it, and a path in it may be %-escaped.
    const target = match[4] ?? match[5]?.replace(/\s"[^"\n]*"$/, "")
    const link = target && !/^file:/i.test(target) ? (decode(target) ?? target) : target
    const span = link ?? match[1] ?? match[2] ?? match[3] ?? match[6]
    const mention = span
      .trim()
      .replace(/^\*+|(?<![*.,;:!?。、，．；：！？…])[*.,;:!?。、，．；：！？…]+$/gu, "")
      .replace(/^[\w-]+=/, "")
    return /\s/.test(span) ? [mention, ...mentions(span)] : [mention]
  })
}

function mentionPath(mention: string, flavor: typeof path.posix, home?: string) {
  // A glob, or a URL's query, names no one file.
  const file = /[*?]/.test(mention) ? undefined : /^file:/i.test(mention) ? fileURLPath(mention) : mention
  // A UNC path or a protocol-relative URL names another host, which a check would contact.
  if (!file || /^[\\/]{2}/.test(file)) return undefined
  if (/^[a-z]:[\\/]/i.test(file)) return flavor === path.win32 ? file : undefined
  // Other schemes, such as http:, data:, and media:, name no server file.
  if (/^[a-z][a-z\d+.-]*:/i.test(file)) return undefined
  if (/^~[\\/]/.test(file)) return home && flavor.join(home, file.slice(2))
  return file
}

function fileURLPath(mention: string) {
  const url = URL.parse(mention)
  // A fragment, as in `README.md#.mp4`, is not part of the file's name.
  if (url?.protocol !== "file:" || url.hash || (url.host !== "" && url.host !== "localhost")) return undefined
  return decode(url.pathname)?.replace(/^\/(?=[a-z]:\/)/i, "")
}

// A malformed escape makes decodeURIComponent throw.
function decode(text: string) {
  try {
    return decodeURIComponent(text)
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

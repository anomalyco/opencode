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
            const name = pathFlavor(video.file).basename(video.file)
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
        name: pathFlavor(file).basename(file),
        ...(location ? { location } : {}),
      },
    ]
  })
}

// A span in backticks, quotes, or a link target may hold spaces; a link's label is skipped. A quote inside a word, as
// in "it's", opens no span. Groups 1-3 are quoted spans, 4 and 5 link targets.
const SPAN =
  /`([^`\n]+)`|(?<![\p{L}\p{N}_])"([^"\n]+)"(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])'([^'\n]+)'(?![\p{L}\p{N}_])|\[[^[\]\n]*\]\((?:<([^<>\n]+)>|([^()\n]*(?:\([^()\n]*\)[^()\n]*)*))\)/u
// A word ends at whitespace or a delimiter, and parens wrap it unless they pair inside it, as in demo(1).mp4.
const WORD = /\(?((?:[^\s`"'()[\]<>]|\([^\s`"'()[\]<>]*\))+)\)?/gu
// No repeat runs past a delimiter it needs, so matching takes linear time. Group 6 is a word.
const MENTION = new RegExp(`${SPAN.source}|${WORD.source}`, "gu")

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

// The paths a line's link targets, words and spans may be. A span with spaces may also hold several, as in `ffmpeg -i
// in.mov out.mp4`, so its words count too, and only as words: nothing in a span is decoded or read as a link.
function mentions(line: string) {
  return [...line.matchAll(MENTION)].flatMap((match) => {
    // A link target is one URL: a title may follow it, and a path in it may be %-escaped. A file: URL is decoded once
    // it is parsed, and a URL of another scheme names no server file whether decoded or not.
    const target = (match[4] ?? match[5]?.replace(/\s"[^"\n]*"$/, ""))?.trim()
    if (target !== undefined) return [/^file:/i.test(target) ? target : (decode(target) ?? target)]
    const span = (match[1] ?? match[2] ?? match[3] ?? match[6]).trim()
    if (!/\s/.test(span)) return [word(span)]
    return [span, ...[...span.matchAll(WORD)].map((part) => word(part[1]))]
  })
}

// A word ends before a sentence's punctuation, may be wrapped in `*` emphasis, and names the value of a `key=value`
// flag such as `--output=out.mp4`. A lone `*` stays, so a glob is still one.
function word(text: string) {
  const bare = text.replace(/(?<![.,;:!?。、，．；：！？…])[.,;:!?。、，．；：！？…]+$/u, "")
  // Emphasis may open or close on another word. Closing `*`s go; opening ones too, unless a glob's `*/` or `*.` follows.
  return bare
    .replace(/(?<!\*)\*+$/, "")
    .replace(/^\*+(?=[^*/.\\])/, "")
    .replace(/^[\w-]+=/, "")
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

// The `file://` URL of a POSIX or Windows server path. On a POSIX server, a backslash is part of a name.
function fileURL(file: string) {
  const url = new URL("file:///")
  url.pathname = file.replaceAll("%", "%25").replaceAll("\\", pathFlavor(file) === path.win32 ? "/" : "%5C")
  return url.href
}

/**
 * The viewer's items: each file once, at its first appearance, as when a reply names the video the user attached.
 * `index` is where `item`'s file sits, or the last item without one.
 */
export function viewerMedia(items: readonly MediaItem[], item?: MediaItem) {
  const seen = new Map<string, number>()
  const unique = items.filter((entry) => {
    const key = mediaSource(entry)
    if (seen.has(key)) return false
    seen.set(key, seen.size)
    return true
  })
  return { items: unique, index: item ? (seen.get(mediaSource(item)) ?? 0) : unique.length - 1 }
}

const KIND_NAMES = { image: "Image", video: "Video", other: "File" }

/** The name to show for `item`: its file name without the path a pasted file carries as its name, or its kind. */
export function mediaName(item: Pick<MediaItem, "name" | "kind">) {
  return item.name?.split(/[\\/]/).at(-1) || KIND_NAMES[item.kind]
}

/** The file `item` shows: its path on this machine, or a `file:` URL's path on the session's server. */
export function mediaPath(item: Pick<MediaItem, "path" | "uri">) {
  if (item.path) return item.path
  if (!/^file:/i.test(item.uri)) return undefined
  const pathname = URL.parse(item.uri)?.pathname ?? item.uri
  // A Windows server's path comes back from its URL as /C:/…
  return (decode(pathname) ?? pathname).replace(/^\/(?=[a-z]:\/)/i, "")
}

// A file: URL names a path on the session's server whatever Location or encoding it came with; other URIs, such as
// media: refs and data: URIs, name their content.
function mediaSource(item: MediaItem) {
  return mediaPath({ uri: item.uri }) ?? item.uri
}

function item(id: string, mime: string, uri: string, name?: string): MediaItem[] {
  const kind = mediaKind(mime, name)
  return kind === "other" ? [] : [{ id, kind, mime, uri, ...(name ? { name } : {}) }]
}

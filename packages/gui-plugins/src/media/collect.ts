import type {
  PromptAttachment,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
  ToolContent,
} from "@opencode/client/promise"
import { turnSources } from "@opencode/session-ui/sources"
import { Option, Schema } from "effect"

/** Who put an item into the session. */
export type Sender = "user" | "agent"

/** Where an item's bytes come from. */
export type MediaSource =
  /** A URL an `<img>` or `<video>` loads as is: `data:`, `blob:` or http(s). */
  | { readonly type: "url"; readonly url: string }
  /** A `media:<hash>` ref whose bytes the server keeps (`experimental.media_blob`). */
  | { readonly type: "media"; readonly uri: string }
  /** A file the server reads, absolute or relative to the session's directory. */
  | { readonly type: "path"; readonly path: string }
  /** Tool output whose inline bytes the app's message store leaves out; the full message has them. */
  | { readonly type: "tool"; readonly messageID: string; readonly toolID: string; readonly index: number }

type Base = {
  readonly id: string
  readonly from: Sender
  readonly messageID: string
  readonly time: number
}

export type MediaItem = Base & {
  readonly kind: "image" | "video"
  readonly mime: string
  readonly name?: string
  readonly source: MediaSource
}

export type FileItem = Base & {
  readonly name: string
  readonly mime?: string
  /** A workspace or absolute path the app can open. */
  readonly path?: string
  /** Bytes to download when there is no path to open. */
  readonly source?: MediaSource
  /** How the file entered the session. */
  readonly action: "attached" | "mentioned" | "created" | "returned"
}

export type LinkItem = Base & {
  readonly url: string
  readonly title?: string
  /** The hostname without `www.`. */
  readonly site: string
  readonly host: string
  /** Written in a message, opened by the agent's web fetch, or found by its web search. */
  readonly via: "text" | "fetch" | "search"
}

export type SessionMedia = {
  readonly media: readonly MediaItem[]
  readonly files: readonly FileItem[]
  readonly links: readonly LinkItem[]
}

/** Every image, video, file and link the loaded messages of a session carry, newest first. */
export function sessionMedia(messages: readonly SessionMessageInfo[]): SessionMedia {
  return combineMedia(messages.map(messageMedia))
}

const NONE: SessionMedia = Object.freeze({ media: [], files: [], links: [] })

/** One message's items, oldest first. Derive it per message, so a streaming reply does not scan the whole session. */
export function messageMedia(message: SessionMessageInfo): SessionMedia {
  if (message.type === "user") return fromUser(message)

  if (message.type === "assistant") return fromAssistant(message)

  return NONE
}

/** The items of a session's messages, given oldest first, newest first and with each link listed once. */
export function combineMedia(found: readonly SessionMedia[]): SessionMedia {
  const seen = new Map<string, LinkItem>()

  // A link keeps its first mention, and the first title any later mention gives it.
  found
    .flatMap((item) => item.links)
    .forEach((link) => {
      const key = identity(link.url)
      const existing = seen.get(key)

      if (!existing) return void seen.set(key, link)

      if (!existing.title && link.title) seen.set(key, { ...existing, title: link.title })
    })

  return {
    media: latestByPath(found.flatMap((item) => item.media).toReversed(), (item) =>
      item.source.type === "path" ? item.source.path : undefined,
    ),
    files: latestByPath(found.flatMap((item) => item.files).toReversed(), (item) => item.path),
    links: [...seen.values()].toReversed(),
  }
}

// A file the agent wrote or read again lists once, at its newest mention.
function latestByPath<T>(items: readonly T[], path: (item: T) => string | undefined) {
  const seen = new Set<string>()

  return items.filter((item) => {
    const key = path(item)

    if (key === undefined) return true

    if (seen.has(key)) return false
    seen.add(key)

    return true
  })
}

function fromUser(message: SessionMessageUser) {
  const base = { from: "user" as const, messageID: message.id, time: message.time.created }
  // Stored media may come back as refs, which the generated type does not list.
  const files: readonly PromptAttachment[] = message.files ?? []

  return {
    media: files.flatMap((file, index): MediaItem[] => {
      const kind = mediaKind(file.mime)
      const source = attachmentSource(file)

      if (!kind || !source || file.mention) return []

      return [{ ...base, id: `${message.id}:file:${index}`, kind, mime: file.mime, name: file.name, source }]
    }),
    files: files.flatMap((file, index): FileItem[] => {
      if (mediaKind(file.mime) && !file.mention) return []
      const source = attachmentSource(file)
      const path = source?.type === "path" ? source.path : undefined
      const name = file.name ?? (path ? filename(path) : undefined)

      if (!name) return []

      return [
        {
          ...base,
          id: `${message.id}:file:${index}`,
          name,
          mime: file.mime,
          path,
          source: path ? undefined : source,
          action: file.mention ? "mentioned" : "attached",
        },
      ]
    }),
    links: textLinks(message.text).map(
      (link, index): LinkItem => ({ ...base, ...link, id: `${message.id}:link:${index}`, via: "text" }),
    ),
  }
}

function fromAssistant(message: SessionMessageAssistant) {
  const base = { from: "agent" as const, messageID: message.id, time: message.time.created }
  const tools = message.content.filter((part): part is SessionMessageAssistantTool => part.type === "tool")
  const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")

  const web = turnSources([message]).steps.flatMap((step): Omit<LinkItem, keyof Base>[] => {
    if (step.type === "search") return step.results.map((result) => ({ ...result, via: "search" }))

    return step.status === "error" ? [] : [{ url: step.url, site: step.site, host: step.host, via: "fetch" }]
  })

  return {
    media: tools.flatMap((tool) => toolMedia(message, tool)).map((item) => ({ ...base, ...item })),
    files: tools.flatMap((tool) => toolFiles(tool)).map((item) => ({ ...base, ...item })),
    links: [...textLinks(text).map((link): Omit<LinkItem, keyof Base> => ({ ...link, via: "text" })), ...web].map(
      (link, index): LinkItem => ({ ...base, ...link, id: `${message.id}:link:${index}` }),
    ),
  }
}

const decodePath = Schema.decodeUnknownOption(Schema.Struct({ path: Schema.String }))

function toolPath(tool: SessionMessageAssistantTool) {
  if (tool.state.status === "streaming") return undefined

  return Option.getOrUndefined(decodePath(tool.state.input))?.path.replaceAll("\\", "/")
}

function toolContent(tool: SessionMessageAssistantTool): readonly ToolContent[] {
  if (tool.state.status !== "completed" && tool.state.status !== "error") return []

  return tool.state.content ?? []
}

function toolMedia(message: SessionMessageAssistant, tool: SessionMessageAssistantTool) {
  const path = toolPath(tool)
  const kind = path ? mediaKind(mimeOf(path)) : undefined

  // An image the agent read or wrote by path loads from that path, rather than from bytes the store leaves out.
  if (path && kind && tool.state.status === "completed" && (tool.name === "read" || tool.name === "write"))
    return [
      {
        id: `${tool.id}:path`,
        kind,
        mime: mimeOf(path),
        name: filename(path),
        source: { type: "path", path } as const,
      },
    ]

  return toolContent(tool).flatMap((item, index) => {
    if (item.type !== "file") return []
    const media = mediaKind(item.mime)

    if (!media) return []

    return [
      {
        id: `${tool.id}:content:${index}`,
        kind: media,
        mime: item.mime,
        name: item.name ?? undefined,
        source: contentSource(item.uri, item.mime, { messageID: message.id, toolID: tool.id, index }),
      },
    ]
  })
}

function toolFiles(tool: SessionMessageAssistantTool): Omit<FileItem, "from" | "messageID" | "time">[] {
  if (tool.state.status !== "completed") return []

  if (tool.name === "write") {
    const path = toolPath(tool)

    return path ? [{ id: `${tool.id}:write`, name: filename(path), path, action: "created" }] : []
  }

  if (tool.name === "patch") {
    const files = tool.state.metadata?.files

    return (Array.isArray(files) ? files : []).flatMap((file, index) => {
      const added = Option.getOrUndefined(decodeAdded(file))

      return added && added.status === "added"
        ? [
            {
              id: `${tool.id}:patch:${index}`,
              name: filename(added.file),
              path: added.file,
              action: "created" as const,
            },
          ]
        : []
    })
  }

  return toolContent(tool).flatMap((item, index) => {
    if (item.type !== "file" || mediaKind(item.mime) || !item.name) return []
    const path = item.uri.startsWith("file://") ? filePath(item.uri) : undefined

    return [
      {
        id: `${tool.id}:content:${index}`,
        name: item.name,
        mime: item.mime,
        path,
        source: path || item.uri.endsWith("base64,") ? undefined : ({ type: "url", url: item.uri } as const),
        action: "returned" as const,
      },
    ]
  })
}

const decodeAdded = Schema.decodeUnknownOption(Schema.Struct({ file: Schema.String, status: Schema.String }))

function attachmentSource(file: PromptAttachment): MediaSource | undefined {
  if (file.source.type === "uri") {
    if (file.source.uri.startsWith("file://")) return { type: "path", path: filePath(file.source.uri) }

    return { type: "url", url: file.source.uri }
  }

  if ("data" in file && file.data) return { type: "url", url: `data:${file.mime};base64,${file.data}` }

  if ("uri" in file)
    return file.uri.startsWith("media:") ? { type: "media", uri: file.uri } : { type: "url", url: file.uri }

  return undefined
}

function contentSource(
  uri: string,
  mime: string,
  tool: { readonly messageID: string; readonly toolID: string; readonly index: number },
): MediaSource {
  if (uri.startsWith("media:")) return { type: "media", uri }

  if (uri.startsWith("file://")) return { type: "path", path: filePath(uri) }

  // The app's store keeps `data:<mime>;base64,` without the bytes (`omitToolFileData`).
  if (uri === `data:${mime};base64,`) return { type: "tool", ...tool }

  return { type: "url", url: uri }
}

/** The kind a MIME type shows as in the media grid, or undefined for any other file. */
export function mediaKind(mime: string) {
  if (mime.startsWith("image/")) return "image" as const

  if (mime.startsWith("video/")) return "video" as const

  return undefined
}

const TYPES = [
  ["png", "image/png"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
  ["mov", "video/quicktime"],
  ["m4v", "video/mp4"],
] as const

/** The MIME type a path's extension names, for the images and videos the grid shows. */
export function mimeOf(path: string) {
  const extension = path.match(/\.([^./]+)$/)?.[1]?.toLowerCase()

  return TYPES.find((type) => type[0] === extension)?.[1] ?? "application/octet-stream"
}

function filename(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path
}

function filePath(uri: string) {
  if (!URL.canParse(uri)) return uri.slice("file://".length)
  const path = decodeURIComponent(new URL(uri).pathname)

  // `file:///C:/x` parses to `/C:/x`.
  return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path
}

const MARKDOWN_LINK = /\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g

const BARE_URL = /https?:\/\/[^\s<>"'`]+/g

/** The http(s) links a message's text names, with the title a Markdown link gives them, in order. */
export function textLinks(text: string) {
  const titled = [...text.matchAll(MARKDOWN_LINK)].flatMap((match) => {
    const parsed = link(match[2] ?? "")

    return parsed ? [{ ...parsed, title: match[1]?.trim() || undefined, at: match.index }] : []
  })

  const covered = new Set(titled.map((item) => identity(item.url)))

  const bare = [...text.replace(MARKDOWN_LINK, (match) => " ".repeat(match.length)).matchAll(BARE_URL)].flatMap(
    (match) => {
      const parsed = link(trim(match[0]))

      return parsed && !covered.has(identity(parsed.url)) ? [{ ...parsed, title: undefined, at: match.index }] : []
    },
  )

  const seen = new Set<string>()

  return [...titled, ...bare]
    .toSorted((a, b) => a.at - b.at)
    .flatMap((item) => {
      const key = identity(item.url)

      if (seen.has(key)) return []
      seen.add(key)

      return [
        { url: item.url, title: item.title === item.url ? undefined : item.title, site: item.site, host: item.host },
      ]
    })
}

// Prose punctuation after a URL, and a closing bracket the URL never opened, are not part of it.
function trim(url: string): string {
  if (/[.,;:!?*_~]$/.test(url)) return trim(url.slice(0, -1))

  const unopened = (
    [
      ["(", ")"],
      ["[", "]"],
    ] as const
  ).some(([open, close]) => url.endsWith(close) && url.split(open).length < url.split(close).length)

  return unopened ? trim(url.slice(0, -1)) : url
}

function link(url: string) {
  if (!URL.canParse(url)) return undefined
  const parsed = new URL(url)

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined

  return { url, host: parsed.hostname, site: parsed.hostname.replace(/^www\./, "") }
}

// One link per page: the scheme, `www.`, a trailing slash and the fragment don't make another.
function identity(url: string) {
  const parsed = new URL(url)

  return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`
}

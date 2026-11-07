import type { Attachment } from "@opencode/schema/prompt"
import type { SessionMedia } from "@opencode/schema/session-media"
import type { SessionMessage } from "@opencode/schema/session-message"
import { DateTime, Option, Schema } from "effect"

type Items = {
  readonly media: readonly SessionMedia.Media[]
  readonly links: readonly SessionMedia.Link[]
}

type Tool = SessionMessage.AssistantTool

const NONE: Items = Object.freeze({ media: [], links: [] })

/**
 * Every image, video and link the given messages carry, newest first. Messages come newest first, as a page reads them.
 * Items that name the same thing (a path, a page) list once, at the newest mention; a link without a title takes the
 * title an older mention gives it.
 */
export function collect(messages: readonly SessionMessage.MediaInfo[]): Items {
  const found = messages.map(messageMedia)
  const links = found.flatMap((item) => item.links.toReversed())

  return {
    media: unique(found.flatMap((item) => item.media.toReversed())),
    links: unique(links).map((link) =>
      link.title ? link : { ...link, title: links.find((item) => item.key === link.key && item.title)?.title },
    ),
  }
}

function messageMedia(message: SessionMessage.MediaInfo): Items {
  if (message.type === "user") return fromUser(message)

  if (message.type === "assistant") return fromAssistant(message)

  return NONE
}

// The first item of each key, which is the newest when items come newest first.
function unique<T extends { readonly key?: string }>(items: readonly T[]) {
  const seen = new Set<string>()

  return items.filter((item) => {
    if (item.key === undefined) return true

    if (seen.has(item.key)) return false
    seen.add(item.key)

    return true
  })
}

function fromUser(message: SessionMessage.MediaUser): Items {
  const base = { from: "user" as const, messageID: message.id, time: DateTime.toEpochMillis(message.time.created) }
  const files: readonly Attachment[] = message.files ?? []

  return {
    media: files.flatMap((file, index): SessionMedia.Media[] => {
      const kind = mediaKind(file.mime)
      const source = attachmentSource(file, message.id, index)

      // A mention still shares the image: a pasted one is `[Image 1]` in the text, a workspace one `@shot.png`.
      if (!kind || !source) return []

      return [
        {
          ...base,
          id: `${message.id}:file:${index}`,
          key: source.type === "path" ? `path:${source.path}` : undefined,
          kind,
          mime: file.mime,
          name: file.name,
          source,
        },
      ]
    }),
    links: textLinks(message.text).map((link, index) => ({
      ...base,
      ...link,
      id: `${message.id}:link:${index}`,
      via: "text" as const,
    })),
  }
}

function fromAssistant(message: SessionMessage.Assistant): Items {
  const base = { from: "agent" as const, messageID: message.id, time: DateTime.toEpochMillis(message.time.created) }
  const tools = message.content.filter((part): part is Tool => part.type === "tool")
  const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")

  return {
    media: tools.flatMap((tool) => toolMedia(message.id, tool)).map((item) => ({ ...base, ...item })),
    links: [...textLinks(text).map((link) => ({ ...link, via: "text" as const })), ...tools.flatMap(webLinks)].map(
      (link, index) => ({ ...base, ...link, id: `${message.id}:link:${index}` }),
    ),
  }
}

const decodePath = Schema.decodeUnknownOption(Schema.Struct({ path: Schema.String }))

const decodeURL = Schema.decodeUnknownOption(Schema.Struct({ url: Schema.String }))

function toolMedia(messageID: string, tool: Tool) {
  if (tool.state.status === "streaming" || tool.state.status === "running") return []
  const path = Option.getOrUndefined(decodePath(tool.state.input))?.path.replaceAll("\\", "/")
  const kind = path ? mediaKind(mimeOf(path)) : undefined

  // An image the agent read or wrote by path loads from that path, rather than from bytes its output holds.
  if (path && kind && tool.state.status === "completed" && (tool.name === "read" || tool.name === "write"))
    return [
      {
        id: `${tool.id}:path`,
        key: `path:${path}`,
        kind,
        mime: mimeOf(path),
        name: filename(path),
        source: { type: "path" as const, path },
      },
    ]

  return (tool.state.content ?? []).flatMap((item, index) => {
    if (item.type !== "file") return []
    const media = mediaKind(item.mime)

    if (!media) return []
    const source = contentSource(item.uri, { messageID, toolID: tool.id, index })

    return [
      {
        id: `${tool.id}:content:${index}`,
        key: source.type === "path" ? `path:${source.path}` : undefined,
        kind: media,
        mime: item.mime,
        name: item.name,
        source,
      },
    ]
  })
}

// The pages the agent's web fetches opened and its web searches found. A failed fetch opened nothing.
function webLinks(tool: Tool): Omit<SessionMedia.Link, "id" | "from" | "messageID" | "time">[] {
  if (tool.state.status === "streaming" || tool.state.status === "error") return []

  if (tool.name === "webfetch") {
    const page = Option.getOrUndefined(
      decodeURL(tool.state.input).pipe(Option.flatMapNullishOr((input) => link(input.url))),
    )

    return page ? [{ ...page, via: "fetch" }] : []
  }

  if (tool.name !== "websearch" || tool.state.status !== "completed") return []

  return searchResults(tool.state.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")).map(
    (result) => ({ ...result, via: "search" }),
  )
}

// The websearch tool writes each result as a `## [title](url)` heading in its text content
// (packages/core/src/tool/plugin/websearch.ts); a result without a title repeats its URL.
function searchResults(text: string) {
  return text.split("\n").flatMap((line) => {
    if (!line.startsWith("## [") || !line.endsWith(")")) return []
    const split = line.lastIndexOf("](")

    if (split < 4) return []
    const result = link(line.slice(split + 2, -1))

    if (!result) return []
    const title = line.slice(4, split).trim()

    return [{ ...result, title: title && title !== result.url ? title : undefined }]
  })
}

function attachmentSource(file: Attachment, messageID: string, index: number): SessionMedia.Source | undefined {
  if (file.source.type === "uri") {
    if (file.source.uri.startsWith("file://")) return { type: "path", path: filePath(file.source.uri) }

    return { type: "url", url: file.source.uri }
  }

  if ("uri" in file) return { type: "media", uri: file.uri }

  // Inline bytes stay in the message; the client reads them from there when it shows the item.
  return file.data ? { type: "attachment", messageID, index } : undefined
}

function contentSource(
  uri: string,
  tool: { readonly messageID: string; readonly toolID: string; readonly index: number },
): SessionMedia.Source {
  if (uri.startsWith("media:")) return { type: "media", uri }

  if (uri.startsWith("file://")) return { type: "path", path: filePath(uri) }

  if (uri.startsWith("data:")) return { type: "tool", ...tool }

  return { type: "url", url: uri }
}

function mediaKind(mime: string) {
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

function mimeOf(path: string) {
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

  const covered = new Set(titled.map((item) => item.key))

  const bare = [...text.replace(MARKDOWN_LINK, (match) => " ".repeat(match.length)).matchAll(BARE_URL)].flatMap(
    (match) => {
      const parsed = link(trim(match[0]))

      return parsed && !covered.has(parsed.key) ? [{ ...parsed, title: undefined, at: match.index }] : []
    },
  )

  const seen = new Set<string>()

  return [...titled, ...bare]
    .toSorted((a, b) => a.at - b.at)
    .flatMap((item) => {
      if (seen.has(item.key)) return []
      seen.add(item.key)

      return [
        {
          url: item.url,
          key: item.key,
          title: item.title === item.url ? undefined : item.title,
          site: item.site,
          host: item.host,
        },
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

// One link per page: the scheme, `www.`, a trailing slash and the fragment don't make another.
function link(url: string) {
  if (!URL.canParse(url)) return undefined
  const parsed = new URL(url)

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined
  const site = parsed.hostname.replace(/^www\./, "")

  return {
    url,
    host: parsed.hostname,
    site,
    key: `link:${site}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`,
  }
}

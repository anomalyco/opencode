export * as ReadToolFileSystem from "./read-filesystem.js"

import path from "path"
import { pathToFileURL } from "url"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { lookup } from "mime-types"
import { Environment } from "../environment/index.js"
import type { Files } from "../environment/index.js"
import { FileSystem } from "../filesystem.js"
import { Mime } from "../mime.js"
import { AbsolutePath, NonNegativeInt, PositiveInt, RelativePath } from "../schema.js"

export const MAX_READ_LINES = 2_000
export const MAX_READ_BYTES = 50 * 1024
export const MAX_MEDIA_INGEST_BYTES = 20 * 1024 * 1024
const FIRST_CHUNK = 256 * 1024
const MAX_LINE_LENGTH = 2_000
const TREE_BASE = 6
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
export const MEDIA_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"])

export class BinaryFileError extends Schema.TaggedError<BinaryFileError>()("ReadTool.BinaryFileError", {
  resource: Schema.String,
}) {
  override get message() {
    return `Cannot read binary file: ${this.resource}`
  }
}

export class MediaIngestLimitError extends Schema.TaggedError<MediaIngestLimitError>()(
  "ReadTool.MediaIngestLimitError",
  {
    resource: Schema.String,
    maximumBytes: Schema.Number,
  },
) {
  override get message() {
    return `Media exceeds ${this.maximumBytes} byte ingestion limit: ${this.resource}`
  }
}

export class OffsetOutOfRangeError extends Schema.TaggedError<OffsetOutOfRangeError>()(
  "ReadTool.OffsetOutOfRangeError",
  { offset: Schema.Number },
) {
  override get message() {
    return `Offset ${this.offset} is out of range`
  }
}

export class PathKindError extends Schema.TaggedError<PathKindError>()("ReadTool.PathKindError", {
  resource: Schema.String,
  expected: Schema.Literals(["a file", "a file or directory"]),
}) {
  override get message() {
    return `Path is not ${this.expected}: ${this.resource}`
  }
}

export type ReadError =
  | Environment.NotFound
  | Environment.Failed
  | BinaryFileError
  | MediaIngestLimitError
  | OffsetOutOfRangeError
  | PathKindError

export const PageInput = Schema.Struct({
  offset: Schema.optionalKey(NonNegativeInt),
  limit: Schema.optionalKey(NonNegativeInt.check(Schema.isLessThanOrEqualTo(MAX_READ_LINES))),
})
export type PageInput = typeof PageInput.Type

export const FileContent = Schema.Struct({
  type: Schema.Literal("file"),
  ...FileSystem.Content.fields,
}).annotate({ identifier: "ReadTool.FileContent" })
export type FileContent = typeof FileContent.Type

export class TextPage extends Schema.Class<TextPage>("ReadTool.TextPage")({
  type: Schema.Literal("text-page"),
  content: Schema.String,
  mime: Schema.String,
  offset: PositiveInt,
  truncated: Schema.Boolean,
  next: Schema.optionalKey(PositiveInt),
}) {}

export interface ListEntry extends Schema.Schema.Type<typeof ListEntry> {}
export const ListEntry = Schema.Struct({
  path: RelativePath,
  type: Schema.Literals(["file", "directory", "symlink"]),
}).annotate({ identifier: "ReadTool.ListEntry" })

export class ListPage extends Schema.Class<ListPage>("ReadTool.ListPage")({
  type: Schema.Literal("list-page"),
  entries: Schema.Array(ListEntry),
  truncated: Schema.Boolean,
  next: Schema.optionalKey(PositiveInt),
}) {}

export interface Interface {
  readonly list: (path: AbsolutePath) => ReturnType<Files["list"]>
  readonly read: (
    path: AbsolutePath,
    resource: string,
    page?: PageInput,
  ) => Effect.Effect<FileContent | TextPage | ListPage, ReadError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ReadToolFileSystem") {}

const mimeType = (value: string) => lookup(value) || "application/octet-stream"

export const read = Effect.fn("ReadTool.read")(function* (
  files: Files,
  input: AbsolutePath,
  resource: string,
  page: PageInput = {},
) {
  const first = yield* files.read(input, { offset: 0, length: FIRST_CHUNK }).pipe(
    Effect.catchTag("Environment.WrongKind", (error) => {
      if (error.actual !== "directory")
        return Effect.fail(new PathKindError({ resource, expected: "a file or directory" }))
      return files.list(input).pipe(
        Effect.map((entries) => list(entries, page)),
        Effect.catchTag("Environment.WrongKind", () =>
          Effect.fail(new PathKindError({ resource, expected: "a file or directory" })),
        ),
      )
    }),
  )
  if (first instanceof ListPage) return first

  const media = Mime.detect(first.bytes)
  if (MEDIA_MIMES.has(media)) {
    if (first.info.size > MAX_MEDIA_INGEST_BYTES)
      return yield* new MediaIngestLimitError({ resource, maximumBytes: MAX_MEDIA_INGEST_BYTES })
    const whole = yield* readFile(files, input, resource)
    return {
      type: "file" as const,
      uri: pathToFileURL(input).href,
      name: path.basename(input),
      content: Buffer.from(whole.bytes).toString("base64"),
      encoding: "base64" as const,
      mime: media,
    }
  }

  const paged = first.info.size > MAX_READ_BYTES || page.offset !== undefined || page.limit !== undefined
  if (!paged) {
    if (first.bytes.includes(0)) return yield* new BinaryFileError({ resource })
    return {
      type: "file" as const,
      uri: pathToFileURL(input).href,
      name: path.basename(input),
      content: new TextDecoder().decode(first.bytes),
      encoding: "utf8" as const,
      mime: mimeType(input),
    }
  }

  if (first.bytes.length >= first.info.size) {
    const result = textPage(first.bytes, true, page)
    if (result === undefined) return yield* Effect.die("Read page did not settle for a complete first chunk")
    return yield* makeTextPage(input, resource, result, first.bytes.subarray(0, result.consumed).includes(0))
  }

  const offset = page.offset || 1
  const limit = Math.min(page.limit || MAX_READ_LINES, MAX_READ_LINES)
  const leaves = [textLeaf(first.bytes)]
  let bytes = first.bytes.length
  let lines = leaves[0].summary.lines
  let ended = false
  while (true) {
    const eof = ended || bytes >= first.info.size
    if (lines >= offset - 1 || eof) {
      const tree = textTree(leaves)
      const start = textOffset(tree, offset - 1)
      let position = 0
      const selected = Buffer.concat(
        leaves.flatMap((leaf) => {
          const leafStart = position
          position += leaf.summary.bytes
          if (position <= start) return []
          return [leaf.bytes.subarray(Math.max(0, start - leafStart))]
        }),
      )
      const result = textPage(selected, eof, { limit })
      if (result !== undefined) {
        const translated = {
          ...result,
          offset,
          ...(result.next === undefined ? { next: undefined } : { next: offset + result.next - 1 }),
        }
        const consumed = start + result.consumed
        let checked = 0
        const binary = leaves.some((leaf) => {
          const length = Math.min(leaf.summary.bytes, consumed - checked)
          checked += leaf.summary.bytes
          return length > 0 && leaf.bytes.subarray(0, length).includes(0)
        })
        return yield* makeTextPage(input, resource, translated, binary)
      }
    }

    const next = yield* readFile(files, input, resource, { offset: bytes, length: FIRST_CHUNK })
    if (next.bytes.length === 0) {
      ended = true
      continue
    }
    const leaf = textLeaf(next.bytes)
    leaves.push(leaf)
    bytes += leaf.summary.bytes
    lines += leaf.summary.lines
  }
})

const readFile = (
  files: Files,
  input: AbsolutePath,
  resource: string,
  range?: { readonly offset: number; readonly length: number },
) =>
  files
    .read(input, range)
    .pipe(
      Effect.catchTag("Environment.WrongKind", () => Effect.fail(new PathKindError({ resource, expected: "a file" }))),
    )

const makeTextPage = Effect.fnUntraced(function* (
  input: AbsolutePath,
  resource: string,
  result: NonNullable<ReturnType<typeof textPage>>,
  binary: boolean,
) {
  if (binary) return yield* new BinaryFileError({ resource })
  if (result.entries.length === 0 && result.offset !== 1)
    return yield* new OffsetOutOfRangeError({ offset: result.offset })
  return new TextPage({
    type: "text-page",
    content: result.entries.join("\n"),
    mime: mimeType(input),
    offset: result.offset,
    truncated: result.next !== undefined,
    ...(result.next === undefined ? {} : { next: result.next }),
  })
})

const list = (items: ReadonlyArray<Environment.DirEntry>, page: PageInput) => {
  const offset = page.offset || 1
  const limit = Math.min(page.limit || MAX_READ_LINES, MAX_READ_LINES)
  const visible = items
    .flatMap((item) =>
      item.type === "other"
        ? []
        : [
            ListEntry.make({
              path: RelativePath.make(item.name + (item.type === "directory" ? path.sep : "")),
              type: item.type,
            }),
          ],
    )
    .sort((a, b) =>
      a.type === "directory"
        ? b.type === "directory"
          ? a.path.localeCompare(b.path)
          : -1
        : b.type === "directory"
          ? 1
          : a.path.localeCompare(b.path),
    )
  const selected = visible.slice(offset - 1, offset - 1 + limit)
  const truncated = offset - 1 + selected.length < visible.length
  return new ListPage({
    type: "list-page",
    entries: selected,
    truncated,
    ...(truncated ? { next: offset + selected.length } : {}),
  })
}

const textPage = (bytes: Uint8Array, eof: boolean, page: PageInput) => {
  const offset = page.offset || 1
  const limit = Math.min(page.limit || MAX_READ_LINES, MAX_READ_LINES)
  const decoded = new TextDecoder().decode(bytes)
  const split = decoded.split("\n")
  const complete = eof ? (split.at(-1) === "" ? split.slice(0, -1) : split) : split.slice(0, -1)
  const available = complete.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))

  const entries: string[] = []
  let size = 0
  let next: number | undefined
  for (const [index, value] of available.slice(offset - 1).entries()) {
    const line = offset + index
    if (entries.length >= limit || size >= MAX_READ_BYTES) {
      next = line
      break
    }
    const text = value.length > MAX_LINE_LENGTH ? value.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : value
    const lineSize = Buffer.byteLength(text, "utf-8") + (entries.length > 0 ? 1 : 0)
    if (size + lineSize > MAX_READ_BYTES) {
      next = line
      break
    }
    entries.push(text)
    size += lineSize
  }
  if (next === undefined && entries.length >= limit && (!eof || offset - 1 + entries.length < available.length))
    next = offset + entries.length
  if (!eof && next === undefined) return

  const consumedLines = next === undefined ? available.length : next - 1
  const consumed = consumedLines === 0 ? 0 : (nthNewline(bytes, consumedLines) ?? bytes.length)
  return { entries, offset, next, consumed }
}

type TextSummary = { readonly bytes: number; readonly lines: number }
// Request-local augmented rope. Subtree byte and newline weights locate a line
// like an order-statistic query without repeatedly decoding the accumulated text.
// https://doi.org/10.1002/spe.4380251203
type TextNode =
  | { readonly type: "leaf"; readonly bytes: Uint8Array; readonly summary: TextSummary }
  | { readonly type: "branch"; readonly children: ReadonlyArray<TextNode>; readonly summary: TextSummary }

const textLeaf = (bytes: Uint8Array): Extract<TextNode, { readonly type: "leaf" }> => {
  let lines = 0
  for (const byte of bytes) if (byte === 10) lines++
  return { type: "leaf", bytes, summary: { bytes: bytes.length, lines } }
}

const textTree = (nodes: ReadonlyArray<TextNode>): TextNode => {
  if (nodes.length === 1) return nodes[0]
  return textTree(
    Array.from({ length: Math.ceil(nodes.length / (TREE_BASE * 2)) }, (_, index) => {
      const children = nodes.slice(index * TREE_BASE * 2, (index + 1) * TREE_BASE * 2)
      return {
        type: "branch" as const,
        children,
        summary: {
          bytes: children.reduce((total, child) => total + child.summary.bytes, 0),
          lines: children.reduce((total, child) => total + child.summary.lines, 0),
        },
      }
    }),
  )
}

const textOffset = (tree: TextNode, newline: number) => {
  if (newline === 0) return 0
  let node = tree
  let remaining = newline
  let offset = 0
  while (node.type === "branch") {
    const child = node.children.find((candidate) => {
      if (remaining <= candidate.summary.lines) return true
      remaining -= candidate.summary.lines
      offset += candidate.summary.bytes
      return false
    })
    if (!child) return tree.summary.bytes
    node = child
  }
  const end = nthNewline(node.bytes, remaining)
  return end === undefined ? tree.summary.bytes : offset + end
}

const nthNewline = (bytes: Uint8Array, count: number) => {
  let found = 0
  for (const [index, byte] of bytes.entries()) {
    if (byte !== 10) continue
    found++
    if (found === count) return index + 1
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    return Service.of({
      list: environment.files.list,
      read: (path, resource, page) => read(environment.files, path, resource, page),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Environment.node] })

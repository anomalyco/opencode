import type { BlockModel, Doc } from "@blocksuite/store"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { formatCommentNote, formatReferenceNote } from "@/utils/comment-note"
import type { FileSelection } from "@/context/file/types"
import { lineRangeLabel, lineSideNote } from "./line-reference-url"

export type DocExportAsset = {
  id: string
  mime: string
  filename: string
  dataUrl: string
}

export type DocExport = {
  text: string
  assets: DocExportAsset[]
}

type Inline = {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
}

type ExportOpts = {
  docID: string
  directory: string
  client: OpencodeClient
}

type TextLike = {
  toDelta?: () => unknown
  toString?: () => string
}

const noise = new Set([
  "id",
  "flavour",
  "children",
  "version",
  "xywh",
  "index",
  "lockedBySelf",
  "rotate",
  "scale",
  "style",
])

type TextOp = {
  insert?: unknown
  attributes?: Record<string, unknown>
}

function esc(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/_/g, "\\_").replace(/`/g, "\\`")
}

function label(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]")
}

function inline(model: BlockModel) {
  return parts(model)
    .map((op) => {
      const code = op.code ? `\`${op.text.replace(/`/g, "\\`")}\`` : esc(op.text)
      const bold = op.bold ? `**${code}**` : code
      const italic = op.italic ? `*${bold}*` : bold
      return op.strike ? `~~${italic}~~` : italic
    })
    .join("")
}

function parts(model: BlockModel): Inline[] {
  const text = model.text
  if (!text) return []
  return text
    .toDelta()
    .map((op: TextOp) => {
      if (typeof op.insert !== "string") return
      const attrs = op.attributes ?? {}
      return {
        text: op.insert,
        bold: Boolean(attrs.bold),
        italic: Boolean(attrs.italic),
        strike: Boolean(attrs.strike),
        code: Boolean(attrs.code),
      } satisfies Inline
    })
    .filter((op) => !!op)
}

function prop(model: BlockModel, key: string) {
  return (model as unknown as Record<string, unknown>)[key]
}

function str(model: BlockModel, key: string) {
  const value = prop(model, key)
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function num(model: BlockModel, key: string) {
  const value = prop(model, key)
  return typeof value === "number" ? value : undefined
}

function lineSelection(start: number, end: number): FileSelection {
  return {
    startLine: Math.min(start, end),
    endLine: Math.max(start, end),
    startChar: 0,
    endChar: 0,
  }
}

function source(model: BlockModel) {
  const value = prop(model, "sourceId")
  return typeof value === "string" && value ? value : undefined
}

function caption(model: BlockModel) {
  const value = prop(model, "caption")
  return typeof value === "string" ? value.trim() : ""
}

function raw(model: BlockModel) {
  return model.text?.toString?.() ?? ""
}

function title(model: BlockModel, name: string) {
  return str(model, "title") ?? (caption(model) || undefined) ?? str(model, "name") ?? name
}

function detail(name: string, value?: string | number | null) {
  if (value === undefined || value === null || value === "") return
  return `- ${name}: ${value}`
}

function textlike(value: unknown): value is TextLike {
  if (typeof value !== "object" || value === null) return false
  if (Array.isArray(value)) return false
  const next = value as TextLike
  return (
    typeof next.toDelta === "function" ||
    (typeof next.toString === "function" && next.toString !== Object.prototype.toString)
  )
}

function json(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null) return value
  if (typeof value !== "object") return value
  if (textlike(value)) return value.toString?.() ?? value.toDelta?.()
  if (seen.has(value)) return "[Circular]"
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => json(item, seen))
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, json(val, seen)]),
  )
}

function props(model: BlockModel) {
  return Object.fromEntries(
    model.keys
      .filter((key) => !noise.has(key))
      .map((key) => [key, json(prop(model, key))])
      .filter(([, value]) => value !== undefined && value !== "" && value !== null),
  )
}

function fence(type: string, value: string) {
  return ["```" + type, value.replace(/```/g, "\\`\\`\\`"), "```"].join("\n")
}

async function dataUrl(opts: ExportOpts, id: string) {
  const res = await opts.client.doc.asset.get(
    { docID: opts.docID, assetID: id, directory: opts.directory },
    { cache: "no-store", parseAs: "blob", throwOnError: false },
  )
  if (res.error || !res.data) return
  const blob = res.data as Blob
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const bin = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")
  const mime = media(bytes, blob.type || res.response.headers.get("content-type") || "application/octet-stream")
  return {
    mime,
    dataUrl: `data:${mime};base64,${btoa(bin)}`,
  }
}

function media(bytes: Uint8Array, mime: string) {
  const text = String.fromCharCode(...bytes.subarray(0, 16))
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif"
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp"
  if (text.startsWith("%PDF")) return "application/pdf"
  return mime.startsWith("image/") || mime === "application/pdf" ? "application/octet-stream" : mime
}

function exportable(mime: string) {
  return mime.startsWith("image/") || mime === "application/pdf"
}

function embed(model: BlockModel, name: string) {
  return [fence("json", JSON.stringify({ type: name, ...props(model) }, null, 2))]
}

function unknown(model: BlockModel) {
  const data = props(model)
  if (Object.keys(data).length === 0) return []
  return [`BlockSuite ${model.flavour}`, fence("json", JSON.stringify(data, null, 2))]
}

function plain(model: BlockModel): string[] {
  const children = () => model.children.flatMap(plain)
  if (model.flavour === "affine:page" || model.flavour === "affine:note" || model.flavour === "affine:surface") {
    return children()
  }
  if (model.flavour === "affine:paragraph" || model.flavour === "affine:list" || model.flavour === "affine:code") {
    return [raw(model).trim(), ...children()].filter(Boolean)
  }
  if (model.flavour === "opencode:file-reference") {
    return [str(model, "name") ?? str(model, "path") ?? str(model, "url") ?? "File", ...children()]
  }
  if (model.flavour === "opencode:line-reference") {
    const path = str(model, "path") ?? ""
    const start = num(model, "start")
    const end = num(model, "end")
    const range =
      str(model, "label") ??
      (start !== undefined && end !== undefined ? lineRangeLabel(start, end) : undefined)
    const comment = str(model, "comment")
    const preview = str(model, "preview")
    const head = [str(model, "name") ?? path, range, preview, comment].filter((line): line is string => !!line)
    return [...head, ...children()]
  }
  if (model.flavour === "affine:image") return [caption(model) || source(model) || "Image", ...children()]
  if (model.flavour === "affine:attachment") return [str(model, "name") ?? source(model) ?? "Attachment", ...children()]
  if (model.flavour === "affine:divider") return ["---", ...children()]
  if (model.flavour === "affine:latex") return [str(model, "latex") ?? "", ...children()].filter(Boolean)
  if (model.flavour.startsWith("affine:embed-") || model.flavour === "affine:bookmark") {
    return [title(model, model.flavour.replace("affine:", "")), str(model, "url") ?? "", ...children()].filter(Boolean)
  }
  return [...Object.values(props(model)).map((value) => String(value)), ...children()].filter(Boolean)
}

async function block(model: BlockModel, opts: ExportOpts, assets: DocExportAsset[], depth = 0): Promise<string[]> {
  const next = model.flavour === "affine:list" ? depth + 1 : depth
  const children = async () =>
    (await Promise.all(model.children.map((child) => block(child, opts, assets, next)))).flat()

  if (model.flavour === "affine:page" || model.flavour === "affine:note" || model.flavour === "affine:surface") {
    return children()
  }

  if (model.flavour === "affine:paragraph") {
    const text = inline(model).trim()
    const type = (model as { type?: unknown }).type
    const body =
      type === "quote"
        ? `> ${text}`
        : typeof type === "string" && /^h[1-6]$/.test(type)
          ? `${"#".repeat(Number(type[1]))} ${text}`
          : text
    const nested = await children()
    return [body, ...nested].filter(Boolean)
  }

  if (model.flavour === "affine:list") {
    const type = (model as { type?: unknown }).type
    const checked = (model as { checked?: unknown }).checked === true
    const order = (model as { order?: unknown }).order
    const prefix =
      type === "todo"
        ? `- [${checked ? "x" : " "}] `
        : type === "numbered"
          ? `${typeof order === "number" && order > 0 ? order : 1}. `
          : "- "
    const nested = await children()
    const pad = "  ".repeat(depth)
    return [`${pad}${prefix}${inline(model).trim()}`, ...nested]
  }

  if (model.flavour === "affine:code") {
    const lang = str(model, "language") ?? ""
    const text = raw(model)
    const head = caption(model) ? [`Code: ${caption(model)}`] : []
    const nested = await children()
    return [...head, fence(lang, text), ...nested].filter(Boolean)
  }

  if (model.flavour === "affine:divider") {
    const nested = await children()
    return ["---", ...nested]
  }

  if (model.flavour === "opencode:file-reference") {
    const name = str(model, "name") ?? str(model, "path") ?? str(model, "url") ?? "File"
    const url = str(model, "url")
    const nested = await children()
    if (!url) return [label(name), ...nested]
    return [`[${label(name)}](${url})`, ...nested]
  }

  if (model.flavour === "opencode:line-reference") {
    const path = str(model, "path") ?? ""
    const name = str(model, "name") ?? path
    const url = str(model, "url") ?? path
    const start = num(model, "start")
    const end = num(model, "end")
    const side = str(model, "side")
    const endSide = str(model, "endSide")
    const comment = str(model, "comment")
    const nested = await children()
    const selection =
      start !== undefined && end !== undefined ? lineSelection(start, end) : undefined
    const base = comment
      ? formatCommentNote({ path, selection, comment })
      : formatReferenceNote({ path, selection })
    const sideNote = lineSideNote(side, endSide)
    const note = sideNote ? `${base} ${sideNote}` : base
    const rangeLabel =
      str(model, "label") ??
      (start !== undefined && end !== undefined ? lineRangeLabel(start, end) : undefined)
    const link = rangeLabel ? `[${label(name)} ${rangeLabel}](${url})` : `[${label(name)}](${url})`
    return [note, link, ...nested].filter(Boolean)
  }

  if (model.flavour === "affine:latex") {
    const text = str(model, "latex")
    const nested = await children()
    return [text ? `$$\n${text}\n$$` : "", ...nested].filter(Boolean)
  }

  if (model.flavour === "affine:image") {
    const id = source(model)
    const nested = await children()
    if (!id) return nested
    const asset = await dataUrl(opts, id)
    if (!asset) return [`![${caption(model) || id}](attachment://${encodeURIComponent(id)})`, ...nested]
    const name = caption(model) || id
    if (exportable(asset.mime)) assets.push({ id, mime: asset.mime, filename: id, dataUrl: asset.dataUrl })
    return [`![${name}](attachment://${encodeURIComponent(id)})`, ...nested]
  }

  if (model.flavour === "affine:attachment") {
    const id = source(model)
    const name = str(model, "name") ?? id ?? "attachment"
    const meta = [detail("Type", str(model, "type")), detail("Size", num(model, "size"))].filter(
      (line): line is string => !!line,
    )
    const nested = await children()
    if (!id) return [`[${label(name)}]`, ...meta, ...nested]
    const asset = await dataUrl(opts, id)
    if (asset && exportable(asset.mime)) assets.push({ id, mime: asset.mime, filename: name, dataUrl: asset.dataUrl })
    return [`[${label(name)}](attachment://${encodeURIComponent(id)})`, ...meta, ...nested]
  }

  if (model.flavour.startsWith("affine:embed-") || model.flavour === "affine:bookmark") {
    const name = model.flavour.replace("affine:", "").replace(/^embed-/, "")
    const nested = await children()
    return [...embed(model, name), ...nested]
  }

  const nested = await children()
  return [...unknown(model), ...nested]
}

export async function docMarkdown(doc: Doc, opts: ExportOpts): Promise<DocExport> {
  const assets: DocExportAsset[] = []
  const lines = doc.root ? await block(doc.root, opts, assets) : []
  return {
    text: lines.join("\n\n").trim(),
    assets,
  }
}

export function docPlain(doc: Doc) {
  const lines = doc.root ? plain(doc.root) : []
  return lines.join("\n").trim()
}

export function ensureEditable(doc: Doc) {
  if (doc.getBlockByFlavour("affine:paragraph").length > 0) return
  doc.withoutTransact(() => {
    const notes = doc.getBlockByFlavour("affine:note")
    if (notes[0]) {
      doc.addBlock("affine:paragraph", {}, notes[0].id)
      return
    }
    const pages = doc.getBlockByFlavour("affine:page")
    if (!pages[0]) return
    const noteId = doc.addBlock("affine:note", {}, pages[0].id)
    doc.addBlock("affine:paragraph", {}, noteId)
  })
}

export function baseline(doc: Doc) {
  ensureEditable(doc)
  if (!doc.canUndo) return
  doc.resetHistory()
}

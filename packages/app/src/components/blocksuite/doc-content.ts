import type { BlockModel, Doc } from "@blocksuite/store"

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

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type ExportOpts = {
  docID: string
  baseUrl: string
  directory: string
  fetch: Fetch
}

type TextOp = {
  insert?: unknown
  attributes?: Record<string, unknown>
}

function api(opts: ExportOpts, path: string) {
  const next = new URL(path, opts.baseUrl)
  next.searchParams.set("directory", opts.directory)
  return next
}

function esc(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/_/g, "\\_").replace(/`/g, "\\`")
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

function source(model: BlockModel) {
  const value = (model as { sourceId?: unknown }).sourceId
  return typeof value === "string" && value ? value : undefined
}

function caption(model: BlockModel) {
  const value = (model as { caption?: unknown }).caption
  return typeof value === "string" ? value.trim() : ""
}

async function dataUrl(opts: ExportOpts, id: string) {
  const res = await opts.fetch(api(opts, `/doc/${opts.docID}/asset/${encodeURIComponent(id)}`), { cache: "no-store" })
  if (!res.ok) return
  const blob = await res.blob()
  const buf = await blob.arrayBuffer()
  const bin = Array.from(new Uint8Array(buf), (byte) => String.fromCharCode(byte)).join("")
  return {
    mime: blob.type || res.headers.get("content-type") || "application/octet-stream",
    dataUrl: `data:${blob.type || res.headers.get("content-type") || "application/octet-stream"};base64,${btoa(bin)}`,
  }
}

async function block(model: BlockModel, opts: ExportOpts, assets: DocExportAsset[], depth = 0): Promise<string[]> {
  const next = model.flavour === "affine:list" ? depth + 1 : depth
  const children = async () =>
    (await Promise.all(model.children.map((child) => block(child, opts, assets, next)))).flat()

  if (model.flavour === "affine:page" || model.flavour === "affine:note") return children()

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

  if (model.flavour === "affine:image") {
    const id = source(model)
    if (!id) return []
    const asset = await dataUrl(opts, id)
    if (!asset) return []
    const name = caption(model) || id
    assets.push({ id, mime: asset.mime, filename: id, dataUrl: asset.dataUrl })
    return [`![${name}](attachment://${encodeURIComponent(id)})`]
  }

  return children()
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
  const flavours = ["affine:paragraph", "affine:list"]
  const lines = doc
    .getBlockByFlavour(flavours)
    .map((model) => model.text?.toString?.() ?? "")
    .map((line) => line.trim())
    .filter(Boolean)
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

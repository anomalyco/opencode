import type { MessageFileRef } from "../context/file-ref"

const mark = "data-file-ref"
const fmt = new Set(["CODE", "STRONG", "EM", "B", "I", "DEL", "S", "MARK"])
const skip = new Set(["A", "PRE", "SCRIPT", "STYLE"])
const plain = /(?:[A-Za-z]:[\\/])?[\w()[\]{}+./\\-]+(?:\.[A-Za-z0-9_+-]+)(?::\d+(?:-\d+)?)?/g
const rich = /(?:[A-Za-z]:[\\/])?[\w()[\]{} +./\\-]+(?:\.[A-Za-z0-9_+-]+)(?::\d+(?:-\d+)?)?/g

export type FileRefMatch = MessageFileRef & {
  raw: string
  absolute: boolean
}

function edge(text: string, start: number, end: number) {
  const a = text[start - 1]
  const b = text[end]
  const left = !a || /[\s([{"'`>]/.test(a)
  const right = !b || /[\s)\]}"'`<,.;!?]/.test(b)
  return left && right
}

function split(text: string) {
  const hit = text.match(/:(\d+)(?:-(\d+))?$/)
  const base = hit ? text.slice(0, -hit[0].length) : text
  const line = hit ? Number(hit[1]) : undefined
  const end = hit?.[2] ? Number(hit[2]) : undefined
  return { base, line, end }
}

function ok(base: string, rich: boolean) {
  const text = base.trim()
  if (!text) return
  if (text.includes("://")) return
  if (!rich && /\s/.test(text)) return
  if (/\s/.test(text) && !/[\\/]/.test(text)) return
  const norm = text.replace(/\\/g, "/")
  const last = norm.split("/").filter(Boolean).at(-1)
  if (!last || !last.includes(".")) return
  const ext = last.split(".").at(-1)
  if (!ext || !/^[A-Za-z0-9_+-]+$/.test(ext)) return
  if (ext.length > 4) return
  return text
}

export function isAbsoluteFileRef(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\")
}

function refs(text: string, richText: boolean) {
  const rx = new RegExp((richText ? rich : plain).source, "g")
  const out: Array<FileRefMatch & { start: number; stop: number }> = []
  for (let m; (m = rx.exec(text)); ) {
    const raw = m[0]
    const start = m.index
    const stop = start + raw.length
    if (!edge(text, start, stop)) continue
    const part = split(raw)
    const path = ok(part.base, richText)
    if (!path) continue
    out.push({
      raw,
      path,
      line: part.line,
      end: part.end,
      absolute: isAbsoluteFileRef(path),
      start,
      stop,
    })
  }
  return out
}

function swap(node: Text, richText: boolean, allow: (ref: FileRefMatch) => boolean) {
  const text = node.textContent
  if (!text) return false
  const out = document.createDocumentFragment()
  let last = 0
  let hit = false
  for (const ref of refs(text, richText)) {
    if (!allow(ref)) continue
    const start = ref.start
    const stop = ref.stop
    if (start > last) out.append(text.slice(last, start))
    const el = document.createElement("a")
    el.href = "#"
    el.setAttribute(mark, "")
    el.dataset.path = ref.path
    if (ref.line) el.dataset.line = String(ref.line)
    if (ref.end) el.dataset.end = String(ref.end)
    el.textContent = ref.raw
    out.append(el)
    last = stop
    hit = true
  }
  if (!hit) return false
  if (last < text.length) out.append(text.slice(last))
  node.replaceWith(out)
  return true
}

function richText(node: Text, root: HTMLDivElement) {
  let el = node.parentElement
  while (el && el !== root) {
    if (skip.has(el.tagName)) return false
    if (fmt.has(el.tagName)) return true
    el = el.parentElement
  }
  return false
}

export function collectFileRefs(root: HTMLDivElement) {
  const out: FileRefMatch[] = []
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    if (!(node instanceof Text)) continue
    if (!node.textContent?.trim()) continue
    const el = node.parentElement
    if (!el) continue
    if (el.closest("a, pre, script, style")) continue
    out.push(...refs(node.textContent, richText(node, root)).map(({ start: _, stop: __, ...ref }) => ref))
  }
  return out
}

export function decorateFileRefs(root: HTMLDivElement, allow: (ref: FileRefMatch) => boolean = () => true) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const list: Text[] = []
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    if (!(node instanceof Text)) continue
    if (!node.textContent?.trim()) continue
    const el = node.parentElement
    if (!el) continue
    if (el.closest("a, pre, script, style")) continue
    list.push(node)
  }
  for (const node of list) {
    swap(node, richText(node, root), allow)
  }
}

export function readFileRef(target: EventTarget | null): MessageFileRef | undefined {
  if (!(target instanceof Element)) return
  const el = target.closest(`[${mark}]`)
  if (!(el instanceof HTMLAnchorElement)) return
  const path = el.dataset.path?.trim()
  if (!path) return
  const line = el.dataset.line ? Number(el.dataset.line) : undefined
  const end = el.dataset.end ? Number(el.dataset.end) : undefined
  return { path, line, end }
}

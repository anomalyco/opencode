import { inlineCodeKind } from "./markdown-inline-code-kind"

export type FileRef = {
  path: string
  line?: number
  end?: number
}

// Relative paths only: word-ish segments separated by / or \, ending in a dot
// extension. Absolute paths are intentionally excluded so URLs, domains, and
// filesystem paths in prose never turn into chat links.
const PATH_SRC = "[A-Za-z0-9._-]+(?:[\\\\/][A-Za-z0-9._-]+)*\\.[A-Za-z][A-Za-z0-9]{0,9}"
const LINE_SRC = "(\\d{1,6})(?:-(\\d{1,6}))?"
// A reference must not start inside a longer token (word characters, path
// separators, or the dots of a domain name like example.com).
const REF_HEAD_SRC = "(?<![\\w/\\\\.@#$%&+=-])"
// A line number must not run into another token (line:column pairs, times).
const LINE_TAIL_SRC = "(?![\\w:/])"

const COLON_EXACT = new RegExp(`^(${PATH_SRC}):${LINE_SRC}$`)

type RefMatch = {
  start: number
  end: number
  ref: FileRef
}

export function parseFileRef(text: string): FileRef | undefined {
  const value = text.trim()
  if (!value || value.length > 512) return
  const colon = value.match(COLON_EXACT)
  if (colon) return toRef(colon[1], colon[2], colon[3])
  if (inlineCodeKind(value) !== "path") return
  // Bare paths must point at a file with an extension; directory refs (e.g. "map-component/objecttype/") can't be opened.
  if (!value.match(new RegExp(`(?:^|[\\\\/])${PATH_SRC}$`))) return
  return { path: value }
}

export function markFileReferences(root: HTMLElement) {
  const codes = Array.from(root.querySelectorAll(":not(pre) > code"))
  for (const code of codes) {
    if (code.closest("a")) continue
    const ref = parseFileRef(code.textContent ?? "")
    if (!ref) continue
    const link = document.createElement("a")
    applyRef(link, ref)
    code.parentNode?.replaceChild(link, code)
    link.appendChild(code)
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("a, pre, code") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  const nodes: Text[] = []
  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text) nodes.push(walker.currentNode)
  }
  for (const node of nodes) linkifyTextNode(node)
}

function toRef(path: string, line: string | undefined, end: string | undefined): FileRef | undefined {
  if (!line || inlineCodeKind(path) !== "path") return
  const value = Number(line)
  if (value < 1) return
  const endValue = end ? Number(end) : undefined
  return { path, line: value, end: endValue && endValue > value ? endValue : undefined }
}

function applyRef(link: HTMLAnchorElement, ref: FileRef) {
  link.className = "file-ref"
  link.dataset.fileRef = ref.path
  if (ref.line !== undefined) link.dataset.fileLine = String(ref.line)
  if (ref.end !== undefined) link.dataset.fileEnd = String(ref.end)
  link.href = `file://${encodeURI(ref.path)}${ref.line !== undefined ? `?start=${ref.line}${ref.end !== undefined ? `&end=${ref.end}` : ""}` : ""}`
}

function linkifyTextNode(node: Text) {
  const matches = findRefMatches(node.data)
  if (matches.length === 0) return
  const text = node.data
  const fragment = document.createDocumentFragment()
  let index = 0
  for (const match of matches) {
    if (match.start < index) continue
    if (match.start > index) fragment.appendChild(document.createTextNode(text.slice(index, match.start)))
    const link = document.createElement("a")
    applyRef(link, match.ref)
    link.textContent = text.slice(match.start, match.end)
    fragment.appendChild(link)
    index = match.end
  }
  if (index < text.length) fragment.appendChild(document.createTextNode(text.slice(index)))
  node.replaceWith(fragment)
}

function findRefMatches(text: string): RefMatch[] {
  const colon = new RegExp(`${REF_HEAD_SRC}(${PATH_SRC}):${LINE_SRC}${LINE_TAIL_SRC}`, "g")
  // Prose forms only linkify the path token, and only when a line number
  // follows nearby. The bridge is capped and must not contain path-ish
  // characters so "a.java ve b.java 3. satırda" does not tie a.java to b.java's line.
  const proseTr = new RegExp(
    `${REF_HEAD_SRC}(${PATH_SRC})([^\\d\\n.:/]{1,32}?)${LINE_SRC}\\.?\\s*sat[ıi]r\\p{L}*`,
    "giu",
  )
  const proseEn = new RegExp(`${REF_HEAD_SRC}(${PATH_SRC})([^\\d\\n.:/]{1,32}?)\\bline\\s+${LINE_SRC}\\b`, "giu")

  const matches: RefMatch[] = []
  for (const match of text.matchAll(colon)) {
    const ref = toRef(match[1], match[2], match[3])
    if (!ref || match.index === undefined) continue
    matches.push({ start: match.index, end: match.index + match[0].length, ref })
  }
  for (const pattern of [proseTr, proseEn]) {
    for (const match of text.matchAll(pattern)) {
      const ref = toRef(match[1], match[3], match[4])
      if (!ref || match.index === undefined) continue
      matches.push({ start: match.index, end: match.index + match[1].length, ref })
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end)
  const result: RefMatch[] = []
  let lastEnd = -1
  for (const match of matches) {
    if (match.start < lastEnd) continue
    result.push(match)
    lastEnd = match.end
  }
  return result
}

// Bare references (no line number) only ever appear in inline code, which is
// handled by parseFileRef; plain text nodes require a line number.
export function findFileRefs(text: string): FileRef[] {
  return findRefMatches(text).map((match) => match.ref)
}

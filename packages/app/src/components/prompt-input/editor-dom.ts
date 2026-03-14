const MAX_BREAKS = 200
const BLOCK = new Set(["DIV", "P"])

type Point =
  | {
      node: Node
      offset: number
    }
  | {
      node: Node
      side: "before" | "after"
    }

function isEl(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE
}

function isBr(node: Node) {
  return isEl(node) && node.tagName === "BR"
}

function isPill(node: Node) {
  return isEl(node) && (node.dataset.type === "file" || node.dataset.type === "agent")
}

function isBlock(node: Node) {
  return isEl(node) && BLOCK.has(node.tagName)
}

function textLen(text: string) {
  let len = 0
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === "\u200B") continue
    if (char === "\r") {
      len += 1
      if (text[i + 1] === "\n") i += 1
      continue
    }
    len += 1
  }
  return len
}

function textOff(text: string, pos: number) {
  if (pos <= 0) return 0
  let len = 0
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === "\u200B") continue
    if (char === "\r") {
      len += 1
      if (len >= pos) return text[i + 1] === "\n" ? i + 2 : i + 1
      if (text[i + 1] === "\n") i += 1
      continue
    }
    len += 1
    if (len >= pos) return i + 1
  }
  return text.length
}

function span(node: Node, root: boolean): number {
  if (node.nodeType === Node.TEXT_NODE) return textLen(node.textContent ?? "")
  if (isBr(node)) return 1
  const nodes = Array.from(node.childNodes)
  return nodes.reduce(
    (sum, child, index) => sum + span(child, false) + (root && isBlock(child) && index < nodes.length - 1 ? 1 : 0),
    0,
  )
}

function tail(node: Node): Point | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return {
      node,
      offset: (node.textContent ?? "").length,
    }
  }

  if (isPill(node) || isBr(node)) {
    return {
      node,
      side: "after",
    }
  }

  const last = node.lastChild
  if (last) return tail(last)
  return {
    node,
    offset: 0,
  }
}

function head(node: Node): Point | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return {
      node,
      offset: 0,
    }
  }

  if (isPill(node) || isBr(node)) {
    return {
      node,
      side: "before",
    }
  }

  const first = node.firstChild
  if (first) return head(first)
  return {
    node,
    offset: 0,
  }
}

function point(node: Node, pos: number, root: boolean): Point | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return {
      node,
      offset: textOff(node.textContent ?? "", pos),
    }
  }

  if (isPill(node)) {
    return {
      node,
      side: pos === 0 ? "before" : "after",
    }
  }

  if (isBr(node)) {
    if (pos === 0) {
      return {
        node,
        side: "before",
      }
    }
    const next = node.nextSibling
    return next ? head(next) : { node, side: "after" }
  }

  const nodes = Array.from(node.childNodes)
  if (nodes.length === 0) {
    return {
      node,
      offset: 0,
    }
  }

  let left = pos
  for (const [index, child] of nodes.entries()) {
    const len = span(child, false)
    if (left <= len) return point(child, left, false)
    left -= len
    if (root && isBlock(child) && index < nodes.length - 1) {
      if (left === 1) return head(nodes[index + 1]!)
      left -= 1
    }
  }

  return tail(node)
}

function apply(range: Range, edge: "start" | "end", result: Point) {
  if ("offset" in result) {
    if (edge === "start") range.setStart(result.node, result.offset)
    if (edge === "end") range.setEnd(result.node, result.offset)
    return
  }

  if (edge === "start" && result.side === "before") range.setStartBefore(result.node)
  if (edge === "start" && result.side === "after") range.setStartAfter(result.node)
  if (edge === "end" && result.side === "before") range.setEndBefore(result.node)
  if (edge === "end" && result.side === "after") range.setEndAfter(result.node)
}

export function createTextFragment(content: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  let breaks = 0
  for (const char of content) {
    if (char !== "\n") continue
    breaks += 1
    if (breaks > MAX_BREAKS) {
      const tail = content.endsWith("\n")
      const text = tail ? content.slice(0, -1) : content
      if (text) fragment.appendChild(document.createTextNode(text))
      if (tail) fragment.appendChild(document.createElement("br"))
      return fragment
    }
  }

  const segments = content.split("\n")
  segments.forEach((segment, index) => {
    if (segment) {
      fragment.appendChild(document.createTextNode(segment))
    }
    if (index < segments.length - 1) {
      fragment.appendChild(document.createElement("br"))
    }
  })
  return fragment
}

export function getNodeLength(node: Node): number {
  return span(node, false)
}

export function getTextLength(node: Node): number {
  return span(node, true)
}

export function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer)) return 0
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(parent)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  return getTextLength(preCaretRange.cloneContents())
}

export function setCursorPosition(parent: HTMLElement, position: number) {
  const fallbackRange = document.createRange()
  const fallbackSelection = window.getSelection()
  const result = point(parent, position, true)
  if (result) {
    apply(fallbackRange, "start", result)
    fallbackRange.collapse(true)
    fallbackSelection?.removeAllRanges()
    fallbackSelection?.addRange(fallbackRange)
    return
  }
  fallbackRange.selectNodeContents(parent)
  fallbackRange.collapse(false)
  fallbackSelection?.removeAllRanges()
  fallbackSelection?.addRange(fallbackRange)
}

export function setRangeEdge(parent: HTMLElement, range: Range, edge: "start" | "end", offset: number) {
  const result = point(parent, offset, true)
  if (!result) return
  apply(range, edge, result)
}

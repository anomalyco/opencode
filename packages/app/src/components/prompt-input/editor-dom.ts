export function createTextFragment(content: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  fragment.appendChild(document.createTextNode(content))
  return fragment
}

export function getNodeLength(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  const text = node.textContent ?? ""
  if (!text.includes("\u200B")) return text.length
  return text.replace(/\u200B/g, "").length
}

export function getTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ""
    if (!text.includes("\u200B")) return text.length
    return text.replace(/\u200B/g, "").length
  }
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  let length = 0
  const children = node.childNodes
  for (let i = 0; i < children.length; i++) {
    length += getTextLength(children[i]!)
  }
  return length
}

function offsetInNode(node: Node, offset: number) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").slice(0, offset)
    if (!text.includes("\u200B")) return text.length
    return text.replace(/\u200B/g, "").length
  }

  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") {
    return Math.min(offset, 1)
  }

  let length = 0
  const children = node.childNodes
  const limit = Math.min(offset, children.length)
  for (let i = 0; i < limit; i++) {
    length += getTextLength(children[i]!)
  }
  return length
}

function lengthBefore(root: Node, target: Node, offset: number): number | undefined {
  if (root === target) return offsetInNode(root, offset)

  let total = 0
  const children = root.childNodes
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!
    const length = lengthBefore(child, target, offset)
    if (length !== undefined) return total + length
    total += getTextLength(child)
  }
}

export function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer)) return 0
  return lengthBefore(parent, range.startContainer, range.startOffset) ?? 0
}

export function setCursorPosition(parent: HTMLElement, position: number) {
  let remaining = position
  let node = parent.firstChild
  while (node) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill =
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (isText && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStart(node, remaining)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    if ((isPill || isBreak) && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      if (remaining === 0) {
        range.setStartBefore(node)
      }
      if (remaining > 0 && isPill) {
        range.setStartAfter(node)
      }
      if (remaining > 0 && isBreak) {
        const next = node.nextSibling
        if (next && next.nodeType === Node.TEXT_NODE) {
          range.setStart(next, 0)
        }
        if (!next || next.nodeType !== Node.TEXT_NODE) {
          range.setStartAfter(node)
        }
      }
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    remaining -= length
    node = node.nextSibling
  }

  const fallbackRange = document.createRange()
  const fallbackSelection = window.getSelection()
  const last = parent.lastChild
  if (last && last.nodeType === Node.TEXT_NODE) {
    const len = last.textContent ? last.textContent.length : 0
    fallbackRange.setStart(last, len)
  }
  if (!last || last.nodeType !== Node.TEXT_NODE) {
    fallbackRange.selectNodeContents(parent)
  }
  fallbackRange.collapse(false)
  fallbackSelection?.removeAllRanges()
  fallbackSelection?.addRange(fallbackRange)
}

export function setRangeEdge(parent: HTMLElement, range: Range, edge: "start" | "end", offset: number) {
  let remaining = offset
  const nodes = Array.from(parent.childNodes)

  for (const node of nodes) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill =
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (isText && remaining <= length) {
      if (edge === "start") range.setStart(node, remaining)
      if (edge === "end") range.setEnd(node, remaining)
      return
    }

    if ((isPill || isBreak) && remaining <= length) {
      if (edge === "start" && remaining === 0) range.setStartBefore(node)
      if (edge === "start" && remaining > 0) range.setStartAfter(node)
      if (edge === "end" && remaining === 0) range.setEndBefore(node)
      if (edge === "end" && remaining > 0) range.setEndAfter(node)
      return
    }

    remaining -= length
  }
}

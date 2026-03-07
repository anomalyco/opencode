import type { ComposerPart } from "./types"

const MAX_BREAKS = 200

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

  const parts = content.split("\n")
  parts.forEach((part, i) => {
    if (part) fragment.appendChild(document.createTextNode(part))
    if (i < parts.length - 1) fragment.appendChild(document.createElement("br"))
  })
  return fragment
}

export function getNodeLength(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  return (node.textContent ?? "").replace(/\u200B/g, "").length
}

export function getTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200B/g, "").length
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  let len = 0
  for (const child of Array.from(node.childNodes)) len += getTextLength(child)
  return len
}

export function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer)) return 0
  const copy = range.cloneRange()
  copy.selectNodeContents(parent)
  copy.setEnd(range.startContainer, range.startOffset)
  return getTextLength(copy.cloneContents())
}

export function setCursorPosition(parent: HTMLElement, position: number) {
  let rest = position
  let node = parent.firstChild
  while (node) {
    const len = getNodeLength(node)
    const text = node.nodeType === Node.TEXT_NODE
    const pill =
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
    const br = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (text && rest <= len) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStart(node, rest)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    if ((pill || br) && rest <= len) {
      const range = document.createRange()
      const selection = window.getSelection()
      if (rest === 0) range.setStartBefore(node)
      else if (pill) range.setStartAfter(node)
      else {
        const next = node.nextSibling
        if (next && next.nodeType === Node.TEXT_NODE) range.setStart(next, 0)
        else range.setStartAfter(node)
      }
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    rest -= len
    node = node.nextSibling
  }

  const end = document.createRange()
  end.selectNodeContents(parent)
  end.collapse(false)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(end)
}

export function setRangeEdge(parent: HTMLElement, range: Range, edge: "start" | "end", offset: number) {
  let rest = offset
  for (const node of Array.from(parent.childNodes)) {
    const len = getNodeLength(node)
    const text = node.nodeType === Node.TEXT_NODE
    const pill =
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
    const br = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (text && rest <= len) {
      if (edge === "start") range.setStart(node, rest)
      else range.setEnd(node, rest)
      return
    }
    if ((pill || br) && rest <= len) {
      if (edge === "start") rest === 0 ? range.setStartBefore(node) : range.setStartAfter(node)
      else rest === 0 ? range.setEndBefore(node) : range.setEndAfter(node)
      return
    }
    rest -= len
  }
}

export function createPill(type: "file" | "agent", content: string, path?: string) {
  const el = document.createElement("span")
  el.textContent = content
  el.setAttribute("data-type", type)
  if (type === "file" && path) el.setAttribute("data-path", path)
  if (type === "agent") el.setAttribute("data-name", content.replace("@", ""))
  el.setAttribute("contenteditable", "false")
  el.style.userSelect = "text"
  el.style.cursor = "default"
  return el
}

export function parseEditorText(editor: HTMLElement): string {
  return parseEditorParts(editor)
    .map((part) => part.content)
    .join("")
}

function pushText(parts: ComposerPart[], text: string) {
  if (!text) return
  const last = parts[parts.length - 1]
  if (last?.type === "text") {
    last.content += text
    return
  }
  parts.push({ type: "text", content: text })
}

export function parseEditorParts(editor: HTMLElement): ComposerPart[] {
  const parts: ComposerPart[] = []
  let text = ""

  const flush = () => {
    if (!text) return
    pushText(parts, text)
    text = ""
  }

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node.textContent ?? "").replace(/\u200B/g, "")
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    if (el.dataset.type === "file" || el.dataset.type === "agent") {
      flush()
      const content = el.textContent ?? ""
      if (el.dataset.type === "file") {
        parts.push({
          type: "file",
          path: el.dataset.path ?? content,
          content,
        })
      }
      if (el.dataset.type === "agent") {
        parts.push({
          type: "agent",
          name: el.dataset.name ?? content.replace(/^@/, ""),
          content,
        })
      }
      return
    }
    if (el.tagName === "BR") {
      text += "\n"
      return
    }
    for (const child of Array.from(el.childNodes)) visit(child)
  }

  const nodes = Array.from(editor.childNodes)
  nodes.forEach((node, i) => {
    const block = node.nodeType === Node.ELEMENT_NODE && ["DIV", "P"].includes((node as HTMLElement).tagName)
    visit(node)
    if (block && i < nodes.length - 1) text += "\n"
  })
  flush()
  return parts
}

export function isImeComposing(event: KeyboardEvent): boolean {
  return event.isComposing || (event as unknown as { keyCode?: number }).keyCode === 229
}

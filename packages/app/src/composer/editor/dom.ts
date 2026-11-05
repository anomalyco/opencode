import { isAttachment } from "../prompt-parts"
import type { ComposerPrompt } from "../types"

// Where `editorMatchesPrompt` is in the prompt: the part and the characters of it already matched. Module state so
// the per-keystroke walk allocates nothing; the walk is synchronous, so calls never interleave.
let matchPart = 0
let matchOffset = 0

/**
 * Whether the editor shows `prompt`'s inline parts, read the way `parseComposerEditor` reads the DOM: text runs
 * (split or not), `<br>` as a line break, mention pills by kind, label and target, and other elements by their
 * content. Attachments and empty text parts are ignored. Reads every part when it matches, so a caller in an effect
 * tracks in-place store updates. Runs on every keystroke, so it allocates nothing.
 */
export function editorMatchesPrompt(editor: HTMLElement, prompt: ComposerPrompt) {
  matchPart = 0
  matchOffset = 0

  for (let node = editor.firstChild; node; node = node.nextSibling) {
    if (!matchNode(node, prompt)) return false

    // The parser joins block children with a line break.
    if (node.nextSibling && node instanceof HTMLElement && (node.tagName === "DIV" || node.tagName === "P"))
      if (!matchText("\n", prompt)) return false
  }

  for (; matchPart < prompt.length; matchPart++, matchOffset = 0) {
    const part = prompt[matchPart]!

    if (!isAttachment(part) && part.content.length > matchOffset) return false
  }

  return true
}

/** Whether the editor holds nothing but line breaks and zero-width spaces, which the parser reads as empty. */
export function isEditorDomBlank(node: Node): boolean {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child instanceof Text) {
      for (let index = 0; index < child.length; index++) {
        const code = child.data.charCodeAt(index)

        if (code !== 0x0a && code !== 0x200b) return false
      }

      continue
    }

    if (!(child instanceof HTMLElement)) continue

    if (child.dataset.mention || (child.tagName !== "BR" && !isEditorDomBlank(child))) return false
  }

  return true
}

/** Whether `prompt` has no inline content: attachments only, or empty text. */
export function isPromptInlineBlank(prompt: ComposerPrompt) {
  for (let index = 0; index < prompt.length; index++) {
    const part = prompt[index]!

    if (!isAttachment(part) && (part.type !== "text" || part.content.length > 0)) return false
  }

  return true
}

function matchNode(node: Node, prompt: ComposerPrompt): boolean {
  if (node instanceof Text) return matchText(node.data, prompt)

  if (!(node instanceof HTMLElement)) return true

  if (node.dataset.mention) return matchMention(node, prompt)

  if (node.tagName === "BR") return matchText("\n", prompt)

  for (let child = node.firstChild; child; child = child.nextSibling) if (!matchNode(child, prompt)) return false

  return true
}

function matchText(text: string, prompt: ComposerPrompt) {
  let index = 0

  while (index < text.length) {
    const part = nextPart(prompt)

    if (part?.type !== "text") return false
    const length = Math.min(text.length - index, part.content.length - matchOffset)

    // One native comparison covers a text node that lies inside one part, even a long draft.
    const same =
      index === 0 && length === text.length
        ? part.content.startsWith(text, matchOffset)
        : sameChars(text, index, part.content, matchOffset, length)

    if (!same) return false
    index += length
    matchOffset += length
  }

  return true
}

function matchMention(element: HTMLElement, prompt: ComposerPrompt) {
  const part = nextPart(prompt)

  if (!part || part.type === "text" || isAttachment(part) || matchOffset !== 0) return false
  const kind = part.type === "file" && part.mime === "application/x-directory" ? "reference" : part.type
  const label = element.firstChild instanceof Text && !element.firstChild.nextSibling ? element.firstChild.data : null

  if (element.dataset.mention !== kind || (label ?? element.textContent) !== part.content) return false

  if (part.type === "session" && element.title !== part.id) return false

  if (part.type === "agent" && element.dataset.name !== part.name) return false

  if (part.type === "skill" && (element.dataset.id !== part.id || element.dataset.name !== part.name)) return false

  if (
    part.type === "file" &&
    (element.dataset.path !== part.path ||
      element.dataset.mime !== (part.mime || undefined) ||
      element.dataset.filename !== (part.filename || undefined))
  )
    return false
  matchPart++

  return true
}

function sameChars(a: string, aStart: number, b: string, bStart: number, length: number) {
  for (let offset = 0; offset < length; offset++)
    if (a.charCodeAt(aStart + offset) !== b.charCodeAt(bStart + offset)) return false

  return true
}

// The part the next character belongs to, past attachments and fully matched text.
function nextPart(prompt: ComposerPrompt) {
  for (; matchPart < prompt.length; matchPart++, matchOffset = 0) {
    const part = prompt[matchPart]!

    if (isAttachment(part)) continue

    if (part.type !== "text" || part.content.length > matchOffset) return part
  }
}

function getNodeLength(node: Node): number {
  if (node instanceof Element && node.tagName === "BR") return 1

  return textLength(node)
}

// The node's text without zero-width spaces, like `textContent` but without building the string.
function textLength(node: Node): number {
  if (node instanceof Text) return countText(node.data, node.length)
  let length = 0

  for (let child = node.firstChild; child; child = child.nextSibling) length += textLength(child)

  return length
}

/**
 * The collapsed caret's position in `parent`, counted the way `setCursorPosition` places it, or `undefined` when
 * the selection is a range or lies outside `parent`. Runs on every `selectionchange`, so it allocates nothing.
 */
export function getCursorPosition(parent: HTMLElement) {
  const selection = window.getSelection()
  const anchor = selection?.anchorNode

  if (!selection?.isCollapsed || !anchor || !parent.contains(anchor)) return
  const offset = selection.anchorOffset
  let position = 0
  let index = 0

  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (anchor === parent && index === offset) return position

    if (node === anchor && node instanceof Text) return position + countText(node.data, offset)

    // Mentions and breaks are atomic: a caret on or inside one sits before or after it.
    if (node.contains(anchor)) return offset === 0 ? position : position + getNodeLength(node)
    position += getNodeLength(node)
    index++
  }

  return position
}

function countText(text: string, end: number) {
  let count = 0

  for (let index = 0; index < end; index++) if (text.charCodeAt(index) !== 0x200b) count++

  return count
}

export function setCursorPosition(parent: HTMLElement, position: number) {
  let remaining = position
  let node = parent.firstChild

  while (node) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill = node instanceof HTMLElement && !!node.dataset.mention
    const isBreak = node instanceof Element && node.tagName === "BR"

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

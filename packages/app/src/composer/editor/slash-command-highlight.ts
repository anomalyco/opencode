import type { ComposerSuggestion } from "../types"
import { parseSlashCommand } from "../client-slash-command"

const HIGHLIGHT = "composer-slash-command"
const ranges = new Map<HTMLElement, Range>()

export function findComposerSlashCommandRange(editor: HTMLElement, commands: readonly ComposerSuggestion[]) {
  let node: Node | null = editor.firstChild

  while (node && node.nodeType !== Node.TEXT_NODE) {
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as HTMLElement

    if (element.tagName === "BR" || element.dataset.mention) return
    node = element.firstChild
  }

  if (!node) return
  const command = parseSlashCommand(node.textContent ?? "")

  if (!command || !commands.some((item) => item.kind === "command" && item.trigger === command.name)) return

  const range = document.createRange()
  range.setStart(node, 0)
  range.setEnd(node, command.name.length + 1)

  return range
}

export function updateComposerSlashCommandHighlight(editor: HTMLElement, commands: readonly ComposerSuggestion[]) {
  if (!supportsHighlights()) return

  const range = findComposerSlashCommandRange(editor, commands)

  if (range) ranges.set(editor, range)
  else ranges.delete(editor)

  applyHighlights()
}

export function clearComposerSlashCommandHighlight(editor: HTMLElement) {
  if (!supportsHighlights() || !ranges.delete(editor)) return

  applyHighlights()
}

function supportsHighlights() {
  return typeof Highlight !== "undefined" && !!globalThis.CSS?.highlights
}

function applyHighlights() {
  if (ranges.size) CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges.values()))
  else CSS.highlights.delete(HIGHLIGHT)
}

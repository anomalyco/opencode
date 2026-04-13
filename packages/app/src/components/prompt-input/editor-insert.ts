import type { AgentPart, FileAttachmentPart } from "@/context/prompt"

type AtomicPart = FileAttachmentPart | AgentPart

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function serializeAtomicPartHtml(part: AtomicPart): string {
  const attrs = [
    'contenteditable="false"',
    `data-type="${escapeHtml(part.type)}"`,
    'style="user-select: text; cursor: default;"',
  ]

  if (part.type === "file") {
    attrs.push(`data-path="${escapeHtml(part.path)}"`)
  }
  if (part.type === "agent") {
    attrs.push(`data-name="${escapeHtml(part.name)}"`)
  }

  return `<span ${attrs.join(" ")}>${escapeHtml(part.content)}</span>\u00a0`
}

/**
 * Insert a tag pill via execCommand("insertHTML") so the operation is pushed
 * onto the browser's native undo stack. Returns false when execCommand is
 * unavailable, letting callers fall back to direct DOM manipulation.
 */
export function insertAtomicPartAtSelection(part: AtomicPart): boolean {
  const execCommand = document.execCommand?.bind(document)
  if (typeof execCommand !== "function") return false
  return execCommand("insertHTML", false, serializeAtomicPartHtml(part))
}

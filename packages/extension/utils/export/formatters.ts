/**
 * Export formatters for conversations
 */

import type { Conversation, ExportResult } from "./types"

/**
 * Sanitize filename by removing invalid characters
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-z0-9\s-]/gi, "_")
    .replace(/\s+/g, "_")
    .substring(0, 100)
}

/**
 * Format date for filenames (YYYY-MM-DD_HH-mm-ss)
 */
export function formatDateForFilename(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  const seconds = String(date.getSeconds()).padStart(2, "0")

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`
}

/**
 * Export conversation as Markdown with YAML frontmatter
 */
export function exportAsMarkdown(conversation: Conversation, selectedMessageIds?: Set<string>): ExportResult {
  const messages =
    selectedMessageIds && selectedMessageIds.size > 0
      ? conversation.messages.filter((m) => selectedMessageIds.has(m.id))
      : conversation.messages

  const yaml = `---
title: ${conversation.title}
date: ${conversation.created_at}
updated: ${conversation.updated_at}
source: ${conversation.source || "unknown"}
exporter: eidorail-v1.0
message_count: ${messages.length}
conversation_id: ${conversation.id}
${conversation.project_uuid ? `project_id: ${conversation.project_uuid}` : ""}
---

`

  let body = `# ${conversation.title}\n\n`

  let userMsgCount = 0
  for (const msg of messages) {
    if (msg.role === "user") {
      userMsgCount++
      body += `## ${userMsgCount}. User\n\n${msg.content}\n\n`
    } else {
      body += `### Assistant\n\n${msg.content}\n\n`
      body += `---\n\n`
    }
  }

  const content = yaml + body
  const timestamp = formatDateForFilename(new Date())
  const filename = `${sanitizeFilename(conversation.title)}_${timestamp}.md`

  return {
    content,
    filename,
    mimeType: "text/markdown",
  }
}

/**
 * Export conversation as JSON
 */
export function exportAsJSON(conversation: Conversation, selectedMessageIds?: Set<string>): ExportResult {
  const messages =
    selectedMessageIds && selectedMessageIds.size > 0
      ? conversation.messages.filter((m) => selectedMessageIds.has(m.id))
      : conversation.messages

  const exportData = {
    ...conversation,
    messages,
    exporter: "eidorail-v1.0",
    exported_at: new Date().toISOString(),
  }

  const content = JSON.stringify(exportData, null, 2)
  const timestamp = formatDateForFilename(new Date())
  const filename = `${sanitizeFilename(conversation.title)}_${timestamp}.json`

  return {
    content,
    filename,
    mimeType: "application/json",
  }
}

/**
 * Download file to user's computer
 */
export function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)

  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.style.display = "none"

  document.body.appendChild(a)
  a.click()

  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)
}

/**
 * Copy content to clipboard
 */
export async function copyToClipboard(content: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(content)
    return true
  } catch {
    const textarea = document.createElement("textarea")
    textarea.value = content
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.select()
    const success = document.execCommand("copy")
    document.body.removeChild(textarea)
    return success
  }
}

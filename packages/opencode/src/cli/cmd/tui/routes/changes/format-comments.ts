import type { CommentsByFile } from "."
import type { Comment } from "./comment-box"

export function formatCommentsForAI(commentsByFile: CommentsByFile): string {
  const sections = Array.from(commentsByFile.entries())
    .filter(([_, comments]) => comments.size > 0)
    .map(([filePath, comments]) => formatFileSection(filePath, comments))
    .filter((section) => section.length > 0)

  if (sections.length === 0) return ""

  return [
    "Code Review Feedback",
    "",
    "I have reviewed the changes and would like to provide the following feedback:",
    "",
    ...sections,
  ].join("\n")
}

function formatFileSection(filePath: string, comments: Map<string, Comment>): string {
  const commentList = Array.from(comments.entries())
    .map(([_, comment]) => formatComment(comment))
    .filter((formatted) => formatted.length > 0)

  if (commentList.length === 0) return ""

  return [`## ${filePath}`, "", ...commentList].join("\n")
}

function formatComment(comment: Comment): string {
  const lineInfo = formatLineInfo(comment)
  const typeLabel = formatTypeLabel(comment.lineType)

  return [`### ${lineInfo}${typeLabel}`, comment.text, ""].join("\n")
}

// Formats line information from anchor and visual line.
function formatLineInfo(comment: Comment): string {
  const anchor = comment.anchor ?? `v:${comment.line}`

  if (anchor.startsWith("old:")) {
    const lineNum = anchor.slice(4)
    return `Line ${lineNum} (old)`
  }
  if (anchor.startsWith("new:")) {
    const lineNum = anchor.slice(4)
    return `Line ${lineNum} (new)`
  }
  if (anchor.startsWith("ln:")) {
    const lineNum = anchor.slice(3)
    return `Line ${lineNum}`
  }

  // Fallback
  return `Line ${comment.line + 1}`
}

function formatTypeLabel(lineType: Comment["lineType"]): string {
  switch (lineType) {
    case "add":
      return " — added"
    case "remove":
      return " — removed"
    case "context":
      return " — context"
    default:
      return ""
  }
}

export function hasAnyComments(commentsByFile: CommentsByFile): boolean {
  for (const comments of commentsByFile.values()) {
    if (comments.size > 0) return true
  }
  return false
}

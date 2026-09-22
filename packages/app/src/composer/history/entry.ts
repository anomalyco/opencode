import type { Prompt } from "@/composer/state"
import type { SelectedLineRange } from "@/workspaces/files/model"
import { clonePrompt, isAttachment } from "../prompt-parts"
import type { PromptHistoryComment, PromptHistoryEntry } from "../schema"

export type { PromptHistoryComment, PromptHistoryEntry } from "../schema"

export const MAX_HISTORY = 100

export type PromptHistoryStoredEntry = PromptHistoryEntry

function cloneSelection(selection: SelectedLineRange): SelectedLineRange {
  return {
    start: selection.start,
    end: selection.end,
    ...(selection.side ? { side: selection.side } : {}),
    ...(selection.endSide ? { endSide: selection.endSide } : {}),
  }
}

export function clonePromptHistoryComments(comments: PromptHistoryComment[]) {
  return comments.map((comment) => ({
    ...comment,
    selection: cloneSelection(comment.selection),
  }))
}

export function prependHistoryEntry(
  entries: PromptHistoryStoredEntry[],
  prompt: Prompt,
  comments: PromptHistoryComment[] = [],
  max = MAX_HISTORY,
) {
  const text = prompt
    .map((part) => ("content" in part ? part.content : ""))
    .join("")
    .trim()
  const hasAttachments = prompt.some(isAttachment)
  const hasComments = comments.some((comment) => !!comment.comment.trim())
  if (!text && !hasAttachments && !hasComments) return entries

  const entry = {
    prompt: clonePrompt(prompt),
    comments: clonePromptHistoryComments(comments),
  } satisfies PromptHistoryEntry
  const last = entries[0]
  if (last && isPromptEqual(last, entry)) return entries
  return [entry, ...entries].slice(0, max)
}

// A send that failed puts its prompt back in the composer, so the entry recorded for it would
// only duplicate the draft and keep its attachments referenced for as long as history holds it.
export function removeHistoryEntry(
  entries: PromptHistoryStoredEntry[],
  prompt: Prompt,
  comments: PromptHistoryComment[] = [],
) {
  const entry = { prompt, comments } satisfies PromptHistoryEntry
  const next = entries.filter((item) => !isPromptEqual(item, entry))
  return next.length === entries.length ? entries : next
}

function isCommentEqual(commentA: PromptHistoryComment, commentB: PromptHistoryComment) {
  return (
    commentA.path === commentB.path &&
    commentA.comment === commentB.comment &&
    commentA.origin === commentB.origin &&
    commentA.preview === commentB.preview &&
    commentA.selection.start === commentB.selection.start &&
    commentA.selection.end === commentB.selection.end &&
    commentA.selection.side === commentB.selection.side &&
    commentA.selection.endSide === commentB.selection.endSide
  )
}

function isPromptEqual(entryA: PromptHistoryStoredEntry, entryB: PromptHistoryStoredEntry) {
  if (entryA.prompt.length !== entryB.prompt.length) return false
  for (let i = 0; i < entryA.prompt.length; i++) {
    const partA = entryA.prompt[i]
    const partB = entryB.prompt[i]
    if (partA.type !== partB.type) return false
    if (partA.type === "text" && partA.content !== (partB.type === "text" ? partB.content : "")) return false
    if (partA.type === "file") {
      if (partA.path !== (partB.type === "file" ? partB.path : "")) return false
      const a = partA.selection
      const b = partB.type === "file" ? partB.selection : undefined
      const sameSelection =
        (!a && !b) ||
        (!!a &&
          !!b &&
          a.startLine === b.startLine &&
          a.startChar === b.startChar &&
          a.endLine === b.endLine &&
          a.endChar === b.endChar)
      if (!sameSelection) return false
    }
    if (partA.type === "agent" && partA.name !== (partB.type === "agent" ? partB.name : "")) return false
    if (partA.type === "skill") {
      if (partB.type !== "skill" || partA.id !== partB.id || partA.name !== partB.name) return false
    }
    if (isAttachment(partA) && partA.id !== (isAttachment(partB) ? partB.id : "")) return false
  }
  if (entryA.comments.length !== entryB.comments.length) return false
  for (let i = 0; i < entryA.comments.length; i++) {
    const commentA = entryA.comments[i]
    const commentB = entryB.comments[i]
    if (!commentA || !commentB || !isCommentEqual(commentA, commentB)) return false
  }
  return true
}

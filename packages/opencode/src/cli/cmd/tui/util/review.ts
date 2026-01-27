import type { Snapshot } from "@/snapshot"
import { createTwoFilesPatch, parsePatch, type StructuredPatchHunk } from "diff"

export interface ReviewComment {
  id: string
  text: string
  createdAt: number
}

export interface Change {
  id: string
  file: string
  index: number
  hunk: StructuredPatchHunk
}

/**
 * Parse a file diff into individual changes (hunks).
 * Each hunk represents a discrete change that can be commented on.
 */
export function getChanges(diff: Snapshot.FileDiff): Change[] {
  const patch = createTwoFilesPatch(diff.file, diff.file, diff.before, diff.after, "before", "after")
  const parsed = parsePatch(patch)[0]
  if (!parsed) return []
  return parsed.hunks.map((hunk, index) => ({
    id: `${diff.file}:${index}:${hunk.oldStart}-${hunk.oldLines}:${hunk.newStart}-${hunk.newLines}`,
    file: diff.file,
    index,
    hunk,
  }))
}

/**
 * Clamp an index to a valid range for the given length.
 */
export function clampIndex(index: number, length: number): number {
  const maxIdx = Math.max(0, length - 1)
  return Math.min(Math.max(0, index), maxIdx)
}

/**
 * Generate feedback message from comments to send to the agent.
 * Returns null if there are no comments.
 */
export function generateFeedbackMessage(
  diffs: Snapshot.FileDiff[],
  comments: Record<string, Record<string, ReviewComment[]>>,
): string | null {
  const lines: string[] = []

  for (const diff of diffs) {
    const fileComments = comments[diff.file]
    if (!fileComments) continue

    const changes = getChanges(diff)
    for (const change of changes) {
      const changeComments = fileComments[change.id]
      if (!changeComments || changeComments.length === 0) continue

      lines.push(`### ${diff.file} (lines ${change.hunk.newStart}-${change.hunk.newStart + change.hunk.newLines - 1})`)
      for (const comment of changeComments) {
        lines.push(`- ${comment.text}`)
      }
      lines.push("")
    }
  }

  if (lines.length === 0) return null

  return ["## Review Feedback\n", ...lines].join("\n")
}

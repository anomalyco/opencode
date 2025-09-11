import { diff_match_patch } from "diff-match-patch"

export interface ReplacementInfo {
  newContent: string
  start: number
  end: number
}

export function mapFormattingPositions(
  originalContent: string,
  formattedContent: string,
  start: number,
  end: number,
): ReplacementInfo {
  // Use diff_match_patch to map positions from original to formatted content
  const dmp = new diff_match_patch()
  const diffs = dmp.diff_main(originalContent, formattedContent, false)

  // Map the start and end positions
  const newStart = dmp.diff_xIndex(diffs, start)
  const newEnd = dmp.diff_xIndex(diffs, end)

  // Throw if indexes are -1 (position not found)
  if (newStart === -1 || newEnd === -1) {
    throw new Error(`Failed to map positions: start=${newStart}, end=${newEnd}`)
  }

  return {
    newContent: formattedContent,
    start: newStart,
    end: newEnd,
  }
}

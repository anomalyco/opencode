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

  return {
    newContent: formattedContent,
    start: newStart,
    end: newEnd,
  }
}
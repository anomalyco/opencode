import { diff_match_patch } from "diff-match-patch"

export interface ReplacementInfo {
  newContent: string
  start: number
  end: number
}

export function mapFormattingPositions(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): ReplacementInfo {
  if (oldString === newString) {
    throw new Error("oldString and newString must be different")
  }

  // For empty oldString (new file), replace at position 0
  if (oldString === "") {
    return {
      newContent: newString,
      start: 0,
      end: newString.length,
    }
  }

  const index = content.indexOf(oldString)
  if (index === -1) {
    throw new Error("oldString not found in content")
  }

  let newContent: string

  if (replaceAll) {
    newContent = content.replaceAll(oldString, newString)
  } else {
    const lastIndex = content.lastIndexOf(oldString)
    if (index !== lastIndex) {
      throw new Error(
        "oldString found multiple times and requires more code context to uniquely identify the intended match",
      )
    }
    newContent = content.substring(0, index) + newString + content.substring(index + oldString.length)
  }

  // Use diff_match_patch to map positions from original to new content
  const dmp = new diff_match_patch()
  const diffs = dmp.diff_main(content, newContent, false)

  // Map the start and end positions
  let start = dmp.diff_xIndex(diffs, index)
  let end = dmp.diff_xIndex(diffs, index + oldString.length)

  // For replaceAll, we need to find where the replacement actually starts and ends
  // in the new content. Since the first character might have moved, we need to
  // find the actual replacement boundaries.
  if (replaceAll && newContent.substring(start, start + newString.length) !== newString) {
    // Adjust start position if needed
    const searchStart = Math.max(0, start - 10)
    const searchEnd = Math.min(newContent.length, start + 10)
    const searchArea = newContent.substring(searchStart, searchEnd)
    const relIndex = searchArea.indexOf(newString)
    if (relIndex >= 0) {
      start = searchStart + relIndex
      end = start + newString.length
    }
  } else if (replaceAll) {
    end = start + newString.length
  }

  return {
    newContent,
    start,
    end,
  }
}

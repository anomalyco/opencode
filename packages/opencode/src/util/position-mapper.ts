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
  replaceAll = false
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
  let start: number
  let end: number

  if (replaceAll) {
    newContent = content.replaceAll(oldString, newString)
    // For replaceAll, we only track the first replacement
    start = index
    end = index + newString.length
  } else {
    const lastIndex = content.lastIndexOf(oldString)
    if (index !== lastIndex) {
      throw new Error("oldString found multiple times and requires more code context to uniquely identify the intended match")
    }
    newContent = content.substring(0, index) + newString + content.substring(index + oldString.length)
    start = index
    end = index + newString.length
  }

  return {
    newContent,
    start,
    end,
  }
}
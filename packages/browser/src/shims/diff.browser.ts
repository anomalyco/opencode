// Minimal diff shim for browser
export function createPatch(
  fileName: string,
  oldStr: string,
  newStr: string,
  _oldHeader?: string,
  _newHeader?: string,
): string {
  const oldLines = oldStr.split("\n")
  const newLines = newStr.split("\n")
  let patch = `--- a/${fileName}\n+++ b/${fileName}\n`

  // Simple line-by-line diff
  const maxLen = Math.max(oldLines.length, newLines.length)
  let hunk = ""
  let changes = false

  for (let i = 0; i < maxLen; i++) {
    if (i < oldLines.length && i < newLines.length) {
      if (oldLines[i] !== newLines[i]) {
        hunk += `-${oldLines[i]}\n`
        hunk += `+${newLines[i]}\n`
        changes = true
      } else {
        hunk += ` ${oldLines[i]}\n`
      }
    } else if (i < oldLines.length) {
      hunk += `-${oldLines[i]}\n`
      changes = true
    } else {
      hunk += `+${newLines[i]}\n`
      changes = true
    }
  }

  if (changes) {
    patch += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`
    patch += hunk
  }

  return patch
}

export function createTwoFilesPatch(
  oldFileName: string,
  newFileName: string,
  oldStr: string,
  newStr: string,
  oldHeader?: string,
  newHeader?: string,
): string {
  const patch = createPatch(newFileName || oldFileName, oldStr, newStr, oldHeader, newHeader)
  return patch.replace(`--- a/${newFileName || oldFileName}`, `--- a/${oldFileName}`)
}

export function diffLines(oldStr: string, newStr: string): any[] {
  const oldLines = oldStr.split("\n")
  const newLines = newStr.split("\n")
  const result: any[] = []

  // Simple comparison
  const maxLen = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < maxLen; i++) {
    if (i >= oldLines.length) {
      result.push({ value: newLines[i] + "\n", added: true })
    } else if (i >= newLines.length) {
      result.push({ value: oldLines[i] + "\n", removed: true })
    } else if (oldLines[i] !== newLines[i]) {
      result.push({ value: oldLines[i] + "\n", removed: true })
      result.push({ value: newLines[i] + "\n", added: true })
    } else {
      result.push({ value: oldLines[i] + "\n" })
    }
  }

  return result
}

export function applyPatch(source: string, patch: string): string | false {
  // Very basic patch application
  return source
}

export function parsePatch(_patch: string): any[] {
  return []
}

export function formatPatch(patch: any): string {
  if (typeof patch === "string") {
    return patch
  }

  if (patch && typeof patch === "object") {
    return createTwoFilesPatch(
      patch.oldFileName ?? "a/file",
      patch.newFileName ?? "b/file",
      "",
      "",
      patch.oldHeader,
      patch.newHeader,
    )
  }

  return ""
}

export function structuredPatch() { return { hunks: [] } }

export default { createPatch, createTwoFilesPatch, diffLines, applyPatch, parsePatch, formatPatch, structuredPatch }

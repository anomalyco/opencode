import { FileDiff } from "@opencode/schema/file-diff"
import { formatPatch, structuredPatch } from "diff"

export function fileDiff(
  file: string,
  before: string,
  after: string,
  status: typeof FileDiff.Info.Type.status = "modified",
): typeof FileDiff.Info.Type {
  if (before === "" || after === "") return whole(file, before, after, status)
  const patch = structuredPatch(file, file, before, after)
  let additions = 0
  let deletions = 0
  for (const hunk of patch.hunks)
    for (const line of hunk.lines) {
      if (line[0] === "+") additions++
      else if (line[0] === "-") deletions++
    }
  return { file, patch: formatPatch(patch), status, additions, deletions }
}

// A change from or to an empty file is every line added or removed: the patch `structuredPatch` would build, without
// diffing.
function whole(file: string, before: string, after: string, status: typeof FileDiff.Info.Type.status) {
  const header = `Index: ${file}\n${"=".repeat(67)}\n--- ${file}\n+++ ${file}\n`
  const added = before === ""
  const text = added ? after : before
  if (text === "") return { file, patch: header, status, additions: 0, deletions: 0 }
  const sign = added ? "+" : "-"
  const ended = text.endsWith("\n")
  const body = ended ? text.slice(0, -1) : text
  let count = 1
  for (let index = body.indexOf("\n"); index !== -1; index = body.indexOf("\n", index + 1)) count++
  const range = added ? `@@ -0,0 +1,${count} @@` : `@@ -1,${count} +0,0 @@`
  return {
    file,
    patch: `${header}${range}\n${sign}${body.replaceAll("\n", "\n" + sign)}\n${ended ? "" : "\\ No newline at end of file\n"}`,
    status,
    additions: added ? count : 0,
    deletions: added ? 0 : count,
  }
}

import { FileDiff } from "@opencode/schema/file-diff"
import { formatPatch, structuredPatch } from "diff"

export function fileDiff(
  file: string,
  before: string,
  after: string,
  status: typeof FileDiff.Info.Type.status = "modified",
): typeof FileDiff.Info.Type {
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

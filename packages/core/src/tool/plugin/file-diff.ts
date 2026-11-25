import { FileDiff } from "@opencode/schema/file-diff"
import { createTwoFilesPatch, diffLines } from "diff"

export function fileDiff(
  file: string,
  before: string,
  after: string,
  status: typeof FileDiff.Info.Type.status = "modified",
): typeof FileDiff.Info.Type {
  const counts = diffLines(before, after).reduce(
    (result, item) => ({
      additions: result.additions + (item.added ? (item.count ?? 0) : 0),
      deletions: result.deletions + (item.removed ? (item.count ?? 0) : 0),
    }),
    { additions: 0, deletions: 0 },
  )
  return {
    file,
    patch: createTwoFilesPatch(file, file, before, after),
    status,
    ...counts,
  }
}

export function formatterResult(files: ReadonlyArray<typeof FileDiff.Info.Type>) {
  if (files.length === 0) return []
  return [
    {
      type: "text" as const,
      text: [
        "A formatter changed these files after this call. Use the final diff below for the next edit.",
        ...files.map((file) => file.patch),
      ].join("\n"),
    },
  ]
}

import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"

export type ReviewDiffKind = "add" | "del" | "mix"

type RenderDiff = (SnapshotFileDiff & { file: string }) | VcsFileDiff

export function filterRenderableDiff(value: SnapshotFileDiff | VcsFileDiff): value is RenderDiff {
  return typeof value.file === "string"
}

export function reviewDiffKinds(diffs: RenderDiff[]) {
  const merge = (a: ReviewDiffKind | undefined, b: ReviewDiffKind) => {
    if (!a) return b
    if (a === b) return a
    return "mix" as const
  }

  const normalize = (p: string) => p.replaceAll("\\\\", "/").replace(/\/+$/, "")

  const out = new Map<string, ReviewDiffKind>()
  for (const diff of diffs) {
    const file = normalize(diff.file)
    const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

    out.set(file, kind)

    const parts = file.split("/")
    for (const [idx] of parts.slice(0, -1).entries()) {
      const dir = parts.slice(0, idx + 1).join("/")
      if (!dir) continue
      out.set(dir, merge(out.get(dir), kind))
    }
  }
  return out
}

export function filterReviewFiles(files: string[], query: string) {
  const value = query.trim().toLowerCase()
  if (!value) return files
  return files.filter((file) => file.toLowerCase().includes(value))
}

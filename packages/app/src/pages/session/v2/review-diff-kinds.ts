import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"

export type ReviewDiffKind = "add" | "del" | "mix"

type RenderDiff = (SnapshotFileDiff & { file: string }) | VcsFileDiff

export function normalizePath(p: string) {
  return p.replaceAll("\\", "/").replace(/\/+$/, "")
}

export function filterRenderableDiff(value: SnapshotFileDiff | VcsFileDiff): value is RenderDiff {
  return typeof value.file === "string"
}

export function reviewDiffKinds(diffs: RenderDiff[]) {
  const merge = (a: ReviewDiffKind | undefined, b: ReviewDiffKind) => {
    if (!a) return b
    if (a === b) return a
    return "mix" as const
  }

  const out = new Map<string, ReviewDiffKind>()
  for (const diff of diffs) {
    const file = normalizePath(diff.file)
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

export function applyFileListKeyDown(
  event: KeyboardEvent,
  files: readonly string[],
  highlighted: string | undefined,
  options: { onHighlight: (path: string) => void; onSelect: (path: string) => void },
) {
  if (files.length === 0) return

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const currentIndex = highlighted ? files.indexOf(highlighted) : -1
    const delta = event.key === "ArrowDown" ? 1 : -1
    const start = currentIndex === -1 ? (delta > 0 ? 0 : files.length - 1) : currentIndex + delta
    const index = Math.max(0, Math.min(files.length - 1, start))
    options.onHighlight(files[index]!)
    event.preventDefault()
    return
  }

  if (event.key !== "Enter") return
  const target = highlighted ?? files[0]
  if (!target) return
  options.onSelect(target)
  event.preventDefault()
}

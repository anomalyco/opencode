import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"

type LegacyDiff = {
  file: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

type ReviewDiff = SnapshotFileDiff | VcsFileDiff | LegacyDiff

export type ViewDiff = ReviewDiff & {
  before: string
  after: string
}

const cache = new Map<string, { before: string; after: string }>()

function text(lines: string[], trailing: boolean) {
  if (lines.length === 0) return ""
  return lines.join("\n") + (trailing ? "\n" : "")
}

function split(patch: string) {
  const hit = cache.get(patch)
  if (hit) return hit

  const before: string[] = []
  const after: string[] = []
  let open = false
  let side: " " | "+" | "-" | undefined
  let trailing = { before: true, after: true }

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      open = true
      continue
    }

    if (!open) continue

    if (line.startsWith("\\ No newline at end of file")) {
      if (side === " " || side === "-") trailing.before = false
      if (side === " " || side === "+") trailing.after = false
      continue
    }

    const head = line[0]
    const body = line.slice(1)

    if (head === " ") {
      before.push(body)
      after.push(body)
      side = " "
      continue
    }

    if (head === "-") {
      before.push(body)
      side = "-"
      continue
    }

    if (head === "+") {
      after.push(body)
      side = "+"
    }
  }

  const value = {
    before: text(before, trailing.before),
    after: text(after, trailing.after),
  }
  cache.set(patch, value)
  return value
}

export function inflate(diff: ReviewDiff): ViewDiff {
  if (!diff.patch) {
    return {
      ...diff,
      before: "before" in diff && typeof diff.before === "string" ? diff.before : "",
      after: "after" in diff && typeof diff.after === "string" ? diff.after : "",
    }
  }
  return { ...diff, ...split(diff.patch) }
}

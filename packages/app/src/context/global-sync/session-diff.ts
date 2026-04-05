import type { FileDiff } from "@opencode-ai/sdk/v2/client"

function isSessionDiff(value: unknown): value is FileDiff {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  if (typeof item.file !== "string") return false
  if (typeof item.before !== "string") return false
  if (typeof item.after !== "string") return false
  if (typeof item.additions !== "number") return false
  if (typeof item.deletions !== "number") return false
  if (
    item.status !== undefined &&
    item.status !== "added" &&
    item.status !== "deleted" &&
    item.status !== "modified"
  ) {
    return false
  }
  return true
}

function parseSessionDiffs(value: unknown) {
  if (!Array.isArray(value)) return
  if (!value.every(isSessionDiff)) return
  return value
}

export function sessionDiffs(value: unknown): FileDiff[] {
  return parseSessionDiffs(value) ?? []
}

export function hasSessionDiffs(value: unknown) {
  return parseSessionDiffs(value) !== undefined
}

export function shouldFetchSessionDiff(value: unknown, force?: boolean) {
  if (force) return true
  return !hasSessionDiffs(value)
}

export function sessionDiffCount(value: unknown) {
  return sessionDiffs(value).length
}

export function sessionDiffIncludes(value: unknown, path: string) {
  return sessionDiffs(value).some((diff) => diff.file === path)
}

export const MAX_SUMMARY_DIFFS = 200
export const MAX_SUMMARY_PATCH_BYTES = 10_000_000
export const MAX_SUMMARY_TOTAL_PATCH_BYTES = 10_000_000

type SummaryDiff = {
  readonly patch?: string
}

// Bound both the number of files and the total patch payload so one huge
// workspace diff cannot balloon a stored session/message record.
export function limitSummaryDiffs<T extends SummaryDiff>(diffs: readonly T[]) {
  const result: T[] = []
  let totalPatchBytes = 0

  for (const diff of diffs) {
    if (result.length >= MAX_SUMMARY_DIFFS) break

    const patch = diff.patch
    if (typeof patch !== "string") {
      result.push(diff)
      continue
    }

    const patchBytes = Buffer.byteLength(patch)
    if (patchBytes > MAX_SUMMARY_PATCH_BYTES) {
      result.push({ ...diff, patch: "" })
      continue
    }

    if (totalPatchBytes + patchBytes > MAX_SUMMARY_TOTAL_PATCH_BYTES) {
      result.push({ ...diff, patch: "" })
      continue
    }

    totalPatchBytes += patchBytes
    result.push(diff)
  }

  return result
}

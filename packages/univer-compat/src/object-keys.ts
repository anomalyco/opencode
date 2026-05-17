/** One private bucket; object keys are scoped by authenticated user id (`u/<userId>/sheets/...`). */
export function assertSafeUserSegment(userId: string) {
  if (!userId.trim()) throw new Error("empty user id")
  if (userId.includes("/") || userId.includes("\\")) throw new Error("invalid user id")
}

export function exchangeUploadKey(userId: string, fileId: string) {
  assertSafeUserSegment(userId)
  return `u/${userId}/sheets/exchange/${fileId}`
}

/** Persisted unit bundle (snapshots + changesets JSON). */
export function unitBundleKey(userId: string, unitID: string) {
  assertSafeUserSegment(userId)
  return `u/${userId}/sheets/veritly/unit/${unitID}.json`
}

/** S3 prefix for `ListObjects` / listing all persisted sheet units for a user. */
export function unitBundlesPrefix(userId: string) {
  assertSafeUserSegment(userId)
  return `u/${userId}/sheets/veritly/unit/`
}

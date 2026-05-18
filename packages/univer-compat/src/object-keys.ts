/** One private bucket; keys are `u/<userId>/p/<projectId>/sheets/...`. */
export function assertSafeUserSegment(userId: string) {
  if (!userId.trim()) throw new Error("empty user id")
  if (userId.includes("/") || userId.includes("\\")) throw new Error("invalid user id")
}

export function assertSafeProjectSegment(projectId: string) {
  if (!projectId.trim()) throw new Error("empty project id")
  if (projectId.includes("/") || projectId.includes("\\")) throw new Error("invalid project id")
}

export function exchangeUploadKey(userId: string, projectId: string, fileId: string) {
  assertSafeUserSegment(userId)
  assertSafeProjectSegment(projectId)
  return `u/${userId}/p/${projectId}/sheets/exchange/${fileId}`
}

/** Persisted unit bundle (snapshots + changesets JSON). */
export function unitBundleKey(userId: string, projectId: string, unitID: string) {
  assertSafeUserSegment(userId)
  assertSafeProjectSegment(projectId)
  return `u/${userId}/p/${projectId}/sheets/veritly/unit/${unitID}.json`
}

/** S3 prefix for `ListObjects` / listing persisted sheet units for a user within a project. */
export function unitBundlesPrefix(userId: string, projectId: string) {
  assertSafeUserSegment(userId)
  assertSafeProjectSegment(projectId)
  return `u/${userId}/p/${projectId}/sheets/veritly/unit/`
}

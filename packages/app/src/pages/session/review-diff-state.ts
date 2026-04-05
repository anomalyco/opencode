import { hasSessionDiffs, shouldFetchSessionDiff } from "@/context/global-sync/session-diff"
import type { State } from "@/context/global-sync/types"

export function sessionReviewDiffsReady(input: {
  sessionID?: string
  hasSessionReview: boolean
  sessionDiff: State["session_diff"][string] | undefined
}) {
  if (!input.sessionID) return true
  if (!input.hasSessionReview) return true
  return hasSessionDiffs(input.sessionDiff)
}

export function shouldLoadSessionReviewDiff(input: {
  sessionID?: string
  wantsReview: boolean
  sessionDiff: State["session_diff"][string] | undefined
  syncStatus: State["status"]
}) {
  if (!input.sessionID) return false
  if (!input.wantsReview) return false
  if (!shouldFetchSessionDiff(input.sessionDiff)) return false
  if (input.syncStatus === "loading") return false
  return true
}

import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2"

export type ChangeMode = "session" | "git" | "branch" | "turn"
export type VcsMode = "git" | "branch"

export const defaultChangeMode = "session" satisfies ChangeMode

export function createChangeModeOptions(input: { vcs?: string; branch?: string; defaultBranch?: string }) {
  const list: ChangeMode[] = ["session"]
  if (input.vcs === "git") list.push("git")
  if (input.vcs === "git" && input.branch && input.defaultBranch && input.branch !== input.defaultBranch) {
    list.push("branch")
  }
  list.push("turn")
  return list
}

export function changeModeTitleKey(mode: ChangeMode) {
  if (mode === "session") return "ui.sessionReview.title.session"
  if (mode === "git") return "ui.sessionReview.title.git"
  if (mode === "branch") return "ui.sessionReview.title.branch"
  return "ui.sessionReview.title.lastTurn"
}

export function reviewDiffsForMode(input: {
  mode: ChangeMode
  sessionDiffs: SnapshotFileDiff[]
  turnDiffs: SnapshotFileDiff[]
  vcsDiffs: SnapshotFileDiff[]
  vcsFetched: boolean
}) {
  if (input.mode === "session") return input.sessionDiffs
  if (input.mode === "git" || input.mode === "branch") return input.vcsFetched ? input.vcsDiffs : []
  return input.turnDiffs
}

export function reviewReadyForMode(input: { mode: ChangeMode; sessionDiffsLoaded: boolean; vcsPending: boolean }) {
  if (input.mode === "session") return input.sessionDiffsLoaded
  if (input.mode === "git" || input.mode === "branch") return !input.vcsPending
  return true
}

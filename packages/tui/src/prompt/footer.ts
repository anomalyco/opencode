import type { PromptInfo, PromptHistoryScope } from "./history"
import type { StashGesture } from "./stash-arm"

export type PromptHistoryBadge = {
  input: string
  scope: PromptHistoryScope
  origin?: PromptInfo["origin"]
}

export type PromptFooterNotice =
  | { type: "stash"; gesture: StashGesture }
  | { type: "history"; badge: PromptHistoryBadge }

export type PromptFooterState =
  | { type: "busy"; notice: PromptFooterNotice | null }
  | PromptFooterNotice
  | { type: "default" }

export function promptHistoryBadgeLabel(scope: PromptHistoryScope) {
  if (scope === "current") return "this session"
  if (scope === "other") return "other session"
  return "history"
}

export function resolvePromptFooterState(input: {
  status: "idle" | "busy" | "retry"
  stashArm: StashGesture | null
  historyBadge: PromptHistoryBadge | null
}): PromptFooterState {
  const notice = input.stashArm
    ? ({ type: "stash", gesture: input.stashArm } as const)
    : input.historyBadge
      ? ({ type: "history", badge: input.historyBadge } as const)
      : null
  if (input.status !== "idle") return { type: "busy", notice }
  return notice ?? { type: "default" }
}

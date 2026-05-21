export function rewardActionKey(reward: { status: "pending" | "available" | "applied" }, hasActiveGo: boolean) {
  if (reward.status === "applied") return "workspace.referral.reward.action.applied" as const
  if (!hasActiveGo) return "workspace.referral.reward.action.subscribeUnlock" as const
  if (reward.status === "pending") return "workspace.referral.reward.action.pendingFriendSubscription" as const
  return "workspace.referral.reward.action.view" as const
}

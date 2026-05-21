import { describe, expect, test } from "bun:test"
import { rewardActionKey } from "../src/component/go-referral.reward-action"

describe("rewardActionKey", () => {
  test("returns pending friend subscription message for pending reward with active go", () => {
    expect(rewardActionKey({ status: "pending" }, true)).toBe(
      "workspace.referral.reward.action.pendingFriendSubscription",
    )
  })

  test("returns subscribe unlock when no active go", () => {
    expect(rewardActionKey({ status: "pending" }, false)).toBe("workspace.referral.reward.action.subscribeUnlock")
  })

  test("returns applied for applied reward", () => {
    expect(rewardActionKey({ status: "applied" }, true)).toBe("workspace.referral.reward.action.applied")
  })

  test("returns view for available reward with active go", () => {
    expect(rewardActionKey({ status: "available" }, true)).toBe("workspace.referral.reward.action.view")
  })
})

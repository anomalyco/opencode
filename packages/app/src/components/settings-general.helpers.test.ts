import { describe, expect, test } from "bun:test"
import { notificationPermissionCopy } from "./settings-general.helpers"

describe("notificationPermissionCopy", () => {
  test("offers an enable action when permission is undecided", () => {
    expect(notificationPermissionCopy("default")).toEqual({
      title: "Browser notifications",
      description: "Allow notifications so your phone or browser can alert you when OpenCode needs input.",
      action: "Enable",
    })
  })

  test("explains denied permissions without an action", () => {
    expect(notificationPermissionCopy("denied")).toEqual({
      title: "Browser notifications",
      description: "Blocked in this browser. Re-enable notifications in your browser or site settings to get alerts.",
      action: undefined,
    })
  })
})

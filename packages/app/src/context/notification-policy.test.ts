import { describe, expect, test } from "bun:test"
import { shouldSuppressPageNotification } from "./notification-policy"

describe("shouldSuppressPageNotification", () => {
  test("suppresses page notifications when push is active and the app is hidden", () => {
    expect(
      shouldSuppressPageNotification({
        focused: false,
        permission: "granted",
        subscribed: true,
        supportsPush: true,
        visible: false,
      }),
    ).toBe(true)
  })

  test("suppresses page notifications when push is active and the tab is visible but unfocused", () => {
    expect(
      shouldSuppressPageNotification({
        focused: false,
        permission: "granted",
        subscribed: true,
        supportsPush: true,
        visible: true,
      }),
    ).toBe(true)
  })

  test("keeps page notifications when push is unavailable or inactive", () => {
    expect(
      shouldSuppressPageNotification({
        focused: false,
        permission: "denied",
        subscribed: true,
        supportsPush: true,
        visible: false,
      }),
    ).toBe(false)
    expect(
      shouldSuppressPageNotification({
        focused: false,
        permission: "granted",
        subscribed: false,
        supportsPush: true,
        visible: false,
      }),
    ).toBe(false)
  })
})

import { describe, expect, test } from "bun:test"
import { createNotificationErrorSound } from "./notification-error-sound"

describe("notification error sound", () => {
  test("mutes one session error and keeps other errors audible", () => {
    const sound = createNotificationErrorSound()
    sound.muteNext("session-comment-only")

    expect(sound.shouldPlay("session-other")).toBe(true)
    expect(sound.shouldPlay()).toBe(true)
    expect(sound.shouldPlay("session-comment-only")).toBe(false)
    expect(sound.shouldPlay("session-comment-only")).toBe(true)
  })

  test("restores the sound when the session settles without an error", () => {
    const sound = createNotificationErrorSound()
    sound.muteNext("session-comment-only")
    sound.settle("session-comment-only")

    expect(sound.shouldPlay("session-comment-only")).toBe(true)
  })
})

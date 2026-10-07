import { describe, expect, test } from "bun:test"
import { isAudioCapture, microphoneSettingsURL } from "./media-permissions"

describe("microphone permissions", () => {
  test("allows only an explicit audio-only request", () => {
    expect(isAudioCapture(["audio"])).toBe(true)
    expect(isAudioCapture(["video"])).toBe(false)
    expect(isAudioCapture(["audio", "video"])).toBe(false)
    expect(isAudioCapture([])).toBe(false)
    expect(isAudioCapture(undefined)).toBe(false)
    expect(isAudioCapture(["unknown"])).toBe(false)
  })

  test("opens only fixed microphone and sound settings destinations", () => {
    expect(microphoneSettingsURL("darwin", "privacy")).toBe(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    )
    expect(microphoneSettingsURL("darwin", "input")).toBe("x-apple.systempreferences:com.apple.preference.sound?input")
    expect(microphoneSettingsURL("win32", "privacy")).toBe("ms-settings:privacy-microphone")
    expect(microphoneSettingsURL("win32", "input")).toBe("ms-settings:sound")
    expect(microphoneSettingsURL("linux", "privacy")).toBeUndefined()
    expect(microphoneSettingsURL("darwin", "https://example.com")).toBeUndefined()
    expect(microphoneSettingsURL("win32", undefined)).toBeUndefined()
  })
})

export function isAudioCapture(types?: readonly string[]) {
  return types?.length === 1 && types[0] === "audio"
}

export function microphoneSettingsURL(platform: string, target: unknown) {
  if (target !== "privacy" && target !== "input") return
  if (platform === "darwin")
    return target === "privacy"
      ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
      : "x-apple.systempreferences:com.apple.preference.sound?input"
  if (platform === "win32") return target === "privacy" ? "ms-settings:privacy-microphone" : "ms-settings:sound"
}

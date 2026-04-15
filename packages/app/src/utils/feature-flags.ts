export const SHOW_PROMPT_INPUT_TRAY_STORAGE_KEY = "opencode.debug.showPromptInputTray"

export function readLocalStorageFlag(key: string) {
  if (typeof localStorage === "undefined") return false

  try {
    const raw = localStorage.getItem(key)
    if (!raw) return false

    const normalized = raw.trim().toLowerCase()
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
  } catch {
    return false
  }
}

export function isPromptInputTrayEnabled() {
  return readLocalStorageFlag(SHOW_PROMPT_INPUT_TRAY_STORAGE_KEY)
}

// Ctrl+Alt is AltGr on many Windows keyboard layouts, so a Ctrl+Alt shortcut would block typed characters.
export function trayShortcut(platform: NodeJS.Platform = process.platform) {
  return platform === "win32" ? "Super+Alt+O" : "CommandOrControl+Alt+O"
}

export function registerTrayShortcut(
  registry: { register: (key: string, callback: () => void) => boolean; unregister: (key: string) => void },
  open: () => void,
  platform: NodeJS.Platform = process.platform,
) {
  const key = trayShortcut(platform)
  const state = { registered: registry.register(key, open) }
  return {
    key,
    get registered() {
      return state.registered
    },
    dispose() {
      if (!state.registered) return
      registry.unregister(key)
      state.registered = false
    },
  }
}

type DesktopMenuPlatform = "macos" | "windows"

export const DEFAULT_KEYBINDS = {
  "common.goBack": "mod+[",
  "common.goForward": "mod+]",
  "project.next": "mod+alt+arrowdown",
  "project.open": "mod+o",
  "project.previous": "mod+alt+arrowup",
  "session.new": "mod+shift+s",
  "session.next": "alt+arrowdown",
  "session.previous": "alt+arrowup",
  "settings.open": "mod+comma",
  "terminal.toggle": "mod+j,ctrl+`",
} as const

export type DefaultKeybindCommand = keyof typeof DEFAULT_KEYBINDS

export function desktopAccelerator(command: DefaultKeybindCommand, platform: DesktopMenuPlatform) {
  const keybind = DEFAULT_KEYBINDS[command].split(",")[0]!
  const parts = keybind.split("+")
  const key = parts.pop()!
  const modifiers = parts.map((part) => {
    if (part === "mod") return platform === "macos" ? "Cmd" : "Ctrl"
    if (part === "alt") return platform === "macos" ? "Option" : "Alt"
    if (part === "shift") return "Shift"
    if (part === "ctrl") return "Ctrl"
    if (part === "meta") return "Cmd"
    return part
  })

  const keys: Record<string, string> = {
    arrowdown: "Down",
    arrowup: "Up",
    comma: ",",
  }

  return [...modifiers, keys[key] ?? key.toUpperCase()].join("+")
}

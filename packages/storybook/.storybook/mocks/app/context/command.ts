const keybinds: Record<string, string> = {
  "file.attach": "mod+u",
  "prompt.mode.shell": "mod+shift+x",
  "prompt.mode.normal": "mod+shift+e",
  "permissions.autoaccept": "mod+shift+a",
  "agent.cycle": "mod+.",
  "model.choose": "mod+m",
  "model.variant.cycle": "mod+shift+m",
  "session.background": "ctrl+b",
}

export const DEFAULT_PALETTE_KEYBIND = "mod+k,mod+shift+p"

export function parseKeybind(config: string) {
  if (!config || config === "none") return []
  return config.split(",").map((combo) => {
    const parts = combo.trim().toLowerCase().split("+")
    return {
      key:
        parts.find(
          (part) => !["ctrl", "control", "meta", "cmd", "command", "mod", "alt", "option", "shift"].includes(part),
        ) ?? "",
      ctrl: parts.includes("ctrl") || parts.includes("control") || parts.includes("mod"),
      meta: parts.includes("meta") || parts.includes("cmd") || parts.includes("command"),
      shift: parts.includes("shift"),
      alt: parts.includes("alt") || parts.includes("option"),
    }
  })
}

export function formatKeybind(config: string) {
  return config === "none" ? "" : config
}

export function formatKeybindParts(config: string) {
  return formatKeybind(config).split("+").filter(Boolean)
}

export function matchKeybind(
  keybinds: Array<{ key: string; ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }>,
  event: KeyboardEvent,
) {
  const key = event.key.toLowerCase()
  return keybinds.some(
    (keybind) =>
      keybind.key === key &&
      keybind.ctrl === event.ctrlKey &&
      keybind.meta === event.metaKey &&
      keybind.shift === event.shiftKey &&
      keybind.alt === event.altKey,
  )
}

export function useCommand() {
  return {
    options: [],
    register() {
      return () => undefined
    },
    trigger() {},
    keybind(id: string) {
      return keybinds[id]
    },
    keybindParts(id: string) {
      return keybinds[id]?.split("+") ?? []
    },
  }
}

const keybinds: Record<string, string> = {
  "file.attach": "mod+u",
  "prompt.mode.shell": "mod+shift+x",
  "prompt.mode.normal": "mod+shift+e",
  "permissions.autoaccept": "mod+shift+a",
  "agent.cycle": "mod+.",
  "model.choose": "mod+m",
  "model.variant.cycle": "mod+shift+m",
}

export type CommandOption = {
  id: string
  title: string
  keybind?: string
}

export function formatKeybind(config: string) {
  if (!config || config === "none") return ""
  return config.split(",", 1)[0]
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
  }
}

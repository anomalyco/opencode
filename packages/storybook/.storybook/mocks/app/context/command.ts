const keybinds: Record<string, string> = {
  "file.attach": "mod+u",
  "prompt.mode.shell": "mod+shift+x",
  "prompt.mode.normal": "mod+shift+e",
  "permissions.autoaccept": "mod+shift+a",
  "agent.cycle": "mod+.",
  "model.choose": "mod+m",
  "model.variant.cycle": "mod+shift+m",
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

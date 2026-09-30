type CommandKeybind = {
  keybindParts: (id: string) => string[]
}

export function reviewTooltipKeybind(command: CommandKeybind, _translate?: (key: string) => string) {
  return command.keybindParts("review.toggle")
}

export function terminalTooltipKeybind(command: CommandKeybind, _translate?: (key: string) => string) {
  return command.keybindParts("terminal.toggle")
}

export function newTabTooltipKeybind(command: CommandKeybind, _translate?: (key: string) => string) {
  return command.keybindParts("tab.new")
}

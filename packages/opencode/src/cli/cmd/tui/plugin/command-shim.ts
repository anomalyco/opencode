import type { TuiCommand, TuiPluginApi } from "@opencode-ai/plugin/tui"

const COMMAND_PALETTE_SHOW = "command.palette.show"
const warned = new Set<string>()

type Warn = (api: string, replacement: string) => void

function warnOnce(api: string, replacement: string, warn: Warn) {
  if (warned.has(api)) return
  warned.add(api)
  warn(api, replacement)
}

function toCommand(item: TuiCommand) {
  return {
    namespace: "palette",
    name: item.value,
    title: item.title,
    desc: item.description,
    category: item.category,
    suggested: item.suggested,
    hidden: item.hidden,
    enabled: item.enabled,
    slashName: item.slash?.name,
    slashAliases: item.slash?.aliases,
    run() {
      item.onSelect?.()
    },
  }
}

function toBindings(commands: TuiCommand[]) {
  return commands.flatMap((item) =>
    item.keybind
      ? [
          {
            key: item.keybind,
            cmd: item.value,
            desc: item.title,
          },
        ]
      : [],
  )
}

export function createCommandShim(keymap: TuiPluginApi["keymap"], warn: Warn): TuiPluginApi["command"] {
  return {
    register(cb) {
      warnOnce("api.command.register", "api.keymap.registerLayer({ commands, bindings })", warn)
      const commands = cb()
      return keymap.registerLayer({
        commands: commands.map(toCommand),
        bindings: toBindings(commands),
      })
    },
    trigger(value) {
      warnOnce("api.command.trigger", "api.keymap.dispatchCommand(name)", warn)
      keymap.dispatchCommand(value)
    },
    show() {
      warnOnce("api.command.show", `api.keymap.dispatchCommand("${COMMAND_PALETTE_SHOW}")`, warn)
      keymap.dispatchCommand(COMMAND_PALETTE_SHOW)
    },
  }
}

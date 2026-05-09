import type { TuiCommand, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { TuiKeybind } from "../config/keybind"
import type { DialogContext } from "../ui/dialog"

const COMMAND_PALETTE_SHOW = "command.palette.show"
const warned = new Set<string>()

type Warn = (api: string, replacement: string) => void
type LegacyDialog = TuiPluginApi["ui"]["dialog"]
type CommandShimDialog = DialogContext | LegacyDialog
type LegacyKeybinds = TuiPluginApi["tuiConfig"]["keybinds"]

function createCommandShimDialog(dialog: CommandShimDialog): LegacyDialog {
  if (!("stack" in dialog)) return dialog
  return {
    replace(render, onClose) {
      dialog.replace(render, onClose)
    },
    clear() {
      dialog.clear()
    },
    setSize(size) {
      dialog.setSize(size)
    },
    get size() {
      return dialog.size
    },
    get depth() {
      return dialog.stack.length
    },
    get open() {
      return dialog.stack.length > 0
    },
  }
}

function warnOnce(api: string, replacement: string, warn: Warn) {
  if (warned.has(api)) return
  warned.add(api)
  warn(api, replacement)
}

function toCommand(item: TuiCommand, dialog: LegacyDialog) {
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
      return item.onSelect?.(dialog)
    },
  }
}

function toBindings(commands: TuiCommand[], keybinds: LegacyKeybinds) {
  return commands.flatMap((item) =>
    item.keybind
      ? keybinds.has(TuiKeybind.CommandMap[item.keybind as keyof typeof TuiKeybind.CommandMap] ?? item.keybind)
        ? keybinds
            .get(TuiKeybind.CommandMap[item.keybind as keyof typeof TuiKeybind.CommandMap] ?? item.keybind)
            .map((binding) => ({ ...binding, cmd: item.value, desc: binding.desc ?? item.title }))
        : [
            {
              key: item.keybind,
              cmd: item.value,
              desc: item.title,
            },
          ]
      : [],
  )
}

export function createCommandShim(
  keymap: TuiPluginApi["keymap"],
  warn: Warn,
  dialog: CommandShimDialog,
  keybinds: LegacyKeybinds,
): TuiPluginApi["command"] {
  const shimDialog = createCommandShimDialog(dialog)
  return {
    register(cb) {
      warnOnce("api.command.register", "api.keymap.registerLayer({ commands, bindings })", warn)
      const commands = cb()
      return keymap.registerLayer({
        commands: commands.map((item) => toCommand(item, shimDialog)),
        bindings: toBindings(commands, keybinds),
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

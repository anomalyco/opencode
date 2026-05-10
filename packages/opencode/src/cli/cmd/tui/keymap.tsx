import { type CliRenderer, type Renderable } from "@opentui/core"
import * as addons from "@opentui/keymap/addons/opentui"
import { stringifyKeyStroke } from "@opentui/keymap"
import {
  formatCommandBindings as formatCommandBindingsExtra,
  formatKeySequence as formatKeySequenceExtra,
} from "@opentui/keymap/extras"
import {
  KeymapProvider,
  reactiveMatcherFromSignal,
  useKeymap,
  useKeymapSelector,
  useBindings as useKeymapBindings,
  type UseBindingsLayer,
} from "@opentui/keymap/solid"
import type { Accessor } from "solid-js"
import type { TuiConfig } from "./config/tui"
import { useTuiConfig } from "./context/tui-config"
import { TuiKeybind } from "./config/keybind"

export const LEADER_TOKEN = "leader"

export const OpencodeKeymapProvider = KeymapProvider
export const useOpencodeKeymap = useKeymap

export { reactiveMatcherFromSignal, useKeymapSelector }

export type OpenTuiKeymap = ReturnType<typeof useKeymap>

const KEY_ALIASES = {
  enter: "return",
  esc: "escape",
} as const

function expandKeyAliases(input: string) {
  const result = Object.entries(KEY_ALIASES).reduce(
    (acc, [alias, key]) => acc.replace(new RegExp(`(^|[+\\s>])${alias}(?=$|[+\\s<])`, "gi"), `$1${key}`),
    input,
  )
  if (result === input) return
  return result
}

const inputCommands = [
  "input.move.left",
  "input.move.right",
  "input.move.up",
  "input.move.down",
  "input.select.left",
  "input.select.right",
  "input.select.up",
  "input.select.down",
  "input.line.home",
  "input.line.end",
  "input.select.line.home",
  "input.select.line.end",
  "input.visual.line.home",
  "input.visual.line.end",
  "input.select.visual.line.home",
  "input.select.visual.line.end",
  "input.buffer.home",
  "input.buffer.end",
  "input.select.buffer.home",
  "input.select.buffer.end",
  "input.delete.line",
  "input.delete.to.line.end",
  "input.delete.to.line.start",
  "input.backspace",
  "input.delete",
  "input.newline",
  "input.undo",
  "input.redo",
  "input.word.forward",
  "input.word.backward",
  "input.select.word.forward",
  "input.select.word.backward",
  "input.delete.word.forward",
  "input.delete.word.backward",
  "input.select.all",
  "input.submit",
] as const

function leaderDisplay(config: TuiConfig.Resolved) {
  const key = config.keybinds.get(LEADER_TOKEN)?.[0]?.key
  if (!key) return TuiKeybind.LeaderDefault
  return typeof key === "string" ? key : stringifyKeyStroke(key)
}

function formatOptions(config: TuiConfig.Resolved) {
  return {
    tokenDisplay: {
      [LEADER_TOKEN]: leaderDisplay(config),
    },
    keyNameAliases: {
      pageup: "pgup",
      pagedown: "pgdn",
      delete: "del",
    },
    modifierAliases: {
      meta: "alt",
    },
  } as const
}

function keyAliases(layerAliases: unknown) {
  if (!layerAliases || typeof layerAliases !== "object" || Array.isArray(layerAliases)) return KEY_ALIASES
  return {
    ...KEY_ALIASES,
    ...(layerAliases as Record<string, string>),
  }
}

export function useBindings<TRenderable extends Renderable = Renderable>(
  createLayer: () => UseBindingsLayer<TRenderable>,
) {
  useKeymapBindings(() => {
    const layer = createLayer()
    return {
      ...layer,
      aliases: keyAliases(layer.aliases),
    }
  })
}

export function formatKeySequence(parts: Parameters<typeof formatKeySequenceExtra>[0], config: TuiConfig.Resolved) {
  return formatKeySequenceExtra(parts, formatOptions(config))
}

export function formatKeyBindings(
  bindings: Parameters<typeof formatCommandBindingsExtra>[0],
  config: TuiConfig.Resolved,
) {
  return formatCommandBindingsExtra(bindings, formatOptions(config))
}

export function registerOpencodeKeymap(
  keymap: OpenTuiKeymap,
  renderer: CliRenderer,
  config: Pick<TuiConfig.Resolved, "keybinds" | "leader_timeout">,
) {
  const offCommaBindings = addons.registerCommaBindings(keymap)
  const offBaseLayout = addons.registerBaseLayoutFallback(keymap)
  const offAliases = addons.registerAliasesField(keymap)
  const offAliasExpander = keymap.prependBindingExpander((ctx) => {
    const key = expandKeyAliases(ctx.input)
    if (!key) return
    return [{ key }]
  })
  const offLeader = addons.registerTimedLeader(keymap, {
    trigger: config.keybinds.get(LEADER_TOKEN),
    name: LEADER_TOKEN,
    timeoutMs: config.leader_timeout,
  })
  const offEscape = addons.registerEscapeClearsPendingSequence(keymap)
  const offBackspace = addons.registerBackspacePopsPendingSequence(keymap)
  const offInputBindings = addons.registerManagedTextareaLayer(keymap, renderer, {
    enabled: () => renderer.currentFocusedEditor !== null,
    aliases: KEY_ALIASES,
    bindings: config.keybinds.gather("input", inputCommands),
  })

  return () => {
    offInputBindings()
    offBackspace()
    offEscape()
    offLeader()
    offAliasExpander()
    offAliases()
    offBaseLayout()
    offCommaBindings()
  }
}

export function useCommandShortcut(command: string): Accessor<string> {
  const config = useTuiConfig()
  return useKeymapSelector((keymap) =>
    formatKeySequence(
      keymap.getCommandBindings({ visibility: "registered", commands: [command] }).get(command)?.[0]?.sequence,
      config,
    ),
  )
}

export function useLeaderActive(): Accessor<boolean> {
  return useKeymapSelector((keymap: OpenTuiKeymap) => keymap.getPendingSequence()[0]?.tokenName === LEADER_TOKEN)
}

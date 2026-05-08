import { type CliRenderer } from "@opentui/core"
import * as addons from "@opentui/keymap/addons/opentui"
import {
  formatCommandBindings as formatCommandBindingsExtra,
  formatKeySequence as formatKeySequenceExtra,
} from "@opentui/keymap/extras"
import {
  KeymapProvider,
  reactiveMatcherFromSignal,
  useBindings,
  useKeymap,
  useKeymapSelector,
} from "@opentui/keymap/solid"
import type { Accessor } from "solid-js"
import type { TuiConfig } from "./config/tui"
import { useTuiConfig } from "./context/tui-config"

export const LEADER_TOKEN = "leader"

export const OpencodeKeymapProvider = KeymapProvider
export const useOpencodeKeymap = useKeymap

export { reactiveMatcherFromSignal, useBindings, useKeymapSelector }

export type OpenTuiKeymap = ReturnType<typeof useKeymap>

function formatOptions(config: TuiConfig.Resolved) {
  return {
    tokenDisplay: {
      [LEADER_TOKEN]: config.keymap.leader,
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

export function formatKeySequence(parts: Parameters<typeof formatKeySequenceExtra>[0], config: TuiConfig.Resolved) {
  return formatKeySequenceExtra(parts, formatOptions(config))
}

export function formatKeyBindings(
  bindings: Parameters<typeof formatCommandBindingsExtra>[0],
  config: TuiConfig.Resolved,
) {
  return formatCommandBindingsExtra(bindings, formatOptions(config))
}

export function registerOpencodeKeymap(keymap: OpenTuiKeymap, renderer: CliRenderer, config: TuiConfig.Resolved) {
  const offCommaBindings = addons.registerCommaBindings(keymap)
  const offBaseLayout = addons.registerBaseLayoutFallback(keymap)
  const offLeader = addons.registerTimedLeader(keymap, {
    trigger: config.keymap.leader,
    name: LEADER_TOKEN,
    timeoutMs: config.keymap.leader_timeout,
  })
  const offEscape = addons.registerEscapeClearsPendingSequence(keymap)
  const offBackspace = addons.registerBackspacePopsPendingSequence(keymap)
  const offInputBindings = addons.registerManagedTextareaLayer(keymap, renderer, {
    enabled: () => renderer.currentFocusedEditor !== null,
    bindings: config.keymap.sections.input,
  })

  return () => {
    offInputBindings()
    offBackspace()
    offEscape()
    offLeader()
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

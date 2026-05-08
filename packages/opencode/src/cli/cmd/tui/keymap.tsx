import { type CliRenderer } from "@opentui/core"
import * as addons from "@opentui/keymap/addons/opentui"
import type { EditBufferCommandName } from "@opentui/keymap/addons/opentui"
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

const inputCommandNames = {
  "move-left": "input_move_left",
  "move-right": "input_move_right",
  "move-up": "input_move_up",
  "move-down": "input_move_down",
  "select-left": "input_select_left",
  "select-right": "input_select_right",
  "select-up": "input_select_up",
  "select-down": "input_select_down",
  "line-home": "input_line_home",
  "line-end": "input_line_end",
  "select-line-home": "input_select_line_home",
  "select-line-end": "input_select_line_end",
  "visual-line-home": "input_visual_line_home",
  "visual-line-end": "input_visual_line_end",
  "select-visual-line-home": "input_select_visual_line_home",
  "select-visual-line-end": "input_select_visual_line_end",
  "buffer-home": "input_buffer_home",
  "buffer-end": "input_buffer_end",
  "select-buffer-home": "input_select_buffer_home",
  "select-buffer-end": "input_select_buffer_end",
  "delete-line": "input_delete_line",
  "delete-to-line-end": "input_delete_to_line_end",
  "delete-to-line-start": "input_delete_to_line_start",
  backspace: "input_backspace",
  delete: "input_delete",
  newline: "input_newline",
  undo: "input_undo",
  redo: "input_redo",
  "word-forward": "input_word_forward",
  "word-backward": "input_word_backward",
  "select-word-forward": "input_select_word_forward",
  "select-word-backward": "input_select_word_backward",
  "delete-word-forward": "input_delete_word_forward",
  "delete-word-backward": "input_delete_word_backward",
  "select-all": "input_select_all",
  submit: "input_submit",
} satisfies Record<EditBufferCommandName, string>

const inputCommands = Object.values(inputCommandNames)

function formatOptions(config: TuiConfig.Resolved) {
  return {
    tokenDisplay: {
      [LEADER_TOKEN]: config.leader,
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
    trigger: config.leader,
    name: LEADER_TOKEN,
    timeoutMs: config.leader_timeout,
  })
  const offEscape = addons.registerEscapeClearsPendingSequence(keymap)
  const offBackspace = addons.registerBackspacePopsPendingSequence(keymap)
  const offInputCommands = addons.registerEditBufferCommands(keymap, renderer, { commandNames: inputCommandNames })
  const offInputSuspension = addons.registerTextareaMappingSuspension(keymap, renderer)
  const offInputBindings = keymap.registerLayer({
    enabled: () => renderer.currentFocusedEditor !== null,
    bindings: config.keybinds.gather("input", inputCommands),
  })

  return () => {
    offInputBindings()
    offInputSuspension()
    offInputCommands()
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

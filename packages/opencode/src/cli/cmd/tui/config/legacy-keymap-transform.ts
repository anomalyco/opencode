import type { KeyEvent, Renderable } from "@opentui/core"
import type { Binding } from "@opentui/keymap"
import type { BindingValue } from "@opentui/keymap/extras"
import { ConfigKeybinds } from "@/config/keybinds"
import { type KeymapConfigInput, type KeymapSection } from "./tui-schema"

type LegacyKeybinds = Partial<ConfigKeybinds.Keybinds>
type SectionsConfig = Record<string, Record<string, BindingValue<Renderable, KeyEvent>>>

const inputCommands = {
  input_submit: "input.submit",
  input_newline: "input.newline",
  input_move_left: "input.move.left",
  input_move_right: "input.move.right",
  input_move_up: "input.move.up",
  input_move_down: "input.move.down",
  input_select_left: "input.select.left",
  input_select_right: "input.select.right",
  input_select_up: "input.select.up",
  input_select_down: "input.select.down",
  input_line_home: "input.line.home",
  input_line_end: "input.line.end",
  input_select_line_home: "input.select.line.home",
  input_select_line_end: "input.select.line.end",
  input_visual_line_home: "input.visual.line.home",
  input_visual_line_end: "input.visual.line.end",
  input_select_visual_line_home: "input.select.visual.line.home",
  input_select_visual_line_end: "input.select.visual.line.end",
  input_buffer_home: "input.buffer.home",
  input_buffer_end: "input.buffer.end",
  input_select_buffer_home: "input.select.buffer.home",
  input_select_buffer_end: "input.select.buffer.end",
  input_delete_line: "input.delete.line",
  input_delete_to_line_end: "input.delete.to.line.end",
  input_delete_to_line_start: "input.delete.to.line.start",
  input_backspace: "input.backspace",
  input_delete: "input.delete",
  input_undo: "input.undo",
  input_redo: "input.redo",
  input_word_forward: "input.word.forward",
  input_word_backward: "input.word.backward",
  input_select_word_forward: "input.select.word.forward",
  input_select_word_backward: "input.select.word.backward",
  input_delete_word_forward: "input.delete.word.forward",
  input_delete_word_backward: "input.delete.word.backward",
  input_select_all: "input.select.all",
} as const satisfies Partial<Record<keyof LegacyKeybinds, string>>

function add(
  config: SectionsConfig,
  section: KeymapSection,
  command: string,
  binding: BindingValue<Renderable, KeyEvent> | undefined,
) {
  if (binding === undefined) return
  config[section] ??= {}
  config[section][command] = binding
}

function bindingWith(key: string | undefined, input: Omit<Binding<Renderable, KeyEvent>, "key" | "cmd">) {
  if (!key) return undefined
  if (key === "none") return "none"
  return { ...input, key }
}

function combineBindings(...keys: (string | undefined)[]) {
  const result = Array.from(
    new Set(
      keys.flatMap((key) => {
        if (!key || key === "none") return []
        return key
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part && part !== "none")
      }),
    ),
  )
  if (result.length) return result.join(",")
  if (keys.some((key) => key === "none")) return "none"
  return undefined
}

export function create(keybinds: LegacyKeybinds): KeymapConfigInput {
  const config: SectionsConfig = {}

  add(config, "global", "command.palette.show", keybinds.command_list)
  add(config, "global", "session.list", keybinds.session_list)
  add(config, "global", "session.new", keybinds.session_new)
  add(config, "global", "model.list", keybinds.model_list)
  add(config, "global", "model.cycle_recent", keybinds.model_cycle_recent)
  add(config, "global", "model.cycle_recent_reverse", keybinds.model_cycle_recent_reverse)
  add(config, "global", "model.cycle_favorite", keybinds.model_cycle_favorite)
  add(config, "global", "model.cycle_favorite_reverse", keybinds.model_cycle_favorite_reverse)
  add(config, "global", "agent.list", keybinds.agent_list)
  add(config, "global", "agent.cycle", keybinds.agent_cycle)
  add(config, "global", "agent.cycle.reverse", keybinds.agent_cycle_reverse)
  add(config, "global", "variant.cycle", keybinds.variant_cycle)
  add(config, "global", "variant.list", keybinds.variant_list)
  add(config, "prompt", "prompt.editor", keybinds.editor_open)
  add(config, "global", "opencode.status", keybinds.status_view)
  add(config, "global", "theme.switch", keybinds.theme_list)
  add(config, "global", "app.exit", keybinds.app_exit)
  add(config, "global", "terminal.suspend", keybinds.terminal_suspend)
  add(config, "global", "terminal.title.toggle", keybinds.terminal_title_toggle)

  add(config, "session", "session.share", keybinds.session_share)
  add(config, "session", "session.rename", keybinds.session_rename)
  add(config, "session", "session.timeline", keybinds.session_timeline)
  add(config, "session", "session.fork", keybinds.session_fork)
  add(config, "session", "session.compact", keybinds.session_compact)
  add(config, "session", "session.unshare", keybinds.session_unshare)
  add(config, "session", "session.undo", keybinds.messages_undo)
  add(config, "session", "session.redo", keybinds.messages_redo)
  add(config, "session", "session.sidebar.toggle", keybinds.sidebar_toggle)
  add(config, "session", "session.toggle.conceal", keybinds.messages_toggle_conceal)
  add(config, "session", "session.toggle.thinking", keybinds.display_thinking)
  add(config, "session", "session.toggle.actions", keybinds.tool_details)
  add(config, "session", "session.toggle.scrollbar", keybinds.scrollbar_toggle)
  add(config, "session", "session.page.up", keybinds.messages_page_up)
  add(config, "session", "session.page.down", keybinds.messages_page_down)
  add(config, "session", "session.line.up", keybinds.messages_line_up)
  add(config, "session", "session.line.down", keybinds.messages_line_down)
  add(config, "session", "session.half.page.up", keybinds.messages_half_page_up)
  add(config, "session", "session.half.page.down", keybinds.messages_half_page_down)
  add(config, "session", "session.first", keybinds.messages_first)
  add(config, "session", "session.last", keybinds.messages_last)
  add(config, "session", "session.messages_last_user", keybinds.messages_last_user)
  add(config, "session", "session.message.next", keybinds.messages_next)
  add(config, "session", "session.message.previous", keybinds.messages_previous)
  add(config, "session", "messages.copy", keybinds.messages_copy)
  add(config, "session", "session.export", keybinds.session_export)
  add(config, "session", "session.child.first", keybinds.session_child_first)
  add(config, "session", "session.parent", keybinds.session_parent)
  add(config, "session", "session.child.next", keybinds.session_child_cycle)
  add(config, "session", "session.child.previous", keybinds.session_child_cycle_reverse)

  add(config, "prompt", "session.interrupt", keybinds.session_interrupt)
  add(config, "prompt", "prompt.clear", keybinds.input_clear)
  add(config, "prompt", "prompt.paste", bindingWith(keybinds.input_paste, { preventDefault: false }))
  add(config, "prompt", "prompt.history.previous", keybinds.history_previous)
  add(config, "prompt", "prompt.history.next", keybinds.history_next)

  add(config, "autocomplete", "prompt.autocomplete.prev", keybinds["prompt.autocomplete.prev"])
  add(config, "autocomplete", "prompt.autocomplete.next", keybinds["prompt.autocomplete.next"])
  add(config, "autocomplete", "prompt.autocomplete.hide", keybinds["prompt.autocomplete.hide"])
  add(config, "autocomplete", "prompt.autocomplete.select", keybinds["prompt.autocomplete.select"])
  add(config, "autocomplete", "prompt.autocomplete.complete", keybinds["prompt.autocomplete.complete"])

  for (const [legacy, command] of Object.entries(inputCommands) as [keyof typeof inputCommands, string][]) {
    add(config, "input", command, keybinds[legacy])
  }

  add(config, "dialog_select", "dialog.select.prev", keybinds["dialog.select.prev"])
  add(config, "dialog_select", "dialog.select.next", keybinds["dialog.select.next"])
  add(config, "dialog_select", "dialog.select.page_up", keybinds["dialog.select.page_up"])
  add(config, "dialog_select", "dialog.select.page_down", keybinds["dialog.select.page_down"])
  add(config, "dialog_select", "dialog.select.home", keybinds["dialog.select.home"])
  add(config, "dialog_select", "dialog.select.end", keybinds["dialog.select.end"])
  add(config, "dialog_select", "dialog.select.submit", keybinds["dialog.select.submit"])
  add(config, "dialog_actions", "dialog.action.delete", combineBindings(keybinds.stash_delete, keybinds.session_delete))
  add(config, "dialog_actions", "dialog.action.rename", keybinds.session_rename)
  add(
    config,
    "dialog_actions",
    "dialog.action.toggle",
    combineBindings(keybinds["dialog.mcp.toggle"], keybinds["plugins.toggle"]),
  )
  add(config, "model", "model.dialog.provider", keybinds.model_provider_list)
  add(config, "model", "model.dialog.favorite", keybinds.model_favorite_toggle)

  add(config, "permission", "permission.reject.cancel", keybinds.app_exit)
  add(config, "permission", "permission.prompt.escape", keybinds.app_exit)
  add(config, "permission", "permission.prompt.fullscreen", keybinds["permission.prompt.fullscreen"])
  add(config, "question", "question.reject", keybinds.app_exit)
  add(config, "question", "question.edit.clear", keybinds.input_clear)

  add(config, "plugins", "plugins.list", keybinds.plugin_manager)
  add(config, "plugins", "plugin.dialog.install", keybinds["dialog.plugins.install"])
  add(config, "home_tips", "tips.toggle", keybinds.tips_toggle)

  return {
    ...(keybinds.leader && keybinds.leader !== "none" && { leader: keybinds.leader }),
    sections: config,
  }
}

export * as LegacyKeymapTransform from "./legacy-keymap-transform"

export * as ConfigKeybinds from "./keybinds"

import z from "zod"

export const Keybinds = z
  .object({
    leader: z.string().optional().default("ctrl+x").describe("Leader key for keybind combinations"),
    app_exit: z.string().optional().default("ctrl+c,ctrl+d,<leader>q").describe("Exit the application"),
    editor_open: z.string().optional().default("<leader>e").describe("Open external editor"),
    theme_list: z.string().optional().default("<leader>t").describe("List available themes"),
    sidebar_toggle: z.string().optional().default("<leader>b").describe("Toggle sidebar"),
    scrollbar_toggle: z.string().optional().default("none").describe("Toggle session scrollbar"),
    username_toggle: z.string().optional().default("none").describe("Toggle username visibility"),
    status_view: z.string().optional().default("<leader>s").describe("View status"),
    session_export: z.string().optional().default("<leader>x").describe("Export session to editor"),
    session_new: z.string().optional().default("<leader>n").describe("Create a new session"),
    session_list: z.string().optional().default("<leader>l").describe("List all sessions"),
    session_timeline: z.string().optional().default("<leader>g").describe("Show session timeline"),
    session_fork: z.string().optional().default("none").describe("Fork session from message"),
    session_rename: z.string().optional().default("ctrl+r").describe("Rename session"),
    session_delete: z.string().optional().default("ctrl+d").describe("Delete session"),
    stash_delete: z.string().optional().default("ctrl+d").describe("Delete stash entry"),
    model_provider_list: z.string().optional().default("ctrl+a").describe("Open provider list from model dialog"),
    model_favorite_toggle: z.string().optional().default("ctrl+f").describe("Toggle model favorite status"),
    session_share: z.string().optional().default("none").describe("Share current session"),
    session_unshare: z.string().optional().default("none").describe("Unshare current session"),
    session_interrupt: z.string().optional().default("escape").describe("Interrupt current session"),
    session_compact: z.string().optional().default("<leader>c").describe("Compact the session"),
    messages_page_up: z.string().optional().default("pageup,ctrl+alt+b").describe("Scroll messages up by one page"),
    messages_page_down: z
      .string()
      .optional()
      .default("pagedown,ctrl+alt+f")
      .describe("Scroll messages down by one page"),
    messages_line_up: z.string().optional().default("ctrl+alt+y").describe("Scroll messages up by one line"),
    messages_line_down: z.string().optional().default("ctrl+alt+e").describe("Scroll messages down by one line"),
    messages_half_page_up: z.string().optional().default("ctrl+alt+u").describe("Scroll messages up by half page"),
    messages_half_page_down: z.string().optional().default("ctrl+alt+d").describe("Scroll messages down by half page"),
    messages_first: z.string().optional().default("ctrl+g,home").describe("Navigate to first message"),
    messages_last: z.string().optional().default("ctrl+alt+g,end").describe("Navigate to last message"),
    messages_next: z.string().optional().default("none").describe("Navigate to next message"),
    messages_previous: z.string().optional().default("none").describe("Navigate to previous message"),
    messages_last_user: z.string().optional().default("none").describe("Navigate to last user message"),
    messages_copy: z.string().optional().default("<leader>y").describe("Copy message"),
    messages_undo: z.string().optional().default("<leader>u").describe("Undo message"),
    messages_redo: z.string().optional().default("<leader>r").describe("Redo message"),
    messages_toggle_conceal: z
      .string()
      .optional()
      .default("<leader>h")
      .describe("Toggle code block concealment in messages"),
    tool_details: z.string().optional().default("none").describe("Toggle tool details visibility"),
    model_list: z.string().optional().default("<leader>m").describe("List available models"),
    model_cycle_recent: z.string().optional().default("f2").describe("Next recently used model"),
    model_cycle_recent_reverse: z.string().optional().default("shift+f2").describe("Previous recently used model"),
    model_cycle_favorite: z.string().optional().default("none").describe("Next favorite model"),
    model_cycle_favorite_reverse: z.string().optional().default("none").describe("Previous favorite model"),
    command_list: z.string().optional().default("ctrl+p").describe("List available commands"),
    agent_list: z.string().optional().default("<leader>a").describe("List agents"),
    agent_cycle: z.string().optional().default("tab").describe("Next agent"),
    agent_cycle_reverse: z.string().optional().default("shift+tab").describe("Previous agent"),
    variant_cycle: z.string().optional().default("ctrl+t").describe("Cycle model variants"),
    variant_list: z.string().optional().default("none").describe("List model variants"),
    input_clear: z.string().optional().default("ctrl+c").describe("Clear input field"),
    input_paste: z.string().optional().default("ctrl+v").describe("Paste from clipboard"),
    input_submit: z.string().optional().default("return").describe("Submit input"),
    input_newline: z
      .string()
      .optional()
      .default("shift+return,ctrl+return,alt+return,ctrl+j")
      .describe("Insert newline in input"),
    input_move_left: z.string().optional().default("left,ctrl+b").describe("Move cursor left in input"),
    input_move_right: z.string().optional().default("right,ctrl+f").describe("Move cursor right in input"),
    input_move_up: z.string().optional().default("up").describe("Move cursor up in input"),
    input_move_down: z.string().optional().default("down").describe("Move cursor down in input"),
    input_select_left: z.string().optional().default("shift+left").describe("Select left in input"),
    input_select_right: z.string().optional().default("shift+right").describe("Select right in input"),
    input_select_up: z.string().optional().default("shift+up").describe("Select up in input"),
    input_select_down: z.string().optional().default("shift+down").describe("Select down in input"),
    input_line_home: z.string().optional().default("ctrl+a").describe("Move to start of line in input"),
    input_line_end: z.string().optional().default("ctrl+e").describe("Move to end of line in input"),
    input_select_line_home: z.string().optional().default("ctrl+shift+a").describe("Select to start of line in input"),
    input_select_line_end: z.string().optional().default("ctrl+shift+e").describe("Select to end of line in input"),
    input_visual_line_home: z.string().optional().default("alt+a").describe("Move to start of visual line in input"),
    input_visual_line_end: z.string().optional().default("alt+e").describe("Move to end of visual line in input"),
    input_select_visual_line_home: z
      .string()
      .optional()
      .default("alt+shift+a")
      .describe("Select to start of visual line in input"),
    input_select_visual_line_end: z
      .string()
      .optional()
      .default("alt+shift+e")
      .describe("Select to end of visual line in input"),
    input_buffer_home: z.string().optional().default("home").describe("Move to start of buffer in input"),
    input_buffer_end: z.string().optional().default("end").describe("Move to end of buffer in input"),
    input_select_buffer_home: z
      .string()
      .optional()
      .default("shift+home")
      .describe("Select to start of buffer in input"),
    input_select_buffer_end: z.string().optional().default("shift+end").describe("Select to end of buffer in input"),
    input_delete_line: z.string().optional().default("ctrl+shift+d").describe("Delete line in input"),
    input_delete_to_line_end: z.string().optional().default("ctrl+k").describe("Delete to end of line in input"),
    input_delete_to_line_start: z.string().optional().default("ctrl+u").describe("Delete to start of line in input"),
    input_backspace: z.string().optional().default("backspace,shift+backspace").describe("Backspace in input"),
    input_delete: z.string().optional().default("ctrl+d,delete,shift+delete").describe("Delete character in input"),
    input_undo: z
      .string()
      .optional()
      // On Windows prepend ctrl+z since terminal_suspend releases the binding.
      .default(process.platform === "win32" ? "ctrl+z,ctrl+-,super+z" : "ctrl+-,super+z")
      .describe("Undo in input"),
    input_redo: z.string().optional().default("ctrl+.,super+shift+z").describe("Redo in input"),
    input_word_forward: z
      .string()
      .optional()
      .default("alt+f,alt+right,ctrl+right")
      .describe("Move word forward in input"),
    input_word_backward: z
      .string()
      .optional()
      .default("alt+b,alt+left,ctrl+left")
      .describe("Move word backward in input"),
    input_select_word_forward: z
      .string()
      .optional()
      .default("alt+shift+f,alt+shift+right")
      .describe("Select word forward in input"),
    input_select_word_backward: z
      .string()
      .optional()
      .default("alt+shift+b,alt+shift+left")
      .describe("Select word backward in input"),
    input_delete_word_forward: z
      .string()
      .optional()
      .default("alt+d,alt+delete,ctrl+delete")
      .describe("Delete word forward in input"),
    input_delete_word_backward: z
      .string()
      .optional()
      .default("ctrl+w,ctrl+backspace,alt+backspace")
      .describe("Delete word backward in input"),
    history_previous: z.string().optional().default("up").describe("Previous history item"),
    history_next: z.string().optional().default("down").describe("Next history item"),
    session_child_first: z.string().optional().default("<leader>down").describe("Go to first child session"),
    session_child_cycle: z.string().optional().default("right").describe("Go to next child session"),
    session_child_cycle_reverse: z.string().optional().default("left").describe("Go to previous child session"),
    session_parent: z.string().optional().default("up").describe("Go to parent session"),
    terminal_suspend: z
      .string()
      .optional()
      .default("ctrl+z")
      .transform((v) => (process.platform === "win32" ? "none" : v))
      .describe("Suspend terminal"),
    terminal_title_toggle: z.string().optional().default("none").describe("Toggle terminal title"),
    tips_toggle: z.string().optional().default("<leader>h").describe("Toggle tips on home screen"),
    plugin_manager: z.string().optional().default("none").describe("Open plugin manager dialog"),
    display_thinking: z.string().optional().default("none").describe("Toggle thinking blocks visibility"),
  })
  .strict()
  .meta({
    ref: "KeybindsConfig",
  })

import type { Config } from "./config"

export namespace Keymap {
  export const Names = ["default", "emacs", "vim"] as const
  export type Name = (typeof Names)[number]

  export type Preset = Partial<Config.Keybinds>

  /**
   * Default keymap - the baseline keybinds.
   * These are defined in the Keybinds schema defaults, so we return empty here.
   */
  const defaults: Preset = {}

  /**
   * Emacs keymap - emphasizes Emacs-style editing.
   * Most input bindings are already Emacs-like by default.
   * This preset adds more Emacs conventions and uses ctrl+x as leader.
   */
  const emacs: Preset = {
    leader: "ctrl+x",

    // Navigation - Emacs style
    messages_page_up: "alt+v,pageup",
    messages_page_down: "ctrl+v,pagedown",
    messages_first: "alt+shift+<,home",
    messages_last: "alt+shift+>,end",
    messages_line_up: "ctrl+p",
    messages_line_down: "ctrl+n",

    // Session management - C-x prefix
    session_new: "<leader>ctrl+f",
    session_list: "<leader>b",
    session_export: "<leader>ctrl+w",

    // Search/commands - M-x style
    command_list: "alt+x,ctrl+p",
    model_list: "<leader>m",
    agent_list: "<leader>a",

    // Undo/redo - Emacs style
    messages_undo: "<leader>u,ctrl+/",
    messages_redo: "<leader>r,ctrl+shift+/",

    // Input editing - reinforce Emacs defaults
    input_line_home: "ctrl+a",
    input_line_end: "ctrl+e",
    input_move_left: "ctrl+b,left",
    input_move_right: "ctrl+f,right",
    input_move_up: "ctrl+p,up",
    input_move_down: "ctrl+n,down",
    input_word_forward: "alt+f,alt+right",
    input_word_backward: "alt+b,alt+left",
    input_delete_to_line_end: "ctrl+k",
    input_delete_to_line_start: "ctrl+u",
    input_delete_word_backward: "alt+backspace,ctrl+w",
    input_delete_word_forward: "alt+d",
    input_undo: "ctrl+/,ctrl+_",
    input_redo: "ctrl+shift+/,ctrl+shift+_",

    // Cancel/quit
    session_interrupt: "ctrl+g,escape",
    input_clear: "ctrl+g",
  }

  /**
   * Vim keymap - vim-style navigation and leader key.
   * Uses space as leader for familiar vim experience.
   * Note: Full modal editing is not supported, but navigation feels vim-like.
   */
  const vim: Preset = {
    leader: "space",

    // App exit - vim style
    app_exit: "<leader>q,ctrl+c",

    // Navigation - vim style (hjkl with ctrl+alt to avoid conflicts)
    messages_line_up: "ctrl+alt+k",
    messages_line_down: "ctrl+alt+j",
    messages_half_page_up: "ctrl+u",
    messages_half_page_down: "ctrl+d",
    messages_page_up: "ctrl+b,pageup",
    messages_page_down: "ctrl+f,pagedown",
    messages_first: "ctrl+alt+g,home",
    messages_last: "shift+g,end",
    messages_next: "ctrl+alt+n",
    messages_previous: "ctrl+alt+p",

    // Session management - leader prefixed
    session_new: "<leader>n",
    session_list: "<leader>b",
    session_export: "<leader>w",
    session_timeline: "<leader>g",
    session_compact: "<leader>c",

    // Undo/redo - vim style
    messages_undo: "u,<leader>u",
    messages_redo: "ctrl+r,<leader>r",
    messages_copy: "y,<leader>y",

    // Search/commands - vim style
    command_list: "ctrl+p,<leader>:",
    model_list: "<leader>m",
    agent_list: "<leader>a",
    theme_list: "<leader>t",

    // Editor
    editor_open: "<leader>e",

    // Sidebar/UI
    sidebar_toggle: "<leader>b",
    status_view: "<leader>s",

    // Input - keep some vim flavor where possible
    input_submit: "return",
    input_newline: "shift+return,ctrl+return",
    input_clear: "escape",
    input_line_home: "ctrl+a,0",
    input_line_end: "ctrl+e,$",
    input_word_forward: "alt+f,w",
    input_word_backward: "alt+b,b",
    input_delete_word_backward: "ctrl+w",
    input_undo: "ctrl+/",
    input_redo: "ctrl+shift+/",

    // History navigation
    history_previous: "up,ctrl+p",
    history_next: "down,ctrl+n",

    // Session navigation
    session_child_cycle: "<leader>l",
    session_child_cycle_reverse: "<leader>h",
    session_parent: "<leader>k",

    // Interrupt
    session_interrupt: "escape,ctrl+c",
  }

  const presets: Record<Name, Preset> = {
    default: defaults,
    emacs,
    vim,
  }

  export function get(name: Name): Preset {
    return presets[name] ?? defaults
  }

  export function apply(keymap: Name, keybinds: Config.Keybinds): Config.Keybinds {
    const preset = get(keymap)
    // Preset values are defaults, user keybinds override
    return { ...preset, ...keybinds }
  }

  export function describe(name: Name): string {
    switch (name) {
      case "default":
        return "Default keybindings with ctrl+x leader"
      case "emacs":
        return "Emacs-style: M-x commands, C-x prefix, C-g cancel"
      case "vim":
        return "Vim-style: space leader, hjkl navigation, u/C-r undo/redo"
    }
  }

  export function hints(name: Name): string[] {
    switch (name) {
      case "default":
        return [
          "Leader: ctrl+x (press then release, then press next key)",
          "ctrl+p: command palette",
          "<leader>n: new session",
          "<leader>l: list sessions",
          "<leader>m: switch model",
        ]
      case "emacs":
        return [
          "Leader: C-x (Emacs prefix key)",
          "M-x (alt+x): command palette",
          "C-x b: list sessions (buffers)",
          "C-x C-f: new session (find-file)",
          "C-g: cancel/interrupt",
          "C-v / M-v: page down/up",
          "C-/ or C-_: undo",
        ]
      case "vim":
        return [
          "Leader: space",
          "<space>:: command palette",
          "<space>b: list sessions (buffers)",
          "<space>n: new session",
          "C-u / C-d: half-page up/down",
          "C-b / C-f: page up/down",
          "u / C-r: undo/redo",
          "G: go to end",
        ]
    }
  }
}

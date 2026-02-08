import type { ITerminalOptions } from "@xterm/xterm"

// Font stack prioritizing Nerd Fonts for shell theme compatibility
const TERMINAL_FONT_FAMILY = [
  "MesloLGM Nerd Font",
  "MesloLGS NF",
  "Hack Nerd Font",
  "FiraCode Nerd Font",
  "JetBrainsMono Nerd Font",
  "Menlo",
  "Monaco",
  "SF Mono",
  "monospace",
].join(", ")

export const TERMINAL_OPTIONS: ITerminalOptions = {
  cursorBlink: false,
  fontSize: 14,
  fontFamily: TERMINAL_FONT_FAMILY,
  allowProposedApi: true,
  scrollback: 10000,
  macOptionIsMeta: true,
  cursorStyle: "block",
  cursorInactiveStyle: "none",
  fastScrollModifier: "alt",
  fastScrollSensitivity: 5,
}

export const RESIZE_DEBOUNCE_MS = 150
export const FIRST_RENDER_RESTORE_FALLBACK_MS = 250

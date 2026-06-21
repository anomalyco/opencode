const isTTY = process.stdout.isTTY || process.stderr.isTTY
const noColor = Boolean(process.env.NO_COLOR)
const isWindows = process.platform === "win32"
const isModernTerminal = !isWindows || process.env.WT_SESSION || process.env.TERM_PROGRAM === "vscode"
const enabled = isTTY && !noColor && isModernTerminal

function esc(code: string): string {
  return enabled ? code : ""
}

export const Style = {
  TEXT_HIGHLIGHT: esc("\x1b[96m"),
  TEXT_HIGHLIGHT_BOLD: esc("\x1b[96m\x1b[1m"),
  TEXT_DIM: esc("\x1b[90m"),
  TEXT_DIM_BOLD: esc("\x1b[90m\x1b[1m"),
  TEXT_NORMAL: esc("\x1b[0m"),
  TEXT_NORMAL_BOLD: esc("\x1b[1m"),
  TEXT_WARNING: esc("\x1b[93m"),
  TEXT_WARNING_BOLD: esc("\x1b[93m\x1b[1m"),
  TEXT_DANGER: esc("\x1b[91m"),
  TEXT_DANGER_BOLD: esc("\x1b[91m\x1b[1m"),
  TEXT_SUCCESS: esc("\x1b[92m"),
  TEXT_SUCCESS_BOLD: esc("\x1b[92m\x1b[1m"),
  TEXT_INFO: esc("\x1b[94m"),
  TEXT_INFO_BOLD: esc("\x1b[94m\x1b[1m"),
  ITALIC: esc("\x1b[3m"),
  BOLD: esc("\x1b[1m"),
  RESET: esc("\x1b[0m"),
}

export type StyleName = keyof typeof Style

export function stylize(text: string, ...names: StyleName[]): string {
  const open = names.map((n) => Style[n]).join("")
  return open + text + Style.RESET
}

export const LogoColor = {
  LEFT_FG: esc("\x1b[90m"),
  LEFT_SHADOW: esc("\x1b[38;5;235m"),
  LEFT_BG: esc("\x1b[48;5;235m"),
  RIGHT_FG: esc(""),
  RIGHT_SHADOW: esc("\x1b[38;5;238m"),
  RIGHT_BG: esc("\x1b[48;5;238m"),
  RESET: esc("\x1b[0m"),
}

export function osc52(text: string): string | undefined {
  if (!enabled) return undefined
  const sequence = `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`
  return process.env.TMUX || process.env.STY ? `\x1bPtmux;\x1b${sequence}\x1b\\` : sequence
}

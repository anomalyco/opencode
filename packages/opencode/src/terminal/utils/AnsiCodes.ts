export const AnsiCodes = {
  STARTUP: [
    "\x1b[?1049h",
    "\x1b[?25l",
    "\x1b[?1000h",
    "\x1b[?1006h",
    "\x1b[?1002h",
    "\x1b[?2004h",
    "\x1b[?1004h",
    "\x1b[?2026h",
    "\x1b[2J",
    "\x1b[H",
  ].join(""),

  SHUTDOWN: [
    "\x1b[?2026l",
    "\x1b[?1004l",
    "\x1b[?2004l",
    "\x1b[?1002l",
    "\x1b[?1006l",
    "\x1b[?1000l",
    "\x1b[0m",
    "\x1b[?25h",
    "\x1b[?1049l",
  ].join(""),

  clearScreen:    "\x1b[2J\x1b[H",
  cursorHome:     "\x1b[H",
  cursorPos:      (row: number, col: number) => `\x1b[${row + 1};${col + 1}H`,
  hideCursor:     "\x1b[?25l",
  showCursor:     "\x1b[?25h",
  reset:          "\x1b[0m",

  sgr:            (...codes: number[]) => `\x1b[${codes.join(";")}m`,
  sgr256fg:       (n: number) => `\x1b[38;5;${n}m`,
  sgr256bg:       (n: number) => `\x1b[48;5;${n}m`,
  sgrTruecolorFg: (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`,
  sgrTruecolorBg: (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`,
} as const

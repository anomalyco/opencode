import type { CliRenderer } from "@opentui/core"

// opentui's own teardown leaves several terminal modes enabled (mouse
// reporting, application cursor keys, kitty keyboard, bracketed paste),
// which corrupts the shell session after the TUI exits. See issues
// #48776 and #38860.
const TERMINAL_RESET =
  "\x1b[?1l\x1b[?25h\x1b[0 q\x1b[>1u\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[0m"

export function terminalReset() {
  if (!process.stdout.isTTY) return
  process.stdout.write(TERMINAL_RESET)
}

export function destroyRenderer(renderer: Pick<CliRenderer, "isDestroyed" | "setTerminalTitle" | "destroy">) {
  renderer.setTerminalTitle("")
  if (renderer.isDestroyed) return
  renderer.destroy()
  terminalReset()
}

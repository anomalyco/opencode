import type { CliRenderer } from "@opentui/core"

export const TERMINAL_MODE_RESETS = [
  { name: "basicMouseTracking", sequence: "\x1b[?1000l" },
  { name: "mouseButtonEventTracking", sequence: "\x1b[?1002l" },
  { name: "mouseAnyEventTracking", sequence: "\x1b[?1003l" },
  { name: "utf8MouseMode", sequence: "\x1b[?1005l" },
  { name: "sgrMouseMode", sequence: "\x1b[?1006l" },
  { name: "urxvtMouseMode", sequence: "\x1b[?1015l" },
  { name: "focusEventTracking", sequence: "\x1b[?1004l" },
  { name: "bracketedPaste", sequence: "\x1b[?2004l" },
  { name: "alternateScreen", sequence: "\x1b[?1049l" },
] as const

export const TERMINAL_MODE_RESET_SEQUENCE = TERMINAL_MODE_RESETS.map((mode) => mode.sequence).join("")

type TerminalCleanupWriter = {
  write(data: string): unknown
}

function resetTerminalModes(writer: TerminalCleanupWriter) {
  try {
    writer.write(TERMINAL_MODE_RESET_SEQUENCE)
  } catch {
    // Do not let a failed best-effort terminal reset block renderer teardown.
  }
}

export function destroyRenderer(
  renderer: Pick<CliRenderer, "isDestroyed" | "setTerminalTitle" | "destroy">,
  writer: TerminalCleanupWriter = process.stdout,
) {
  renderer.setTerminalTitle("")
  resetTerminalModes(writer)
  if (renderer.isDestroyed) return
  renderer.destroy()
  resetTerminalModes(writer)
}

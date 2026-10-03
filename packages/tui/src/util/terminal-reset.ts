/**
 * Defensive terminal reset sequence.
 *
 * OpenTUI enables several terminal private modes (mouse tracking, focus events,
 * bracketed paste, alternate screen, hidden cursor). In the legacy CLI host the
 * TUI runs inside a Worker and the host calls `process.exit()` immediately after
 * teardown, so OpenTUI's own reset bytes may not reach the terminal before the
 * process exits. This helper emits the same reset sequences from the host
 * process as a safety net.
 *
 * The sequences are written in the reverse order of typical enables so that
 * mouse reporting is disabled before leaving the alternate screen.
 */

const DISABLE_SGR_MOUSE = "\x1b[?1006l"
const DISABLE_BUTTON_EVENT_MOUSE = "\x1b[?1002l"
const DISABLE_X11_MOUSE = "\x1b[?1000l"
const DISABLE_FOCUS_EVENTS = "\x1b[?1004l"
const DISABLE_BRACKETED_PASTE = "\x1b[?2004l"
const EXIT_ALTERNATE_SCREEN = "\x1b[?1049l"
const SHOW_CURSOR = "\x1b[?25h"

export const RESET_TERMINAL_SEQUENCE = [
  DISABLE_SGR_MOUSE,
  DISABLE_BUTTON_EVENT_MOUSE,
  DISABLE_X11_MOUSE,
  DISABLE_FOCUS_EVENTS,
  DISABLE_BRACKETED_PASTE,
  EXIT_ALTERNATE_SCREEN,
  SHOW_CURSOR,
].join("")

export function resetTerminal(output: NodeJS.WritableStream = process.stdout) {
  output.write(RESET_TERMINAL_SEQUENCE)
}

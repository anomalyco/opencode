import type { CliRenderer } from "@opentui/core"
import * as fs from "node:fs"

// Escape sequences written synchronously on exit so the terminal is left in a
// clean state even on ConPTY stacks (e.g. Alacritty + zellij) where raw-mode
// modes can otherwise leak (opencode #45938 / #48776).
//
// Note: we intentionally do NOT emit `\x1b[?1049l`. Leaving the alternate
// screen buffer on Windows ConPTY races with process teardown and terminates
// the parent shell / zellij pane, so we clear the screen instead.
const TERMINAL_RESET = [
  "\x1b[0m",
  "\x1b[?25h",
  "\x1b[?1l",
  "\x1b[?1000l",
  "\x1b[?1002l",
  "\x1b[?1003l",
  "\x1b[?1004l",
  "\x1b[?1005l",
  "\x1b[?1006l",
  "\x1b[?1015l",
  "\x1b[?2026l",
  "\x1b[?9001l",
  "\x1b[?2004l",
  "\x1b[<u",
  "\x1b[2J",
  "\x1b[H",
].join("")

function stdoutIsTty(): boolean {
  try {
    return typeof process.stdout.write === "function" && process.stdout.isTTY
  } catch {
    return false
  }
}

export function terminalReset(): void {
  if (!stdoutIsTty()) return
  try {
    fs.writeSync(1, Buffer.from(TERMINAL_RESET, "utf8"))
  } catch {
    // best-effort teardown; never let the reset throw across exit paths
  }
}

export function destroyRenderer(renderer: Pick<CliRenderer, "isDestroyed" | "setTerminalTitle" | "destroy">) {
  renderer.setTerminalTitle("")
  if (renderer.isDestroyed) return
  // On Windows, @opentui's native renderer teardown leaves the shared console
  // (ConPTY) in a state that terminates the parent shell / zellij pane. The OS
  // releases the native handle when the process exits, so skip that call and
  // let `terminalReset()` clear the screen and restore the terminal state.
  if (process.platform === "win32") {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- @opentui/core does not expose lib on CliRenderer's public type.
    const native = (renderer as Record<string, unknown>).lib
    if (native && typeof native === "object") {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Only destroyRenderer is touched, guarded by typeof below.
      const opts = native as Record<string, unknown>
      if (typeof opts.destroyRenderer === "function") {
        try {
          opts.destroyRenderer = () => {}
        } catch {}
      }
    }
  }
  renderer.destroy()
  terminalReset()
}

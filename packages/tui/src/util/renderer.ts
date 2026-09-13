import type { CliRenderer } from "@opentui/core"
import * as fs from "node:fs"

// Written synchronously so it can also run from `process.on("exit")`, where
// async renderer teardown is not guaranteed to have flushed before exit.
// Prevents ConPTY stacks (e.g. Alacritty + zellij) being left with leaked
// raw-mode escape sequences (opencode #45938 / #48776).
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
].join("")

// On Windows ConPTY, emitting `\x1b[?1049l` (leaving the alternate screen buffer)
// races with process teardown and terminates the parent shell — e.g. it killed
// the zellij pane that launched opencode. There we clear the screen instead.
// Everywhere else we leave the alternate screen as before.
const RESET_ON_EXIT =
  process.platform === "win32" ? TERMINAL_RESET + "\x1b[2J\x1b[H" : TERMINAL_RESET + "\x1b[?1049l"

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
    fs.writeSync(1, Buffer.from(RESET_ON_EXIT, "utf8"))
  } catch {
    // best-effort teardown; never let the reset throw across exit paths
  }
}

export function destroyRenderer(renderer: Pick<CliRenderer, "isDestroyed" | "setTerminalTitle" | "destroy">) {
  renderer.setTerminalTitle("")
  if (renderer.isDestroyed) return
  // On Windows, @opentui's native renderer teardown closes the shared console
  // (ConPTY) and terminates the parent shell. The OS releases the native handle
  // when the process exits, so skip that call and let `terminalReset()` clean up.
  if (process.platform === "win32") {
    const lib = (renderer as unknown as { lib?: { destroyRenderer?: (...args: unknown[]) => unknown } }).lib
    if (lib && typeof lib.destroyRenderer === "function") {
      try {
        lib.destroyRenderer = () => {}
      } catch {}
    }
  }
  renderer.destroy()
  terminalReset()
}

import type { KittyKeyboardOptions } from "@opentui/core"
import { release } from "node:os"

// Terminals can advertise the Kitty keyboard protocol (they answer `CSI ? u`)
// without honoring the flags pushed with `CSI > N u`, which leaves Shift+Enter
// indistinguishable from a plain Return and submits the prompt. Passing an
// explicit zero-flag config stops OpenTUI from enabling the protocol, so the
// renderer keeps the modifyOtherKeys fallback that reports Shift+Enter.
export function kittyKeyboardOptions(input: { disabled: boolean; events?: boolean }): KittyKeyboardOptions {
  if (input.disabled) return { disambiguate: false, alternateKeys: false }
  return input.events ? { events: true } : {}
}

export function describeOS() {
  const name =
    process.platform === "darwin"
      ? "macOS"
      : process.platform === "win32"
        ? "Windows"
        : process.platform === "linux"
          ? "Linux"
          : process.platform
  return `${name} ${release()} (${process.arch})`
}

export function describeTerminal() {
  const program = process.env.TERM_PROGRAM || process.env.TERM || "unknown"
  const version = process.env.TERM_PROGRAM_VERSION ? ` ${process.env.TERM_PROGRAM_VERSION}` : ""
  const multiplexer = process.env.TMUX ? " in tmux" : process.env.STY ? " in screen" : ""
  return `${program}${version}${multiplexer}`
}

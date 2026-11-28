import { spawnSync } from "node:child_process"

/**
 * Whether a raw ^H (0x08) means Ctrl+Backspace. Without an extended keyboard protocol, most terminals send ^H for
 * Ctrl+Backspace and DEL for Backspace. Some send ^H for plain Backspace instead: herdr, and setups whose terminal
 * erase character (VERASE) is ^H, such as `stty erase ^H` or PuTTY configured that way, which passes it to the remote
 * pty. Windows has no termios, so there only Windows Terminal counts.
 */
export function fromControlH(
  input: {
    environment?: Record<string, string | undefined>
    platform?: NodeJS.Platform
    erase?: () => string | undefined
  } = {},
) {
  const environment = input.environment ?? process.env
  const platform = input.platform ?? process.platform
  if (environment.HERDR_ENV === "1") return false
  if (platform === "win32") return environment.WT_SESSION !== undefined
  return (input.erase ?? terminalErase)() !== "^H"
}

/** The terminal's erase character as `stty -a` prints it, such as `^?`, or undefined when there is no terminal. */
export function terminalErase() {
  return parseErase(spawnSync("sh", ["-c", "stty -a </dev/tty"], { encoding: "utf8", timeout: 1000 }).stdout ?? "")
}

/** The erase character in `stty -a` output, which differs in layout between Linux and BSD/macOS. */
export function parseErase(output: string) {
  return output.match(/\berase = ([^;\s]+)/)?.[1]
}

export * as CtrlBackspace from "./ctrl-backspace"

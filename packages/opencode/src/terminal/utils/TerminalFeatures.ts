export interface TerminalCapabilities {
  truecolor:          boolean
  color256:           boolean
  synchronizedOutput: boolean
  mouseTracking:      boolean
  bracketedPaste:     boolean
  altScreen:          boolean
  isWindowsTerminal:  boolean
  isLegacyConHost:    boolean
}

export function detectCapabilities(): TerminalCapabilities {
  const env = process.env

  const isWindowsTerminal = env["WT_SESSION"] !== undefined
  const isLegacyConHost = process.platform === "win32" && !isWindowsTerminal && env["TERM_PROGRAM"] === undefined

  const truecolor =
    env["COLORTERM"] === "truecolor" ||
    env["COLORTERM"] === "24bit" ||
    isWindowsTerminal

  const color256 = truecolor || (env["TERM"] ?? "").includes("256color")

  const inTmux = env["TMUX"] !== undefined
  const synchronizedOutput = !inTmux && (isWindowsTerminal || env["TERM"] === "xterm-kitty")

  if (env["NO_COLOR"] !== undefined) {
    return {
      truecolor: false,
      color256: false,
      synchronizedOutput: false,
      mouseTracking: true,
      bracketedPaste: true,
      altScreen: true,
      isWindowsTerminal,
      isLegacyConHost,
    }
  }

  return {
    truecolor,
    color256,
    synchronizedOutput,
    mouseTracking: !isLegacyConHost,
    bracketedPaste: !isLegacyConHost,
    altScreen: !isLegacyConHost,
    isWindowsTerminal,
    isLegacyConHost,
  }
}

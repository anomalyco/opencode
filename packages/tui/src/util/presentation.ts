const logo = {
  left: [
    " /$$$$$$$   /$$$$$$  /$$   /$$$$$$$$",
    "| $$__  $$ /$$__  $$| $$  |__  $$__/",
    "| $$  \\ $$| $$  \\ $$| $$     | $$   ",
    "| $$$$$$$ | $$  | $$| $$     | $$   ",
    "| $$__  $$| $$  | $$| $$     | $$   ",
    "| $$  \\ $$| $$  | $$| $$     | $$   ",
    "| $$$$$$$/|  $$$$$$/| $$$$$$$| $$   ",
    "|_______/  \\______/ |________|__/   ",
  ],
  right: [
    "  /$$$$$$  /$$       /$$$$$$ ",
    " /$$__  $$| $$      |_  $$_/ ",
    "| $$  \\__/| $$        | $$   ",
    "| $$      | $$        | $$   ",
    "| $$      | $$        | $$   ",
    "| $$    $$| $$        | $$   ",
    "|  $$$$$$/| $$$$$$$$ /$$$$$$ ",
    " \\______/ |________/|______/ ",
  ],
}
const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

function wordmark(pad = "") {
  const draw = (line: string, fg: string, shadow: string, bg: string) =>
    [...line]
      .map((char) => {
        if (char === "_") return `${bg} ${reset}`
        if (char === "^") return `${fg}${bg}▀${reset}`
        if (char === "~") return `${shadow}▀${reset}`
        if (char === " ") return " "
        return `${fg}${char}${reset}`
      })
      .join("")

  return logo.left.map((line, index) => {
    const left = draw(line, dim, "\x1b[38;5;235m", "\x1b[48;5;235m")
    const right = draw(logo.right[index] ?? "", reset, "\x1b[38;5;238m", "\x1b[48;5;238m")
    return `${pad}${left} ${right}`
  })
}

export type SessionEpilogue = { readonly title: string; readonly sessionID?: string }

// Printed after the TUI closes.
export function epilogue(input: { readonly session?: SessionEpilogue; readonly updatedVersion?: string }) {
  if (!input.session && !input.updatedVersion) return
  const row = (label: string, value: string) => `  ${dim}${label.padEnd(10, " ")}${reset}${bold}${value}${reset}`
  return [
    ...wordmark("  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}\x1b[34mbolt${reset} -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}

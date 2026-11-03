import { logo } from "../logo"

import { createLanguage } from "../i18n/translate"
import { stringWidth } from "./string-width"

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
export function epilogue(
  input: { readonly session?: SessionEpilogue; readonly updatedVersion?: string },
  t = createLanguage(() => "en").t,
) {
  if (!input.session && !input.updatedVersion) return
  const session = t("command.category.session")
  const resume = t("tui.session.continue")
  const width = Math.max(10, stringWidth(session) + 2, stringWidth(resume) + 2)
  const row = (label: string, value: string) =>
    `  ${dim}${label}${" ".repeat(width - stringWidth(label))}${reset}${bold}${value}${reset}`
  return [
    ...wordmark("  "),
    "",
    ...(input.updatedVersion
      ? [
          `  ${dim}${t("tui.runVersion", { command: `${reset}${bold}opencode${reset}${dim}`, version: `${reset}${bold}${input.updatedVersion}${reset}` })}${reset}`,
          "",
        ]
      : []),
    ...(input.session
      ? [row(session, input.session.title), row(resume, `opencode -s ${input.session.sessionID}`), ""]
      : []),
  ].join("\n")
}

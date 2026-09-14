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

export function sessionEpilogue(input: { title: string; sessionID?: string }, t = createLanguage(() => "en").t) {
  const session = t("command.category.session")
  const resume = t("tui.session.continue")
  const width = Math.max(8, stringWidth(session), stringWidth(resume)) + 2
  const weak = (text: string) => `${dim}${text}${" ".repeat(width - stringWidth(text))}${reset}`
  return [
    ...wordmark("  "),
    "",
    `  ${weak(session)}${bold}${input.title}${reset}`,
    `  ${weak(resume)}${bold}opencode -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}

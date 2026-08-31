import { logo } from "../logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

function wordmark(pad = "") {
  // Outside the renderer the terminal background is unknown. Keep only the letter faces.
  const draw = (line: string) => line.replace(/[_~,]/g, " ").replace(/\^/g, "▀")

  return logo.left.map((line, index) => {
    return `${reset}${pad}${draw(line)} ${draw(logo.right[index] ?? "")}`
  })
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...wordmark("  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}opencode2 -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"
const cyan = "\x1b[36m"

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    "",
    `  ${cyan}✦${reset} ${bold}Ziq-code${reset}`,
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}ziq-code -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}

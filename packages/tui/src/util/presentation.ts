const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(12, " ")}${reset}`
  return [
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}kancode -c${reset}`,
    ...(input.sessionID ? [`  ${weak("Session ID")}${bold}kancode -s ${input.sessionID}${reset}`] : []),
    "",
  ].join("\n")
}

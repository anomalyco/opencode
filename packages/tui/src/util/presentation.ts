import { wordmarkGradient } from "../logo"

const logo = {
  left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],
  right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
}

const wordmark_logo = ["███    ███", "████  ████", "██ ████ ██", "██  ██  ██", "██      ██"]

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

function wordmark(mode: "dark" | "light", pad = "") {
  return wordmark_logo.map((line, index) => {
    const hex = wordmarkGradient[mode][index] ?? wordmarkGradient[mode][wordmarkGradient[mode].length - 1]
    const color = hex
      .slice(1)
      .match(/.{2}/g)!
      .map((value) => Number.parseInt(value, 16))
    return `${pad}\x1b[38;2;${color.join(";")}m${line}${reset}`
  })
}

export function sessionEpilogue(input: { title: string; sessionID?: string; mode: "dark" | "light" }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...wordmark(input.mode, "  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}mammouth -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}

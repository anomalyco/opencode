// 校园 Harness: 字画与校训统一取自 ../logo（内部按 BRAND 选择 muc/hubu），消灭重复硬编码
import { logo, logoMotto, logoSchool } from "../logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

// 校园 harness: 会话尾声用品牌色校名 + 金色校训（muc 民大红金 / hubu 深绿青铜）
import { resolveBrand } from "@opencode-ai/brand"
const isHubu = resolveBrand().id === "hubu"
const mucRed = isHubu ? "\x1b[38;2;46;144;112m" : "\x1b[38;2;206;58;63m"
const mucGold = isHubu ? "\x1b[38;2;188;157;83m" : "\x1b[38;2;217;169;78m"

function wordmark(pad = "") {
  const draw = (line: string, fg: string) =>
    [...line]
      .map((char) => {
        if (char === " ") return " "
        return `${fg}${char}${reset}`
      })
      .join("")

  return logo.left.map((line, index) => {
    const left = draw(line, mucRed)
    const right = draw(logo.right[index] ?? "", mucRed)
    return `${pad}${left} ${right}`
  })
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...wordmark("  "),
    "",
    `  ${mucGold}${logoMotto}${reset}`,
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}opencode -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}

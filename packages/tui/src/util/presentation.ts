const logo = {
  left: [
    "      ▄█              █▄        ▄▄▄▄▄▄▄▄▄▄▄▄",
    " ▄▄▄▄▄██▄▄▄▄▄▄   ▓██████████    ██▀▓▓▓▓▓▓▓██",
    " ██▀▀▀██▀▀▀▀██   ▓█   ██  ██    ████████████",
    " ██   ██    ██  ▓▄█▄▓▄██▓▓██▓   ██▄▄▄▄██▄▄▄▄▓",
    " █████████████  ▀▀▀▀▀████▀▀▀▀▓  ██▀▀▀▀▀██▀▀▀▀",
    " ▀▓   ██    ▀▓     ▄█▀ ▀█▄▄     ██   ▓ ▀█▄ ▓▄",
    "      ██        ▄██▀▓    ▀██▄▄  █████▀  ▀████",
    "      ▓▀        ▓▓          ▀              ▓",
  ],
  right: [
    "  ▄▄   ▄▄             █▄         ▄▄ ▓█▄  ▄█▓",
    "▓█████▄███████        ██       ▓▄▄██▄██▄▄██▄▄",
    " ▓█▄▓▓█▀██▄▄▄▄  ██████████████ ██▀▀▀▀▀▀▀▀▀▀██",
    " ▓█▀██ ██▀█▀▀▓       ███▄      ▀▀ ▀▀▀▀▀███▓▀▀",
    " ▓█▓▄█▄███████▓     ▄█▓▀█▄     ▓▄▄▄▄▄▄██▄▄▄▄▄",
    " ██ ██  ▄███▓     ▄██▓  ▓██▄   ▓▀▀▀▀▀▀█▀▀▀▀▀▀",
    "▄█▀▄██▓▄█▀ ▀█▄▓ ▄██▀      ▀██▄     ▄▄▄█▓",
    " ▓ ▀▀  ▀     ▀  ▀▓          ▓      ▓▀▀▓",
  ],
}

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

// MUC harness: 会话尾声用民大红校名 + 金色校训
const mucRed = "\x1b[38;2;206;58;63m"
const mucGold = "\x1b[38;2;217;169;78m"

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
    `  ${mucGold}美美与共 · 知行合一${reset}`,
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}opencode -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}

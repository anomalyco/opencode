export * as ShellRootDelete from "./root-delete.js"

// cmd /c, ssh and `-c` shells join the words after them into one command line, so a quoting mistake in one word can
// split off an operand nobody wrote, as `cmd /c "rmdir /s /q \"$p\""` does in PowerShell: the string ends at `\"`,
// and rmdir receives `\` (the drive root) before the intended path.
const MAX_DEPTH = 3

/**
 * The operand that makes `words` recursively delete a whole drive (`\`, `/`, `C:\`, also with `*`), looking through
 * commands run by cmd /c, ssh, PowerShell -Command and `-c` shells. Undefined when there is none.
 */
export function find(words: readonly string[], depth = 0): string | undefined {
  const name = program(words[0] ?? "")
  const args = words.slice(1)
  const inner = nested(name, args)
  if (inner !== undefined)
    return depth < MAX_DEPTH
      ? commands(inner)
          .map((command) => find(command, depth + 1))
          .find((operand) => operand !== undefined)
      : undefined
  return operands(name, args)?.find((operand) => /^(?:[A-Za-z]:)?[\\/]+\*?$/.test(operand))
}

function program(word: string) {
  return (word.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.exe$/, "")
}

// The command line a wrapper runs, joined the way the wrapper joins it.
function nested(name: string, args: readonly string[]) {
  if (name === "cmd") {
    const index = args.findIndex((arg) => /^\/[ck]$/i.test(arg))
    return index < 0 ? undefined : args.slice(index + 1).join(" ")
  }
  if (name === "powershell" || name === "pwsh") {
    const index = args.findIndex((arg) => /^-(?:c|command)$/i.test(arg))
    return index < 0 ? undefined : args.slice(index + 1).join(" ")
  }
  if (name === "bash" || name === "sh" || name === "zsh" || name === "dash") {
    const index = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg))
    return index < 0 ? undefined : args[index + 1]
  }
  if (name === "ssh") {
    // Options of OpenSSH's ssh that take a value; the first other word is the host, and the rest the remote command.
    const host = args.findIndex(
      (arg, index) => !arg.startsWith("-") && !/^-[BbcDEeFIiJLlmOopQRSWw]$/.test(args[index - 1] ?? ""),
    )
    return host < 0 || host === args.length - 1 ? undefined : args.slice(host + 1).join(" ")
  }
  return undefined
}

// What a recursive delete removes; undefined when the command is not one.
function operands(name: string, args: readonly string[]) {
  const recurse = (arg: string) => /^-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?(?::\$true)?$/i.test(arg)
  const cmdFlag = (arg: string) => /^\/[a-z?]/i.test(arg)
  if (name === "rd" || name === "rmdir" || name === "del" || name === "erase")
    return args.some((arg) => /^\/s$/i.test(arg) || recurse(arg))
      ? args.filter((arg) => !cmdFlag(arg) && !arg.startsWith("-"))
      : undefined
  if (name === "rm")
    return args.some((arg) => arg === "--recursive" || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(arg) || recurse(arg))
      ? positional(args)
      : undefined
  if (name === "remove-item" || name === "ri") return args.some(recurse) ? positional(args) : undefined
  // Mirroring or purging into a drive deletes everything on it that the source lacks.
  if (name === "robocopy")
    return args.some((arg) => /^\/(?:mir|purge)$/i.test(arg))
      ? args.filter((arg) => !cmdFlag(arg)).slice(1, 2)
      : undefined
  return undefined
}

function positional(args: readonly string[]) {
  const end = args.indexOf("--")
  return end < 0
    ? args.filter((arg) => !arg.startsWith("-"))
    : [...args.slice(0, end).filter((arg) => !arg.startsWith("-")), ...args.slice(end + 1)]
}

// Splits a joined command line into the words of each command, at unquoted `&`, `|`, `;` and newlines.
function commands(line: string) {
  const result: string[][] = [[]]
  let word: string | undefined
  let quote: string | undefined
  const end = () => {
    if (word !== undefined) result[result.length - 1].push(word)
    word = undefined
  }
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = undefined
      else word += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      word ??= ""
      continue
    }
    if (/\s/.test(char) && char !== "\n") {
      end()
      continue
    }
    if (/[&|;\n]/.test(char)) {
      end()
      if (result[result.length - 1].length > 0) result.push([])
      continue
    }
    word = (word ?? "") + char
  }
  end()
  return result.filter((command) => command.length > 0)
}

export * as ShellScan from "./index.js"

export type OpaqueReason =
  | "command-substitution"
  | "compound-command"
  | "command-wrapper"
  | "dynamic-command-name"
  | "dynamic-directory"
  | "dynamic-execution"
  | "heredoc"
  | "invalid-redirect"
  | "invalid-structure"
  | "shell-evaluation"
  | "unterminated-escape"
  | "unterminated-quote"

export type Result =
  | { kind: "scanned"; commands: Array<{ resource: string; words: string[] }> }
  | { kind: "opaque"; reason: OpaqueReason }

const BASH_WRAPPERS = new Set([
  "-",
  "time",
  "command",
  "builtin",
  "exec",
  "env",
  "sudo",
  "nice",
  "nohup",
  "xargs",
  "source",
  ".",
  "trap",
  "noglob",
  "nocorrect",
  "repeat",
])
const BASH_SHELLS = new Set(["bash", "sh", "dash", "zsh", "ksh"])
const BASH_DYNAMIC_BUILTINS = new Set([
  "alias",
  "emulate",
  "enable",
  "fc",
  "hash",
  "let",
  "mapfile",
  "read",
  "readarray",
  "shopt",
  "unalias",
  "unset",
])
const BASH_COMPOUND_KEYWORDS = new Set([
  "if",
  "then",
  "elif",
  "else",
  "fi",
  "for",
  "while",
  "until",
  "case",
  "select",
  "function",
  "do",
  "done",
  "coproc",
])
const POWERSHELL_LOCATIONS = new Set(["set-location", "cd", "chdir", "sl", "push-location"])
const POWERSHELL_SHELLS = new Set(["powershell", "powershell.exe", "pwsh", "pwsh.exe"])
const POWERSHELL_DYNAMIC_COMMANDS = new Set([
  "add-pssnapin",
  "add-type",
  "cmd",
  "cmd.exe",
  "cscript",
  "cscript.exe",
  "enter-pssession",
  "foreach-object",
  "iex",
  "import-alias",
  "import-module",
  "import-pssession",
  "invoke-history",
  "invoke-command",
  "invoke-expression",
  "invoke-item",
  "measure-command",
  "new-alias",
  "new-module",
  "register-objectevent",
  "register-engineevent",
  "remove-alias",
  "remove-module",
  "remove-pssnapin",
  "set-alias",
  "start-job",
  "start-process",
  "start-threadjob",
  "set-psbreakpoint",
  "trace-command",
  "where-object",
  "wscript",
  "wscript.exe",
])
const POWERSHELL_ALIASES: Record<string, string> = {
  "%": "foreach-object",
  "?": "where-object",
  ac: "add-content",
  asnp: "add-pssnapin",
  cli: "clear-item",
  clc: "clear-content",
  copy: "copy-item",
  cp: "copy-item",
  cpi: "copy-item",
  del: "remove-item",
  erase: "remove-item",
  etsn: "enter-pssession",
  foreach: "foreach-object",
  icm: "invoke-command",
  ihy: "invoke-history",
  ii: "invoke-item",
  ipal: "import-alias",
  ipmo: "import-module",
  ipsn: "import-pssession",
  mi: "move-item",
  move: "move-item",
  mv: "move-item",
  nal: "new-alias",
  ni: "new-item",
  nmo: "new-module",
  r: "invoke-history",
  rd: "remove-item",
  ren: "rename-item",
  ri: "remove-item",
  rm: "remove-item",
  rmdir: "remove-item",
  rni: "rename-item",
  rmo: "remove-module",
  rsnp: "remove-pssnapin",
  sajb: "start-job",
  sal: "set-alias",
  saps: "start-process",
  sbp: "set-psbreakpoint",
  sc: "set-content",
  si: "set-item",
  start: "start-process",
  pushd: "push-location",
  trcm: "trace-command",
  where: "where-object",
}
const MAX_BASH_INPUT_LENGTH = 64 * 1024
const MAX_SUBSTITUTION_DEPTH = 32

export function scan(input: string): Result {
  return scanBash(input, 0)
}

function scanBash(input: string, depth: number): Result {
  if (input.length > MAX_BASH_INPUT_LENGTH) return { kind: "opaque", reason: "invalid-structure" }
  const commands: Array<{ resource: string; words: string[] }> = []
  const nestedCommands: Array<{ resource: string; words: string[] }> = []
  const words: string[] = []
  const unsafeWords: boolean[] = []
  const assignmentWords: boolean[] = []
  let word = ""
  let wordStarted = false
  let unsafeWord = false
  let assignmentWord = false
  let segment = 0
  let quote: "single" | "double" | undefined
  let dynamicWord = false
  let compound = false
  let invalidRedirect = false
  let invalidStructure = false
  let separated = false
  let comment: number | undefined
  let heredoc = false
  let redirectTarget = false
  let hasRedirect = false
  let dynamicAssignment = false

  const finishWord = () => {
    if (!wordStarted) return
    if (!redirectTarget) {
      words.push(word)
      unsafeWords.push(unsafeWord)
      assignmentWords.push(assignmentWord)
    }
    redirectTarget = false
    word = ""
    wordStarted = false
    unsafeWord = false
    assignmentWord = false
  }
  const finishCommand = (end: number, boundary = false) => {
    finishWord()
    const resource = input.slice(segment, end).trim()
    const name = assignmentWords.findIndex((assignment) => !assignment)
    if (
      assignmentWords.some(
        (assignment, index) =>
          assignment &&
          /^(?:PATH|path|CDPATH|cdpath|FPATH|fpath|ENV|BASH_ENV|SHELLOPTS|PS4|PROMPT4|LD_[A-Z0-9_]+|DYLD_[A-Z0-9_]+|GIT_[A-Z_]*COMMAND)\+?=/.test(
            words[index] ?? "",
          ),
      )
    )
      dynamicAssignment = true
    if (name >= 0 && (unsafeWords[name] || /[*?[]/.test(words[name]))) compound = true
    if (resource && name >= 0)
      commands.push({
        resource,
        words: words.slice(name),
      })
    else if (hasRedirect || boundary || separated) invalidStructure = true
    words.length = 0
    unsafeWords.length = 0
    assignmentWords.length = 0
    separated = true
    hasRedirect = false
  }

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (quote === "single") {
      wordStarted = true
      unsafeWord = true
      if (char === "'") quote = undefined
      else word += char
      continue
    }
    if (quote === "double") {
      wordStarted = true
      unsafeWord = true
      if (char === '"') quote = undefined
      else if (char === "\\" && index + 1 < input.length) word += input[++index]
      else if ((char === "$" && input[index + 1] === "(") || char === "`") {
        const substitution = bashSubstitution(input, index)
        if (!substitution || depth >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "command-substitution" }
        const result = scanBash(substitution.source, depth + 1)
        if (result.kind === "opaque") return result
        nestedCommands.push(...result.commands)
        word += input.slice(index, substitution.end + 1)
        index = substitution.end
      } else {
        if (char === "$" && /^\$\{[^}:@]+@P\}/.test(input.slice(index)))
          return { kind: "opaque", reason: "dynamic-execution" }
        if (char === "$" && /^\$\{\([^)]*e[^)]*\)/.test(input.slice(index)))
          return { kind: "opaque", reason: "dynamic-execution" }
        if (char === "$") dynamicWord = true
        word += char
      }
      continue
    }
    if (char === "'") {
      quote = "single"
      wordStarted = true
      unsafeWord = true
      continue
    }
    if (char === '"') {
      quote = "double"
      wordStarted = true
      unsafeWord = true
      continue
    }
    if (char === "\\") {
      if (index + 1 >= input.length) return { kind: "opaque", reason: "unterminated-escape" }
      wordStarted = true
      unsafeWord = true
      if (input[index + 1] === "\n") index++
      else word += input[++index]
      continue
    }
    if ((char === "$" && input[index + 1] === "(") || char === "`") {
      const substitution = bashSubstitution(input, index)
      if (!substitution || depth >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "command-substitution" }
      const result = scanBash(substitution.source, depth + 1)
      if (result.kind === "opaque") return result
      nestedCommands.push(...result.commands)
      wordStarted = true
      unsafeWord = true
      word += input.slice(index, substitution.end + 1)
      index = substitution.end
      continue
    }
    if (char === "$" && input[index + 1] === "{" && /^\$\{[^}:@]+@P\}/.test(input.slice(index)))
      return { kind: "opaque", reason: "dynamic-execution" }
    if (char === "$" && /^\$\{\([^)]*e[^)]*\)/.test(input.slice(index)))
      return { kind: "opaque", reason: "dynamic-execution" }
    if (char === "$" && input[index + 1] === "[") return { kind: "opaque", reason: "dynamic-execution" }
    if (char === "<" && input[index + 1] === "<") heredoc = true
    if (char === "#" && !wordStarted) {
      finishCommand(index)
      comment = index
      const newline = input.indexOf("\n", index)
      if (newline === -1) break
      index = newline
      segment = newline + 1
      continue
    }
    const redirect = /^(?:&>>?|<<<|<<-?|<>|<&|>&|>\||>>|>|<)/.exec(input.slice(index))?.[0]
    if (redirect) {
      hasRedirect = true
      if (redirectTarget) invalidRedirect = true
      if (wordStarted && /^\d+$/.test(word)) {
        word = ""
        wordStarted = false
      } else finishWord()
      redirectTarget = true
      index += redirect.length - 1
      continue
    }
    if (
      "(){}".includes(char) ||
      (char === "&" && input[index + 1] !== "&" && input[index - 1] !== "|") ||
      (char === "!" && !wordStarted)
    )
      compound = true
    if (/\s/.test(char) && char !== "\n") {
      finishWord()
      continue
    }
    const next = input[index + 1]
    const separator =
      (char === "&" && next === "&") || (char === "|" && (next === "|" || next === "&"))
        ? char + next
        : char === ";" || char === "|" || char === "\n"
          ? char
          : undefined
    if (separator) {
      finishCommand(index, true)
      if (redirectTarget) invalidRedirect = true
      index += separator.length - 1
      segment = index + 1
      continue
    }
    wordStarted = true
    if (char === "$") dynamicWord = true
    if (char === "=" && !unsafeWord && /^[A-Za-z_][A-Za-z0-9_]*\+?$/.test(word)) assignmentWord = true
    word += char
  }

  if (quote) return { kind: "opaque", reason: "unterminated-quote" }
  if (heredoc) return { kind: "opaque", reason: "heredoc" }
  if (comment === undefined || input.includes("\n", comment)) finishCommand(input.length)
  if (redirectTarget) invalidRedirect = true
  if (separated && comment === undefined && !input.slice(segment).trim()) invalidStructure = true
  if (invalidStructure) return { kind: "opaque", reason: "invalid-structure" }
  if (invalidRedirect) return { kind: "opaque", reason: "invalid-redirect" }
  if (compound || commands.some((command) => BASH_COMPOUND_KEYWORDS.has(command.words[0] ?? "")))
    return { kind: "opaque", reason: "compound-command" }
  if (
    commands.some((command) => command.words[0]?.includes("$")) ||
    (dynamicWord && commands[0]?.words[0]?.includes("$"))
  )
    return { kind: "opaque", reason: "dynamic-command-name" }
  if (commands.some((command) => command.words[0]?.startsWith("=")))
    return { kind: "opaque", reason: "dynamic-command-name" }
  if (dynamicAssignment) return { kind: "opaque", reason: "dynamic-command-name" }
  if (commands.some((command) => BASH_WRAPPERS.has(shellCommandName(command.words[0]))))
    return { kind: "opaque", reason: "command-wrapper" }
  if (
    commands.some((command) => {
      const name = shellCommandName(command.words[0])
      if (name === "eval") return true
      if (BASH_SHELLS.has(name)) return true
      if (BASH_DYNAMIC_BUILTINS.has(name)) return true
      if (["declare", "local", "typeset"].includes(name))
        return command.words.some(
          (word, index) => index > 0 && (/^-[^-]*[aAi]/.test(word) || (/\[[^\]]*\$/.test(word) && word.includes("="))),
        )
      if (name === "printf") return command.words.some((word, index) => index > 0 && word === "-v")
      if (name === "test" || name === "[") return command.words.some((word) => word === "-v")
      if (name === "find")
        return command.words.some(
          (word) => word === "-exec" || word === "-execdir" || word === "-ok" || word === "-okdir",
        )
      if (name === "awk" || name === "gawk" || name === "mawk" || name === "nawk") return true
      if (name === "jobs") return command.words.some((word, index) => index > 0 && /^-[^-]*x/.test(word))
      if (name === "sched" || name === "zpty") return true
      if (name === "autoload") return true
      if (name === "export")
        return command.words.some(
          (word, index) =>
            index > 0 &&
            /^(?:PATH|path|CDPATH|cdpath|FPATH|fpath|ENV|BASH_ENV|SHELLOPTS|PS4|PROMPT4|LD_[A-Z0-9_]+|DYLD_[A-Z0-9_]+|GIT_[A-Z_]*COMMAND)\+?=/.test(
              word,
            ),
        )
      if (name === "set")
        return command.words.some((word, index) => {
          if (index === 0) return false
          const option = word.toLowerCase().replaceAll("_", "")
          return /^-[^-]*x/.test(word) || option === "xtrace" || option === "-o=xtrace" || option === "promptsubst"
        })
      if (name === "setopt" || name === "unsetopt") return true
      if (name === "print") return command.words.some((word, index) => index > 0 && /^-[^-]*P/.test(word))
      if (name === "git") return command.words.some((word, index) => index > 0 && /^alias\.[^=]+=!/.test(word))
      if (name === "python" || name === "python3")
        return command.words.some((word, index) => index > 0 && (/^-[A-Za-z]*c/.test(word) || word === "-c"))
      if (name === "perl" || name === "ruby")
        return command.words.some((word, index) => index > 0 && (/^-[A-Za-z]*e/.test(word) || word === "-e"))
      if (name === "node" || name === "bun")
        return command.words.some(
          (word, index) =>
            index > 0 &&
            (/^-[A-Za-z]*[ep]/.test(word) ||
              ["-e", "-p", "--eval", "--print"].includes(word) ||
              /^(?:--eval|--print)=/.test(word)),
        )
      return false
    })
  )
    return { kind: "opaque", reason: "shell-evaluation" }
  return { kind: "scanned", commands: commands.concat(nestedCommands) }
}

function bashSubstitution(input: string, start: number) {
  if (input[start] === "`") {
    for (let index = start + 1; index < input.length; index++) {
      if (input[index] === "\\") index++
      else if (input[index] === "`") return { source: input.slice(start + 1, index).replaceAll("\\`", "`"), end: index }
    }
    return
  }
  if (input.slice(start, start + 3) === "$((") return
  let quote: "single" | "double" | undefined
  let level = 1
  for (let index = start + 2; index < input.length; index++) {
    const char = input[index]
    if (quote === "single") {
      if (char === "'") quote = undefined
      continue
    }
    if (char === "\\") {
      index++
      continue
    }
    if (char === "'") {
      quote = "single"
      continue
    }
    if (char === "#" && (index === start + 2 || /[\s;&|()]/.test(input[index - 1] ?? ""))) return
    if (char === '"') {
      quote = quote === "double" ? undefined : "double"
      continue
    }
    if (char === "`" && quote !== "double") {
      const nested = bashSubstitution(input, index)
      if (!nested) return
      index = nested.end
      continue
    }
    if (quote === "double") {
      if (char === "$" && input[index + 1] === "(") {
        level++
        index++
      } else if (char === ")" && level > 1) level--
      continue
    }
    if (char === "(") level++
    if (char !== ")" || --level) continue
    return { source: input.slice(start + 2, index), end: index }
  }
}

export function scanPowerShell(input: string): Result {
  const commands: Array<{ resource: string; words: string[] }> = []
  const words: string[] = []
  let segment = 0
  let word = ""
  let started = false
  let quote: "single" | "double" | undefined
  let dynamic = false
  let invalid = false
  let redirectTarget = false
  let comment = false
  let separated = false
  let dangling = false
  let dynamicDirectory = false

  const finishWord = () => {
    if (!started) return
    if (!redirectTarget) words.push(word)
    redirectTarget = false
    word = ""
    started = false
  }
  const finishCommand = (end: number, boundary = false) => {
    finishWord()
    const resource = input.slice(segment, end).trim()
    if (resource) commands.push({ resource, words: [...words] })
    else if (boundary && separated) invalid = true
    words.length = 0
    separated ||= Boolean(resource)
  }

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (quote) {
      started = true
      if (quote === "single" && char === "'" && input[index + 1] === "'") {
        word += "'"
        index++
      } else if ((quote === "single" && char === "'") || (quote === "double" && char === '"')) quote = undefined
      else if (char === "`" && index + 1 < input.length) word += input[++index]
      else {
        if (quote === "double" && char === "$" && input[index + 1] === "(") dynamic = true
        word += char
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char === "'" ? "single" : "double"
      started = true
      continue
    }
    if (char === "`" && index + 1 < input.length) {
      if (words.length === 0) dynamic = true
      started = true
      if (input[index + 1] === "\r" && input[index + 2] === "\n") index += 2
      else if (input[index + 1] === "\r" || input[index + 1] === "\n") index++
      else word += input[++index]
      continue
    }
    if (char === "`") return { kind: "opaque", reason: "unterminated-escape" }
    if (char === "<" && input[index + 1] === "#") return { kind: "opaque", reason: "dynamic-execution" }
    if (char === "#" && !started) {
      if (/^#requires\b/i.test(input.slice(index))) return { kind: "opaque", reason: "dynamic-execution" }
      finishCommand(index)
      comment = true
      const endings = [input.indexOf("\n", index), input.indexOf("\r", index)].filter((ending) => ending >= 0)
      const newline = endings.length > 0 ? Math.min(...endings) : -1
      if (newline === -1) break
      comment = false
      index = input[newline] === "\r" && input[newline + 1] === "\n" ? newline + 1 : newline
      segment = newline + 1
      continue
    }
    const redirect = powerShellRedirect(input, index)
    if (redirect) {
      finishWord()
      redirectTarget = !redirect.includes("&")
      index += redirect.length - 1
      continue
    }
    if ("{}@()".includes(char) || char === "&" || (char === "." && !started)) dynamic = true
    if (/\s/.test(char) && char !== "\n" && char !== "\r") {
      finishWord()
      continue
    }
    const next = input[index + 1]
    const separator =
      char === "\r" && next === "\n"
        ? char + next
        : (char === "&" && next === "&") || (char === "|" && next === "|")
          ? char + next
          : char === ";" || char === "|" || char === "\n" || char === "\r"
            ? char
            : undefined
    if (separator) {
      finishCommand(index, true)
      if (redirectTarget) invalid = true
      dangling = separator !== ";" && separator !== "\n" && separator !== "\r" && separator !== "\r\n"
      index += separator.length - 1
      segment = index + 1
      continue
    }
    started = true
    dangling = false
    word += char
  }

  if (quote) return { kind: "opaque", reason: "unterminated-quote" }
  if (!comment) finishCommand(input.length)
  if (redirectTarget || invalid || dangling) return { kind: "opaque", reason: "invalid-structure" }
  if (
    dynamic ||
    commands.some((command) => {
      const head = command.words[0] ?? ""
      if (head.includes("\\") && !/^[A-Za-z]:\\/.test(head)) return true
      const rawName = shellCommandName(head)
      const name = POWERSHELL_ALIASES[rawName] ?? rawName
      if (name === "using" && /^(?:module|assembly)$/i.test(command.words[1] ?? "")) return true
      if (head.includes("$") || head.includes("@")) return true
      if (["return", "throw", "exit", "break", "continue"].includes(name) && command.words.length > 1) return true
      if (POWERSHELL_DYNAMIC_COMMANDS.has(name)) return true
      if (/\.(?:ps1|psm1|cmd|bat|vbs|wsf)$/i.test(name)) return true
      if (
        [
          "set-item",
          "new-item",
          "remove-item",
          "rename-item",
          "copy-item",
          "move-item",
          "clear-item",
          "set-content",
          "add-content",
          "clear-content",
          "out-file",
        ].includes(name)
      )
        return command.words.some((word) => /^(?:alias|function|env):/i.test(word))
      if (POWERSHELL_LOCATIONS.has(name ?? ""))
        return (dynamicDirectory =
          command.words.some(
            (word, index) =>
              index > 0 && (word.includes("(") || (word.includes("$") && !knownPowerShellDirectory(word))),
          ) ||
          command.words.some((word, index) => index > 0 && /^[A-Za-z]+:/.test(word) && !/^[A-Za-z]:[\\/]/.test(word)))
      if (!POWERSHELL_SHELLS.has(name)) return false
      return command.words.length > 1
    })
  )
    return { kind: "opaque", reason: dynamicDirectory ? "dynamic-directory" : "dynamic-execution" }
  return { kind: "scanned", commands }
}

function shellCommandName(word: string | undefined) {
  const value = (word ?? "").toLowerCase()
  return value.slice(Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")) + 1)
}

function knownPowerShellDirectory(word: string) {
  const variable = /^(?:\$(?:PWD|HOME|PSHOME)|\$env:[A-Za-z_][A-Za-z0-9_]*|\$\{env:[^}]+\})(?:[\\/]|$)/i.exec(word)
  return Boolean(variable) && !word.slice(variable?.[0].length).includes("$")
}

function powerShellRedirect(input: string, index: number) {
  let cursor = index
  if (input[cursor] === "*") cursor++
  else while (/\d/.test(input[cursor] ?? "")) cursor++
  if (input[cursor] !== ">" && input[cursor] !== "<") return
  cursor++
  if (input[cursor] === ">") cursor++
  if (input[cursor] === "&") {
    cursor++
    while (/\d/.test(input[cursor] ?? "")) cursor++
  }
  return input.slice(index, cursor)
}

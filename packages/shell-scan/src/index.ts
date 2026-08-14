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
  const group = bashLeadingGroup(input)
  if (group) {
    if (depth >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "invalid-structure" }
    const nested = scanBash(group.source, depth + 1)
    if (nested.kind === "opaque") return nested
    const suffix = input.slice(group.end + 1).trim()
    if (!suffix) return nested
    const separator = /^(?:&&|\|\||\|&|[;&|])/.exec(suffix)?.[0]
    const remaining = separator ? suffix.slice(separator.length).trim() : suffix
    if (separator && !remaining) return nested
    const prefixed = separator ? remaining : /^[<>]/.test(remaining) ? `: ${remaining}` : undefined
    if (!prefixed) return { kind: "opaque", reason: "compound-command" }
    const rest = scanBash(prefixed, depth + 1)
    if (rest.kind === "opaque") return rest
    return {
      kind: "scanned",
      commands: nested.commands.concat(rest.commands.filter((command) => command.words[0] !== ":")),
    }
  }
  const commands: Array<{ resource: string; words: string[] }> = []
  const nestedCommands: Array<{ resource: string; words: string[] }> = []
  const words: string[] = []
  const assignmentWords: boolean[] = []
  let word = ""
  let wordStarted = false
  let assignmentWord = false
  let assignmentHeadUnsafe = false
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
  let terminalBackground = false

  const finishWord = () => {
    if (!wordStarted) return
    if (!redirectTarget) {
      words.push(word)
      assignmentWords.push(assignmentWord)
    }
    redirectTarget = false
    word = ""
    wordStarted = false
    assignmentWord = false
    assignmentHeadUnsafe = false
  }
  const finishCommand = (end: number, boundary = false) => {
    finishWord()
    const resource = input.slice(segment, end).trim()
    const name = assignmentWords.findIndex((assignment) => !assignment)
    if (name >= 0 && /[*?[]/.test(words[name])) compound = true
    if (resource && name >= 0)
      commands.push({
        resource,
        words: words.slice(name),
      })
    else if (!(assignmentWords.length > 0 && assignmentWords.every(Boolean)) && (hasRedirect || boundary || separated))
      invalidStructure = true
    words.length = 0
    assignmentWords.length = 0
    separated = true
    hasRedirect = false
  }

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (quote === "single") {
      wordStarted = true
      if (char === "'") quote = undefined
      else word += char
      continue
    }
    if (quote === "double") {
      wordStarted = true
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
      if (!assignmentWord) assignmentHeadUnsafe = true
      continue
    }
    if (char === '"') {
      quote = "double"
      wordStarted = true
      if (!assignmentWord) assignmentHeadUnsafe = true
      continue
    }
    if (char === "\\") {
      if (index + 1 >= input.length) return { kind: "opaque", reason: "unterminated-escape" }
      wordStarted = true
      if (input[index + 1] === "\n") index++
      else {
        if (!assignmentWord) assignmentHeadUnsafe = true
        word += input[++index]
      }
      continue
    }
    if ((char === "$" && input[index + 1] === "(") || char === "`") {
      const substitution = bashSubstitution(input, index)
      if (!substitution || depth >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "command-substitution" }
      const result = scanBash(substitution.source, depth + 1)
      if (result.kind === "opaque") return result
      nestedCommands.push(...result.commands)
      wordStarted = true
      word += input.slice(index, substitution.end + 1)
      index = substitution.end
      continue
    }
    if ((char === "<" || char === ">") && input[index + 1] === "(") {
      const substitution = bashParenthesized(input, index + 1)
      if (!substitution || depth >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "command-substitution" }
      const result = scanBash(substitution.source, depth + 1)
      if (result.kind === "opaque") return result
      nestedCommands.push(...result.commands)
      wordStarted = true
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
    if ("()".includes(char) || (char === "!" && !wordStarted)) compound = true
    if (/\s/.test(char) && char !== "\n") {
      finishWord()
      continue
    }
    const next = input[index + 1]
    const separator =
      (char === "&" && next === "&") || (char === "|" && (next === "|" || next === "&"))
        ? char + next
        : char === ";" || char === "|" || char === "&" || char === "\n"
          ? char
          : undefined
    if (separator) {
      finishCommand(index, true)
      if (redirectTarget) invalidRedirect = true
      terminalBackground = separator === "&" || separator === ";" || separator === "\n"
      index += separator.length - 1
      segment = index + 1
      continue
    }
    terminalBackground = false
    wordStarted = true
    if (char === "$") dynamicWord = true
    if (char === "=" && !assignmentHeadUnsafe && /^[A-Za-z_][A-Za-z0-9_]*\+?$/.test(word)) assignmentWord = true
    word += char
  }

  if (quote) return { kind: "opaque", reason: "unterminated-quote" }
  if (heredoc) return { kind: "opaque", reason: "heredoc" }
  if (!terminalBackground && (comment === undefined || input.includes("\n", comment))) finishCommand(input.length)
  if (redirectTarget) invalidRedirect = true
  if (separated && !terminalBackground && comment === undefined && !input.slice(segment).trim()) invalidStructure = true
  if (invalidStructure) return { kind: "opaque", reason: "invalid-structure" }
  if (invalidRedirect) return { kind: "opaque", reason: "invalid-redirect" }
  const conditional = bashConditionalCommands(commands)
  if (conditional) commands.splice(0, commands.length, ...conditional)
  if (compound || commands.some((command) => BASH_COMPOUND_KEYWORDS.has(command.words[0] ?? "")))
    return { kind: "opaque", reason: "compound-command" }
  if (
    commands.some((command) => /[$`]/.test(command.words[0] ?? "")) ||
    (dynamicWord && commands[0]?.words[0]?.includes("$"))
  )
    return { kind: "opaque", reason: "dynamic-command-name" }
  if (commands.some((command) => command.words[0]?.startsWith("=")))
    return { kind: "opaque", reason: "dynamic-command-name" }
  return { kind: "scanned", commands: commands.concat(nestedCommands) }
}

function bashConditionalCommands(commands: Array<{ resource: string; words: string[] }>) {
  if (commands[0]?.words[0] !== "if" || commands.at(-1)?.words[0] !== "fi") return
  const keywords = new Set(["if", "then", "elif", "else", "fi"])
  if (
    commands.some((command) => BASH_COMPOUND_KEYWORDS.has(command.words[0] ?? "") && !keywords.has(command.words[0]!))
  )
    return
  const normalized: Array<{ resource: string; words: string[] }> = []
  let phase: "condition" | "body" | "else" = "condition"
  let hasCommand = false
  let sawElse = false
  for (const [index, command] of commands.entries()) {
    const keyword = command.words[0]
    if (!keywords.has(keyword ?? "")) {
      normalized.push(command)
      hasCommand = true
      continue
    }
    const offset = command.resource.indexOf(keyword!) + keyword!.length
    const inline =
      command.words.length > 1
        ? { resource: command.resource.slice(offset).trim(), words: command.words.slice(1) }
        : undefined
    if (index === 0) {
      if (inline) normalized.push(inline)
      hasCommand = Boolean(inline)
      continue
    }
    if (keyword === "then") {
      if (phase !== "condition" || !hasCommand) return
      phase = "body"
      hasCommand = Boolean(inline)
    }
    if (keyword === "elif") {
      if (phase !== "body" || !hasCommand || sawElse) return
      phase = "condition"
      hasCommand = Boolean(inline)
    }
    if (keyword === "else") {
      if (phase !== "body" || !hasCommand || sawElse) return
      phase = "else"
      sawElse = true
      hasCommand = Boolean(inline)
    }
    if (keyword === "fi") {
      if (index !== commands.length - 1 || phase === "condition" || !hasCommand || inline) return
      continue
    }
    if (inline) normalized.push(inline)
  }
  return normalized
}

function bashLeadingGroup(input: string) {
  const start = input.search(/\S/)
  if (start < 0) return
  if (input[start] === "{") {
    const group = bashBraced(input, start)
    if (!group) return
    const source = group.source.trim()
    if (!source.endsWith(";")) return
    return { source: source.slice(0, -1), end: group.end }
  }
  if (input[start] !== "(") return
  return bashParenthesized(input, start)
}

function bashBraced(input: string, start: number) {
  let quote: "single" | "double" | undefined
  let level = 1
  for (let index = start + 1; index < input.length; index++) {
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
    if (char === '"') {
      quote = quote === "double" ? undefined : "double"
      continue
    }
    if (char === "{" && quote !== "double") level++
    if (char !== "}" || quote === "double" || --level) continue
    return { source: input.slice(start + 1, index), end: index }
  }
}

function bashParenthesized(input: string, start: number) {
  let quote: "single" | "double" | undefined
  let level = 1
  for (let index = start + 1; index < input.length; index++) {
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
    if (char === '"') {
      quote = quote === "double" ? undefined : "double"
      continue
    }
    if (char === "(" && quote !== "double") level++
    if (char !== ")" || quote === "double" || --level) continue
    return { source: input.slice(start + 1, index), end: index }
  }
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
    if (quote !== "double" && char === "#" && (index === start + 2 || /[\s;&|()]/.test(input[index - 1] ?? ""))) return
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
  return scanPowerShellNested(input, 0)
}

function scanPowerShellNested(input: string, depth: number): Result {
  if (input.length > MAX_BASH_INPUT_LENGTH || depth >= MAX_SUBSTITUTION_DEPTH)
    return { kind: "opaque", reason: "invalid-structure" }
  const commands: Array<{ resource: string; words: string[] }> = []
  const nestedCommands: Array<{ resource: string; words: string[] }> = []
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
    if (char === "{" && !started) {
      const block = powerShellBlock(input, index)
      if (!block) return { kind: "opaque", reason: "invalid-structure" }
      const result = scanPowerShellNested(block.source, depth + 1)
      if (result.kind === "opaque") return result
      nestedCommands.push(...result.commands)
      started = true
      word += input.slice(index, block.end + 1)
      index = block.end
      continue
    }
    if (char === "}") return { kind: "opaque", reason: "invalid-structure" }
    if (
      (char === "&" || char === ".") &&
      !started &&
      words.length === 0 &&
      (/\s/.test(input[index + 1] ?? "") || !input[index + 1])
    )
      continue
    if ("@()".includes(char)) dynamic = true
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
          : char === ";" || char === "|" || char === "&" || char === "\n" || char === "\r"
            ? char
            : undefined
    if (separator) {
      finishCommand(index, true)
      if (redirectTarget) invalid = true
      dangling = ![";", "&", "\n", "\r", "\r\n"].includes(separator)
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
      if (head.includes("$") || head.includes("@")) return true
      if (["return", "throw", "exit", "break", "continue"].includes(name) && command.words.length > 1) return true
      if (POWERSHELL_LOCATIONS.has(name ?? ""))
        return (dynamicDirectory =
          command.words.some(
            (word, index) =>
              index > 0 && (word.includes("(") || (word.includes("$") && !knownPowerShellDirectory(word))),
          ) ||
          command.words.some((word, index) => index > 0 && /^[A-Za-z]+:/.test(word) && !/^[A-Za-z]:[\\/]/.test(word)))
      return false
    })
  )
    return { kind: "opaque", reason: dynamicDirectory ? "dynamic-directory" : "dynamic-execution" }
  return { kind: "scanned", commands: commands.concat(nestedCommands) }
}

function powerShellBlock(input: string, start: number) {
  let quote: "single" | "double" | undefined
  let level = 1
  for (let index = start + 1; index < input.length; index++) {
    const char = input[index]
    if (quote === "single") {
      if (char === "'" && input[index + 1] === "'") index++
      else if (char === "'") quote = undefined
      continue
    }
    if (char === "`") {
      index++
      continue
    }
    if (char === "#" && quote !== "double") {
      const newline = input.indexOf("\n", index)
      if (newline < 0) return
      index = newline
      continue
    }
    if (char === "<" && input[index + 1] === "#" && quote !== "double") {
      const end = input.indexOf("#>", index + 2)
      if (end < 0) return
      index = end + 1
      continue
    }
    if (char === "'") {
      quote = "single"
      continue
    }
    if (char === '"') {
      quote = quote === "double" ? undefined : "double"
      continue
    }
    if (char === "{" && quote !== "double") level++
    if (char !== "}" || quote === "double" || --level) continue
    return { source: input.slice(start + 1, index), end: index }
  }
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

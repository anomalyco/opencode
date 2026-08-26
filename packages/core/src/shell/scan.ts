export * as ShellScan from "./scan.js"

export type OpaqueReason =
  | "command-substitution"
  | "compound-command"
  | "dynamic-command-name"
  | "dynamic-execution"
  | "heredoc"
  | "invalid-redirect"
  | "invalid-structure"
  | "unterminated-escape"
  | "unterminated-quote"

export const Nested = Symbol("ShellScan.Nested")

type Command = { resource: string; words: string[]; [Nested]?: true }

export type Result = { kind: "scanned"; commands: Command[] } | { kind: "opaque"; reason: OpaqueReason }

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
  "time",
])
const BASH_REDIRECTS = ["&>>", "&>", "<<<", "<<-", "<<", "<>", "<&", ">&", ">|", ">>", ">", "<"]
const MAX_INPUT_LENGTH = 64 * 1024
const MAX_SUBSTITUTION_DEPTH = 32

export function scan(input: string): Result {
  return scanBash(input, 0)
}

function scanBash(input: string, depth: number): Result {
  if (input.length > MAX_INPUT_LENGTH) return { kind: "opaque", reason: "invalid-structure" }
  const group = bashLeadingGroup(input)
  if (group) {
    if (depth >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "invalid-structure" }
    const nested = scanBash(group.source, depth + 1)
    if (nested.kind === "opaque") return nested
    const suffix = input.slice(group.end + 1).replace(/^[ \t\n]+|[ \t\n]+$/g, "")
    if (!suffix) return nested
    const separator = /^(?:&&|\|\||\|&|[;&|])/.exec(suffix)?.[0]
    const remaining = separator ? suffix.slice(separator.length).replace(/^[ \t\n]+|[ \t\n]+$/g, "") : suffix
    if (separator && !remaining)
      return separator === ";" || separator === "&" ? nested : { kind: "opaque", reason: "invalid-structure" }
    if (!separator) return { kind: "opaque", reason: "compound-command" }
    const rest = scanBash(remaining, depth + 1)
    if (rest.kind === "opaque") return rest
    return {
      kind: "scanned",
      commands: nested.commands.concat(rest.commands),
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
    const resource = input.slice(segment, end).replace(/^[ \t\n]+|[ \t\n]+$/g, "")
    const name = assignmentWords.findIndex((assignment) => !assignment)
    if (name >= 0 && !words[name]) invalidStructure = true
    if (name >= 0 && /[*?[{}]/.test(words[name])) compound = true
    if (resource && name >= 0)
      commands.push({
        resource,
        words: words.slice(name),
      })
    else if (hasRedirect || boundary || separated) {
      const assignmentOnly = assignmentWords.length > 0 && assignmentWords.every(Boolean)
      if (!assignmentOnly || hasRedirect || boundary) invalidStructure = true
    }
    commands.push(...nestedCommands.splice(0))
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
      else if (char === "\\" && index + 1 < input.length) {
        const next = input[index + 1]
        if ('$`"\\\n'.includes(next)) {
          index++
          if (next !== "\n") word += next
        } else word += char
      } else if ((char === "$" && input[index + 1] === "(") || char === "`") {
        const substitution = bashSubstitution(input, index)
        if (!substitution || depth >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "command-substitution" }
        const result = scanBash(substitution.source, depth + 1)
        if (result.kind === "opaque") return result
        nestedCommands.push(...result.commands.map(markNested))
        word += input.slice(index, substitution.end + 1)
        index = substitution.end
      } else {
        if (
          char === "$" &&
          (input[index + 1] === "[" ||
            (input[index + 1] === "{" &&
              !/^\$\{(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*#?$!-])\}/.test(input.slice(index))))
        )
          return { kind: "opaque", reason: "dynamic-execution" }
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
      if (input[index + 1] === "\n") index++
      else {
        wordStarted = true
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
      nestedCommands.push(...result.commands.map(markNested))
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
      nestedCommands.push(...result.commands.map(markNested))
      wordStarted = true
      word += input.slice(index, substitution.end + 1)
      index = substitution.end
      continue
    }
    // Parameter operators and subscripts have their own quoting and arithmetic evaluation rules.
    if (
      char === "$" &&
      ("['\"".includes(input[index + 1] ?? "\0") ||
        (input[index + 1] === "{" && !/^\$\{(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*#?$!-])\}/.test(input.slice(index))))
    )
      return { kind: "opaque", reason: "dynamic-execution" }
    if (char === "<" && input[index + 1] === "<") heredoc = true
    if (char === "#" && !wordStarted) {
      const newline = input.indexOf("\n", index)
      finishCommand(index, newline !== -1 && words.length > 0)
      comment = index
      if (newline === -1) break
      index = newline
      segment = newline + 1
      continue
    }
    const redirect = "<>&".includes(char)
      ? BASH_REDIRECTS.find((candidate) => input.startsWith(candidate, index))
      : undefined
    if (redirect) {
      hasRedirect = true
      if (redirectTarget) invalidRedirect = true
      if (wordStarted && !assignmentHeadUnsafe && /^\d+$/.test(word)) {
        word = ""
        wordStarted = false
      } else finishWord()
      redirectTarget = true
      index += redirect.length - 1
      continue
    }
    if ("()".includes(char) || (char === "!" && !wordStarted)) compound = true
    if (/\s/.test(char) && !" \t\n".includes(char)) return { kind: "opaque", reason: "invalid-structure" }
    if (char === " " || char === "\t") {
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
    if (char === "=" && !assignmentHeadUnsafe && /^[A-Za-z_][A-Za-z0-9_]*\+?$/.test(word)) assignmentWord = true
    word += char
  }

  if (quote) return { kind: "opaque", reason: "unterminated-quote" }
  if (heredoc) return { kind: "opaque", reason: "heredoc" }
  if (
    (!terminalBackground || wordStarted || words.length > 0 || hasRedirect) &&
    (comment === undefined || input.includes("\n", comment))
  )
    finishCommand(input.length)
  if (redirectTarget) invalidRedirect = true
  if (separated && !terminalBackground && comment === undefined && !input.slice(segment).trim()) invalidStructure = true
  if (invalidStructure) return { kind: "opaque", reason: "invalid-structure" }
  if (invalidRedirect) return { kind: "opaque", reason: "invalid-redirect" }
  const conditional = bashConditionalCommands(commands, depth)
  if (conditional) commands.splice(0, commands.length, ...conditional)
  if (compound || commands.some((command) => BASH_COMPOUND_KEYWORDS.has(command.words[0] ?? "")))
    return { kind: "opaque", reason: "compound-command" }
  if (commands.some((command) => /[$`]/.test(command.words[0] ?? "")))
    return { kind: "opaque", reason: "dynamic-command-name" }
  if (commands.some((command) => command.words[0]?.startsWith("=")))
    return { kind: "opaque", reason: "dynamic-command-name" }
  return { kind: "scanned", commands }
}

function bashConditionalCommands(input: Command[], depth: number) {
  if (depth >= MAX_SUBSTITUTION_DEPTH) return
  const commands = input.filter((command) => !command[Nested])
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
      const result = scanBash(command.resource, depth + 1)
      if (result.kind === "opaque") return
      normalized.push(...result.commands)
      hasCommand = true
      continue
    }
    if (!/^(?:if|then|elif|else|fi)(?:[ \t\n]|$)/.test(command.resource)) return
    const source = command.resource.slice(keyword!.length).replace(/^[ \t\n]+|[ \t\n]+$/g, "")
    const inline = source ? scanBash(source, depth + 1) : undefined
    if (inline?.kind === "opaque") return
    if (index === 0) {
      if (inline) normalized.push(...inline.commands)
      hasCommand = Boolean(inline)
      continue
    }
    if (keyword === "if") return
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
    if (inline) normalized.push(...inline.commands)
  }
  return normalized
}

function bashLeadingGroup(input: string) {
  const start = input.search(/[^ \t\n]/)
  if (start < 0) return
  if (input[start] === "{") {
    const group = bashBraced(input, start)
    if (!group) return
    const source = group.source.replace(/^[ \t\n]+|[ \t\n]+$/g, "")
    if (!source.endsWith(";")) return
    return { source: source.slice(0, -1), end: group.end }
  }
  if (input[start] !== "(" || input[start + 1] === "(") return
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
    if (char === "'" && quote !== "double") {
      quote = "single"
      continue
    }
    if (char === '"') {
      quote = quote === "double" ? undefined : "double"
      continue
    }
    if (char === "`" || (char === "$" && input[index + 1] === "(")) {
      const nested = bashSubstitution(input, index)
      if (!nested) return
      index = nested.end
      continue
    }
    if (char === "#" && quote !== "double" && /[ \t\n;&|{}]/.test(input[index - 1] ?? "")) return
    if (char === "{" && quote !== "double") level++
    if (char !== "}" || quote === "double" || --level) continue
    return { source: input.slice(start + 1, index), end: index }
  }
}

function bashParenthesized(input: string, start: number, depth = 0): { source: string; end: number } | undefined {
  if (depth >= MAX_SUBSTITUTION_DEPTH) return
  let quote: "single" | "double" | undefined
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
    if (char === "'" && quote !== "double") {
      quote = "single"
      continue
    }
    if (char === '"') {
      quote = quote === "double" ? undefined : "double"
      continue
    }
    if (char === "`" || (char === "$" && input[index + 1] === "(")) {
      const nested = bashSubstitution(input, index, depth + 1)
      if (!nested) return
      index = nested.end
      continue
    }
    if (quote === "double") continue
    if (char === "#" && /[ \t\n;&|()]/.test(input[index - 1] ?? "")) return
    if (char === "(") {
      const nested = bashParenthesized(input, index, depth + 1)
      if (!nested) return
      index = nested.end
      continue
    }
    if (char === ")") return { source: input.slice(start + 1, index), end: index }
  }
}

function bashSubstitution(input: string, start: number, depth = 0): { source: string; end: number } | undefined {
  if (depth >= MAX_SUBSTITUTION_DEPTH) return
  if (input[start] === "`") {
    for (let index = start + 1; index < input.length; index++) {
      // Legacy substitution removes an escape layer before parsing its body.
      if (input[index] === "\\") return
      if (input[index] === "`") return { source: input.slice(start + 1, index), end: index }
    }
    return
  }
  if (input.slice(start, start + 3) === "$((") return
  return bashParenthesized(input, start + 1, depth)
}

export function scanPowerShell(input: string): Result {
  return scanPowerShellNested(input, 0)
}

function scanPowerShellNested(input: string, depth: number): Result {
  if (input.length > MAX_INPUT_LENGTH || depth >= MAX_SUBSTITUTION_DEPTH)
    return { kind: "opaque", reason: "invalid-structure" }
  // PowerShell's Unicode quotes, dashes, and whitespace differ from JavaScript's token rules.
  if (/[\0\u0085\u2013-\u2015\u2018-\u201e\ufeff]/.test(input)) return { kind: "opaque", reason: "invalid-structure" }
  const commands: Array<{ resource: string; words: string[] }> = []
  const nestedCommands: Array<{ resource: string; words: string[] }> = []
  const words: string[] = []
  let segment = 0
  let word = ""
  let started = false
  let quote: "single" | "double" | undefined
  let standalone = false
  let dynamic = false
  let invalid = false
  let redirectTarget = false
  let comment = false
  let dangling = false
  let invocation = false

  const finishWord = () => {
    if (!started) return
    // Stop-parsing is recognized by token value, including quoted or escaped spellings.
    if (word === "--%") dynamic = true
    if (!redirectTarget) {
      words.push(word)
      dangling = false
    }
    redirectTarget = false
    word = ""
    started = false
  }
  const finishCommand = (end: number, required = false) => {
    finishWord()
    const resource = input.slice(segment, end).trim()
    if (words.length) commands.push({ resource, words: [...words] })
    else if (required || resource) invalid = true
    if (redirectTarget) invalid = true
    commands.push(...nestedCommands.splice(0))
    words.length = 0
    redirectTarget = false
    invocation = false
  }

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (quote === "single") {
      started = true
      if (char === "'" && input[index + 1] === "'") {
        word += "'"
        index++
      } else if (char === "'") {
        quote = undefined
        if (standalone) finishWord()
      } else word += char
      continue
    }
    if (quote === "double") {
      if (char === '"' && input[index + 1] === '"') {
        word += '"'
        index++
      } else if (char === '"') {
        quote = undefined
        if (standalone) finishWord()
      } else if (char === "`") {
        if (index + 1 >= input.length) return { kind: "opaque", reason: "unterminated-escape" }
        if (words.length === 0 || /[0abefnrtuv\r\n]/.test(input[index + 1])) dynamic = true
        word += input[++index]
      } else if (char === "$" && input[index + 1] === "(") {
        return { kind: "opaque", reason: "dynamic-execution" }
      } else word += char
      continue
    }
    if (char === "'" || char === '"') {
      if (!started && words.length === 0 && !invocation) return { kind: "opaque", reason: "dynamic-execution" }
      quote = char === "'" ? "single" : "double"
      standalone = !started
      started = true
      continue
    }
    if (char === "`" && index + 1 < input.length) {
      if (/[\s\u0085]/.test(input[index + 1])) return { kind: "opaque", reason: "invalid-structure" }
      if (";&|".includes(input[index + 1])) return { kind: "opaque", reason: "invalid-structure" }
      if (words.length === 0 || /[0abefnrtuv]/.test(input[index + 1])) dynamic = true
      started = true
      word += input[++index]
      continue
    }
    if (char === "`") return { kind: "opaque", reason: "unterminated-escape" }
    if (input.startsWith("--%", index)) return { kind: "opaque", reason: "dynamic-execution" }
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
      segment = index + 1
      continue
    }
    if (started && char === ">") return { kind: "opaque", reason: "invalid-redirect" }
    const redirect =
      !started && (char === ">" || char === "*" || /\d/.test(char)) ? powerShellRedirect(input, index) : undefined
    if (redirect === false) return { kind: "opaque", reason: "invalid-redirect" }
    if (redirect) {
      if (redirectTarget) return { kind: "opaque", reason: "invalid-redirect" }
      if (words.length === 0) return { kind: "opaque", reason: "invalid-redirect" }
      redirectTarget = !redirect.includes("&")
      index += redirect.length - 1
      continue
    }
    if (char === "{") {
      if (started || (words.length === 0 && !invocation)) return { kind: "opaque", reason: "dynamic-execution" }
      const block = powerShellBlock(input, index)
      if (!block) return { kind: "opaque", reason: "invalid-structure" }
      const result = scanPowerShellNested(block.source, depth + 1)
      if (result.kind === "opaque") return result
      nestedCommands.push(...result.commands.map(markNested))
      started = true
      word += input.slice(index, block.end + 1)
      index = block.end
      finishWord()
      continue
    }
    if (char === "}") return { kind: "opaque", reason: "invalid-structure" }
    if (
      !started &&
      words.length === 0 &&
      ((char === "&" && input[index + 1] !== "&") ||
        (char === "." && (/\s/.test(input[index + 1] ?? "") || !input[index + 1])))
    ) {
      if (invocation) return { kind: "opaque", reason: "invalid-structure" }
      invocation = true
      continue
    }
    if ("@()".includes(char)) return { kind: "opaque", reason: "dynamic-execution" }
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
      finishCommand(index, dangling || ![";", "\n", "\r", "\r\n"].includes(separator))
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
  const reason = dynamic
    ? "dynamic-execution"
    : commands.reduce<OpaqueReason | undefined>(
        (result, command) => result ?? powerShellOpaqueReason(command),
        undefined,
      )
  if (reason) return { kind: "opaque", reason }
  return { kind: "scanned", commands }
}

function powerShellBlock(input: string, start: number) {
  let quote: "single" | "double" | undefined
  let standalone = false
  let level = 1
  let started = false
  for (let index = start + 1; index < input.length; index++) {
    const char = input[index]
    if (quote === "single") {
      if (char === "'" && input[index + 1] === "'") index++
      else if (char === "'") {
        quote = undefined
        started = !standalone
      }
      continue
    }
    if (quote === "double") {
      if (char === "`") index++
      else if (char === '"' && input[index + 1] === '"') index++
      else if (char === '"') {
        quote = undefined
        started = !standalone
      } else if (char === "$" && input[index + 1] === "(") return
      continue
    }
    if (char === "`") {
      if (/[\s\u0085]/.test(input[index + 1] ?? "")) return
      started = true
      index++
      continue
    }
    if (input.startsWith("--%", index)) return
    if (char === "<" && input[index + 1] === "#") return
    if (char === "#" && !started) {
      const endings = [input.indexOf("\n", index), input.indexOf("\r", index)].filter((ending) => ending >= 0)
      const newline = endings.length > 0 ? Math.min(...endings) : -1
      if (newline < 0) return
      index = newline
      continue
    }
    if (char === "'" || char === '"') {
      quote = char === "'" ? "single" : "double"
      standalone = !started
      started = true
      continue
    }
    if (started && char === ">") return
    const redirect =
      !started && (char === ">" || char === "*" || /\d/.test(char)) ? powerShellRedirect(input, index) : undefined
    if (redirect === false) return
    if (redirect) {
      index += redirect.length - 1
      continue
    }
    if (char === "@") return
    if (char === "{") level++
    if (char === "}" && --level === 0) return { source: input.slice(start + 1, index), end: index }
    if (/[\s;&|{}]/.test(char)) {
      started = false
      continue
    }
    started = true
  }
}

function shellCommandName(word: string | undefined) {
  const value = (word ?? "").toLowerCase()
  return value.slice(Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")) + 1)
}

function powerShellOpaqueReason(command: Command): OpaqueReason | undefined {
  const head = command.words[0] ?? ""
  if (/^(?:[,+!\d-]|\.\d)/.test(head)) return "dynamic-execution"
  if (!head || (head !== "?" && /[*?\[\]]/.test(head))) return "dynamic-command-name"
  if (
    (head.includes("\\") &&
      !/^[A-Za-z]:\\/.test(head) &&
      !/^[A-Za-z_][A-Za-z0-9_.-]*\\[A-Za-z_][A-Za-z0-9_.-]*$/.test(head)) ||
    head.includes("$") ||
    head.includes("@")
  )
    return "dynamic-execution"

  const name = shellCommandName(head)
  if (["import-alias", "ipal", "new-alias", "nal", "sal", "set-alias"].includes(name)) return "dynamic-execution"
  if (command.words.some((word) => /^alias:/i.test(word))) return "dynamic-execution"
  if (
    [
      "begin",
      "catch",
      "class",
      "clean",
      "configuration",
      "data",
      "do",
      "dynamicparam",
      "else",
      "elseif",
      "end",
      "enum",
      "filter",
      "finally",
      "for",
      "function",
      "if",
      "in",
      "param",
      "process",
      "switch",
      "trap",
      "try",
      "until",
      "using",
      "while",
    ].includes(name)
  )
    return "compound-command"
  if (["return", "throw", "exit", "break", "continue"].includes(name) && command.words.length > 1)
    return "dynamic-execution"
}

function powerShellRedirect(input: string, index: number) {
  let cursor = index
  if (input[cursor] === "*") cursor++
  else while (/\d/.test(input[cursor] ?? "")) cursor++
  if (input[cursor] !== ">") return
  cursor++
  if (input[cursor] === ">") cursor++
  if (input[cursor] === "&") {
    cursor++
    while (/\d/.test(input[cursor] ?? "")) cursor++
  }
  const redirect = input.slice(index, cursor)
  return /^(?:(?:[1-6]|\*)?>>?|[2-6*]>&1)$/.test(redirect) ? redirect : false
}

function markNested(command: Command) {
  return Object.defineProperty({ ...command }, Nested, { value: true })
}

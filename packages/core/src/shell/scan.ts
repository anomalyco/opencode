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

type Command = { resource: string; words: string[]; rawWords: string[]; [Nested]?: true }

// Opaque describes a parsing limitation, not a permission decision.
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
  return scanBash(input, 0, { remaining: MAX_INPUT_LENGTH * MAX_SUBSTITUTION_DEPTH })
}

function scanBash(input: string, depth: number, budget: { remaining: number }, redirectOnly = false): Result {
  // Conditional normalization rescans substitutions, so depth alone does not bound total work.
  budget.remaining -= input.length
  if (input.length > MAX_INPUT_LENGTH || budget.remaining < 0) return { kind: "opaque", reason: "invalid-structure" }
  const group = bashLeadingGroup(input)
  if (group) {
    if (depth >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "invalid-structure" }
    if (!/[^ \t\n]/.test(group.source)) return { kind: "opaque", reason: "invalid-structure" }
    const nested = scanBash(group.source, depth + 1, budget)
    if (nested.kind === "opaque") return nested
    const suffix = input.slice(group.end + 1).replace(/^[ \t\n]+|[ \t\n]+$/g, "")
    if (!suffix) return nested
    const separator = /^(?:&&|\|\||\|&|[;|]|&(?!>))/.exec(suffix)?.[0]
    const remaining = separator ? suffix.slice(separator.length).replace(/^[ \t\n]+|[ \t\n]+$/g, "") : suffix
    if (separator && !remaining)
      return separator === ";" || separator === "&" ? nested : { kind: "opaque", reason: "invalid-structure" }
    if (!separator && !/^(?:\d*[<>]|&>)/.test(suffix)) return { kind: "opaque", reason: "compound-command" }
    const rest = scanBash(remaining, depth + 1, budget, !separator)
    if (rest.kind === "opaque") return rest
    return {
      kind: "scanned",
      commands: nested.commands.concat(rest.commands),
    }
  }
  const commands: Command[] = []
  const nestedCommands: Command[] = []
  const words: string[] = []
  const rawWords: string[] = []
  const assignmentWords: boolean[] = []
  let word = ""
  let wordStarted = false
  let wordStart = 0
  let assignmentWord = false
  let assignmentHeadUnsafe = false
  let segment = 0
  let quote: "single" | "double" | undefined
  let compound = false
  let invalidRedirect = false
  let invalidStructure = false
  let separated = false
  let heredoc = false
  let redirectTarget = false
  let hasRedirect = false
  let dangling = false

  const finishWord = (end: number) => {
    if (!wordStarted) return
    if (!redirectTarget) {
      words.push(word)
      rawWords.push(input.slice(wordStart, end))
      assignmentWords.push(assignmentWord)
    }
    redirectTarget = false
    word = ""
    wordStarted = false
    assignmentWord = false
    assignmentHeadUnsafe = false
  }
  const finishCommand = (end: number, boundary = false) => {
    finishWord(end)
    if (redirectTarget) invalidRedirect = true
    redirectTarget = false
    if (redirectOnly && !separated && words.length > 0) invalidStructure = true
    const resource = input.slice(segment, end).replace(/^[ \t\n]+|[ \t\n]+$/g, "")
    const name = assignmentWords.findIndex((assignment) => !assignment)
    if (name >= 0 && !words[name]) invalidStructure = true
    if (name >= 0 && (rawWords[name] === "{" || rawWords[name] === "}")) compound = true
    if (resource && name >= 0)
      commands.push({
        resource,
        words: words.slice(name),
        rawWords: rawWords.slice(name),
      })
    else if (hasRedirect || boundary || separated) {
      const assignmentOnly = assignmentWords.length > 0 && assignmentWords.every(Boolean)
      if (!assignmentOnly && !hasRedirect) invalidStructure = true
    }
    commands.push(...nestedCommands.splice(0))
    words.length = 0
    rawWords.length = 0
    assignmentWords.length = 0
    separated = true
    hasRedirect = false
  }

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (!wordStarted) wordStart = index
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
        for (const source of substitution.substitutions ?? [substitution.source]) {
          const result = scanBash(source, depth + 1, budget)
          if (result.kind === "opaque") return result
          nestedCommands.push(...result.commands.map(markNested))
        }
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
      for (const source of substitution.substitutions ?? [substitution.source]) {
        const result = scanBash(source, depth + 1, budget)
        if (result.kind === "opaque") return result
        nestedCommands.push(...result.commands.map(markNested))
      }
      wordStarted = true
      word += input.slice(index, substitution.end + 1)
      index = substitution.end
      continue
    }
    if ((char === "<" || char === ">") && input[index + 1] === "(") {
      const substitution = bashParenthesized(input, index + 1)
      if (!substitution || depth >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "command-substitution" }
      const result = scanBash(substitution.source, depth + 1, budget)
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
      if (words.length > 0 || hasRedirect) {
        finishCommand(index)
        dangling = false
      }
      if (newline === -1) break
      index = newline
      segment = newline + 1
      continue
    }
    const redirect = "<>&".includes(char)
      ? BASH_REDIRECTS.find((candidate) => input.startsWith(candidate, index))
      : undefined
    if (redirect) {
      if (wordStarted && /^\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(input.slice(wordStart, index)))
        return { kind: "opaque", reason: "invalid-redirect" }
      hasRedirect = true
      if (redirectTarget) invalidRedirect = true
      if (wordStarted && !assignmentHeadUnsafe && /^\d+$/.test(word)) {
        word = ""
        wordStarted = false
      } else finishWord(index)
      redirectTarget = true
      index += redirect.length - 1
      continue
    }
    if ("()".includes(char) || (char === "!" && !wordStarted)) compound = true
    if (/\s/.test(char) && !" \t\n".includes(char)) return { kind: "opaque", reason: "invalid-structure" }
    if (char === " " || char === "\t") {
      finishWord(index)
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
      if (separator === "\n" && !wordStarted && words.length === 0 && !hasRedirect) {
        segment = index + 1
        continue
      }
      finishCommand(index, true)
      dangling = separator !== "&" && separator !== ";" && separator !== "\n"
      index += separator.length - 1
      segment = index + 1
      continue
    }
    wordStarted = true
    if (char === "=" && !assignmentHeadUnsafe && /^[A-Za-z_][A-Za-z0-9_]*\+?$/.test(word)) assignmentWord = true
    word += char
  }

  if (quote) return { kind: "opaque", reason: "unterminated-quote" }
  if (heredoc) return { kind: "opaque", reason: "heredoc" }
  if (wordStarted || words.length > 0 || hasRedirect) {
    finishCommand(input.length)
    dangling = false
  }
  if (dangling) invalidStructure = true
  if (invalidStructure) return { kind: "opaque", reason: "invalid-structure" }
  if (invalidRedirect) return { kind: "opaque", reason: "invalid-redirect" }
  const conditional = bashConditionalCommands(commands, depth, budget)
  if (conditional) commands.splice(0, commands.length, ...conditional)
  if (compound || commands.some((command) => BASH_COMPOUND_KEYWORDS.has(command.words[0] ?? "")))
    return { kind: "opaque", reason: "compound-command" }
  return { kind: "scanned", commands }
}

function bashConditionalCommands(input: Command[], depth: number, budget: { remaining: number }) {
  if (depth >= MAX_SUBSTITUTION_DEPTH) return
  const commands = input.filter((command) => !command[Nested])
  if (commands[0]?.words[0] !== "if" || commands.at(-1)?.words[0] !== "fi") return
  const keywords = new Set(["if", "then", "elif", "else", "fi"])
  if (
    commands.some((command) => BASH_COMPOUND_KEYWORDS.has(command.words[0] ?? "") && !keywords.has(command.words[0]!))
  )
    return
  const normalized: Command[] = []
  let phase: "condition" | "body" | "else" = "condition"
  let hasCommand = false
  let sawElse = false
  for (const [index, command] of commands.entries()) {
    const keyword = command.words[0]
    if (!keywords.has(keyword ?? "")) {
      const result = scanBash(command.resource, depth + 1, budget)
      if (result.kind === "opaque") return
      normalized.push(...result.commands)
      hasCommand = true
      continue
    }
    if (!/^(?:if|then|elif|else|fi)(?:[ \t\n]|$)/.test(command.resource)) return
    const source = command.resource.slice(keyword!.length).replace(/^[ \t\n]+|[ \t\n]+$/g, "")
    const inline = source ? scanBash(source, depth + 1, budget) : undefined
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

function bashSubstitution(
  input: string,
  start: number,
  depth = 0,
): { source: string; end: number; substitutions?: string[] } | undefined {
  if (depth >= MAX_SUBSTITUTION_DEPTH) return
  if (input[start] === "`") {
    for (let index = start + 1; index < input.length; index++) {
      // Legacy substitution removes an escape layer before parsing its body.
      if (input[index] === "\\") return
      if (input[index] === "`") return { source: input.slice(start + 1, index), end: index }
    }
    return
  }
  if (input.startsWith("$((", start)) return bashArithmetic(input, start, depth)
  return bashParenthesized(input, start + 1, depth)
}

function bashArithmetic(input: string, start: number, depth: number) {
  // Arithmetic is not shell source; recurse only into its explicit command substitutions.
  const substitutions: string[] = []
  let level = 0
  for (let index = start + 3; index < input.length; index++) {
    const char = input[index]
    if (char === "(") {
      if (depth + ++level >= MAX_SUBSTITUTION_DEPTH) return
      continue
    }
    if (char === ")") {
      if (level > 0) {
        level--
        continue
      }
      if (input[index + 1] !== ")") return
      return { source: input.slice(start + 3, index), end: index + 1, substitutions }
    }
    if (char === "`" || (char === "$" && input[index + 1] === "(")) {
      const nested = bashSubstitution(input, index, depth + level + 1)
      if (!nested) return
      substitutions.push(...(nested.substitutions ?? [nested.source]))
      index = nested.end
      continue
    }
    if (char === "$") {
      const parameter =
        /^\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-]|\{(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*#?$!-])\})/.exec(
          input.slice(index),
        )?.[0]
      if (!parameter) return
      index += parameter.length - 1
      continue
    }
    if (char === "\\" && input[index + 1] === "\n") {
      index++
      continue
    }
    // Recognize tokens, not arithmetic values. Subscripts and inner quotes need separate grammar.
    if (!/[ \t\nA-Za-z0-9_@#+*/%<>=!&|^~?:,-]/.test(char)) return
  }
}

export function scanPowerShell(input: string): Result {
  return scanPowerShellNested(input, 0)
}

function scanPowerShellNested(input: string, depth: number): Result {
  if (input.length > MAX_INPUT_LENGTH || depth >= MAX_SUBSTITUTION_DEPTH)
    return { kind: "opaque", reason: "invalid-structure" }
  // PowerShell's Unicode quotes, dashes, and whitespace differ from JavaScript's token rules.
  if (/[\0\u0085\u2013-\u2015\u2018-\u201e\ufeff]/.test(input)) return { kind: "opaque", reason: "invalid-structure" }
  const commands: Command[] = []
  const nestedCommands: Command[] = []
  const words: string[] = []
  const rawWords: string[] = []
  let segment = 0
  let word = ""
  let started = false
  let wordStart = 0
  let quote: "single" | "double" | undefined
  let standalone = false
  let dynamic = false
  let invalid = false
  let redirectTarget = false
  let comment = false
  let dangling = false
  let invocation = false

  const finishWord = (end: number) => {
    if (!started) return
    // Stop-parsing is recognized by token value, including quoted or escaped spellings.
    if (word === "--%") dynamic = true
    if (!redirectTarget) {
      words.push(word)
      rawWords.push(input.slice(wordStart, end))
      dangling = false
    }
    redirectTarget = false
    word = ""
    started = false
  }
  const finishCommand = (end: number, required = false) => {
    finishWord(end)
    const resource = input.slice(segment, end).trim()
    if (words.length) commands.push({ resource, words: [...words], rawWords: [...rawWords] })
    else if (required || resource) invalid = true
    if (redirectTarget) invalid = true
    commands.push(...nestedCommands.splice(0))
    words.length = 0
    rawWords.length = 0
    redirectTarget = false
    invocation = false
  }

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (!started) wordStart = index
    if (quote === "single") {
      started = true
      if (char === "'" && input[index + 1] === "'") {
        word += "'"
        index++
      } else if (char === "'") {
        quote = undefined
        if (standalone) finishWord(index + 1)
      } else word += char
      continue
    }
    if (quote === "double") {
      if (char === '"' && input[index + 1] === '"') {
        word += '"'
        index++
      } else if (char === '"') {
        quote = undefined
        if (standalone) finishWord(index + 1)
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
      finishWord(index + 1)
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
    if ((char === "$" || char === "[") && !started && words.length === 0 && !invocation)
      return { kind: "opaque", reason: "dynamic-execution" }
    if (/\s/.test(char) && char !== "\n" && char !== "\r") {
      finishWord(index)
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
  if (!head) return "dynamic-command-name"
  const name = shellCommandName(head)
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

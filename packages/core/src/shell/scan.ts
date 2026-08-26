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

type Command = {
  resource: string
  words: string[]
  rawWords: string[]
  // Exclusive raw-token ends relative to resource, for source-shaped permission prefixes.
  wordEnds?: number[]
  statementHead?: true
  declaration?: true
  // Words after a trailing redirect are destinations in the legacy command span.
  redirectWordCount?: number
}

// Opaque describes a parsing limitation, not a permission decision.
export type Result = { kind: "scanned"; commands: Command[] } | { kind: "opaque"; reason: OpaqueReason }

const BASH_REDIRECTS = ["&>>", "&>", "<<<", "<<-", "<<", "<>", "<&", ">&", ">|", ">>", ">", "<"]
const BASH_DECLARATIONS = new Set(["declare", "typeset", "export", "readonly", "local", "unset", "unsetenv"])
const MAX_INPUT_LENGTH = 64 * 1024
const MAX_SUBSTITUTION_DEPTH = 32

export function scan(input: string): Result {
  return scanBash(input, 0, { remaining: MAX_INPUT_LENGTH * MAX_SUBSTITUTION_DEPTH })
}

function scanBash(input: string, depth: number, budget: { remaining: number }): Result {
  // Bound both nesting and total source visited by expansion scans.
  budget.remaining -= input.length
  if (input.length > MAX_INPUT_LENGTH || budget.remaining < 0 || depth > MAX_SUBSTITUTION_DEPTH)
    return { kind: "opaque", reason: "invalid-structure" }
  const commands: Command[] = []
  const nestedCommands: Command[] = []
  const words: string[] = []
  const rawWords: string[] = []
  const assignmentWords: boolean[] = []
  let word = ""
  let wordStarted = false
  let wordStart = 0
  let wordEnd = 0
  let commandEnd = 0
  let resourceEnd: number | undefined
  let redirectWordCount: number | undefined
  let assignmentWord = false
  let assignmentHeadUnsafe = false
  let segment = 0
  let quote: "single" | "double" | undefined
  let invalidRedirect = false
  let invalidStructure = false
  let separated = false
  let redirectTarget = false
  let hasRedirect = false
  let dangling = false
  let inList = false
  let compoundEnd = false
  const heredocs: Array<{ delimiter: string; quoted: boolean; tabs: boolean; command?: Command; start?: number }> = []
  const structures: Array<{
    kind: "if" | "while" | "until" | "for" | "case"
    phase: "header" | "condition" | "pattern" | "body" | "do"
    count: number
    sawElse?: boolean
  }> = []

  const addSubstitutions = (substitution: BashExpansion): Result | undefined => {
    for (const source of substitution.substitutions ?? [substitution.source]) {
      const result = scanBash(source, depth + 1, budget)
      if (result.kind === "opaque") return result
      nestedCommands.push(...result.commands)
    }
  }
  const statement = () => {
    const structure = structures.at(-1)
    if (structure) structure.count++
  }
  const header = () => ["header", "pattern", "do"].includes(structures.at(-1)?.phase ?? "")

  const finishWord = () => {
    if (!wordStarted) return
    if (!redirectTarget) {
      words.push(word)
      // Unquoted trailing continuations are ignored syntax, not part of the raw token.
      rawWords.push(input.slice(wordStart, wordEnd))
      assignmentWords.push(assignmentWord)
      commandEnd = wordEnd
    }
    redirectTarget = false
    word = ""
    wordStarted = false
    assignmentWord = false
    assignmentHeadUnsafe = false
  }
  const finishCommand = (boundary = false) => {
    finishWord()
    if (redirectTarget) invalidRedirect = true
    redirectTarget = false
    if (compoundEnd && words.length > 0) invalidStructure = true
    const resource = input.slice(segment, resourceEnd ?? wordEnd).replace(/^[ \t\n]+|[ \t\n]+$/g, "")
    const name = assignmentWords.findIndex((assignment) => !assignment)
    if (name >= 0 && !words[name]) invalidStructure = true
    if (rawWords[name] === "}") invalidStructure = true
    if (resource && name >= 0 && !header()) {
      const command: Command = {
        resource,
        words: words.slice(name),
        rawWords: rawWords.slice(name),
        ...(name === 0 && BASH_DECLARATIONS.has(rawWords[0]) && resource.startsWith(rawWords[0])
          ? { declaration: true as const }
          : {}),
        ...(redirectWordCount !== undefined && redirectWordCount < words.length
          ? { redirectWordCount: redirectWordCount - name }
          : {}),
      }
      commands.push(command)
      if (resourceEnd === undefined) {
        for (const heredoc of heredocs) {
          if (heredoc.command) continue
          heredoc.command = command
          heredoc.start = segment
        }
      }
    } else if (!header() && !compoundEnd && (hasRedirect || boundary || separated)) {
      const assignmentOnly = assignmentWords.length > 0 && assignmentWords.every(Boolean)
      if (!assignmentOnly && !hasRedirect) invalidStructure = true
    }
    commands.push(...nestedCommands.splice(0))
    if (!header() && (words.length > 0 || hasRedirect)) statement()
    words.length = 0
    rawWords.length = 0
    assignmentWords.length = 0
    separated = true
    hasRedirect = false
    resourceEnd = undefined
    redirectWordCount = undefined
    compoundEnd = false
  }

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (!wordStarted) wordStart = index
    if (!quote && !wordStarted) {
      const structure = structures.at(-1)
      const token = /^[A-Za-z_][A-Za-z0-9_]*(?=[ \t\n;()<>]|$)/.exec(input.slice(index))?.[0]
      if (structure?.kind === "case" && structure.phase === "header" && token === "in") {
        finishCommand()
        structure.phase = "pattern"
        index += token.length - 1
        segment = index + 1
        continue
      }
      if (structure?.phase === "pattern" && (char === "(" || char === "|")) continue
      if (structure?.phase === "pattern" && char === ")") {
        finishCommand()
        structure.phase = "body"
        structure.count = 0
        segment = index + 1
        continue
      }
      if (!words.length && !hasRedirect && !compoundEnd) {
        const definition =
          /^(?:function[ \t]+[A-Za-z_][A-Za-z0-9_]*(?:[ \t]*\([ \t]*\))?|[A-Za-z_][A-Za-z0-9_]*[ \t]*\([ \t]*\))[ \t\n]*(?=[{(])/.exec(
            input.slice(index),
          )
        if (definition && !header()) {
          index += definition[0].length - 1
          segment = index + 1
          continue
        }
        if (
          !header() &&
          (token === "if" ||
            token === "while" ||
            token === "until" ||
            token === "for" ||
            token === "select" ||
            token === "case")
        ) {
          if (depth + structures.length >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "compound-command" }
          structures.push({
            kind: token === "select" ? "for" : token,
            phase: ["for", "select", "case"].includes(token) ? "header" : "condition",
            count: 0,
          })
          index += token.length - 1
          segment = index + 1
          inList = false
          continue
        }
        if (
          token &&
          ["then", "elif", "else", "fi", "do", "done", "esac"].includes(token) &&
          (!header() ||
            (token === "do" && structure?.phase === "do") ||
            (token === "esac" && structure?.phase === "pattern"))
        ) {
          if (!structure || dangling) return { kind: "opaque", reason: "compound-command" }
          if (token === "then") {
            if (structure.kind !== "if" || structure.phase !== "condition" || !structure.count)
              return { kind: "opaque", reason: "compound-command" }
            structure.phase = "body"
          } else if (token === "elif" || token === "else") {
            if (structure.kind !== "if" || structure.phase !== "body" || !structure.count || structure.sawElse)
              return { kind: "opaque", reason: "compound-command" }
            structure.phase = token === "elif" ? "condition" : "body"
            structure.sawElse = token === "else"
          } else if (token === "do") {
            if (
              !["for", "while", "until"].includes(structure.kind) ||
              !["condition", "do"].includes(structure.phase) ||
              (structure.kind !== "for" && !structure.count)
            )
              return { kind: "opaque", reason: "compound-command" }
            structure.phase = "body"
          } else {
            if (
              (token === "fi" && (structure.kind !== "if" || structure.phase !== "body" || !structure.count)) ||
              (token === "done" &&
                (!["for", "while", "until"].includes(structure.kind) ||
                  structure.phase !== "body" ||
                  !structure.count)) ||
              (token === "esac" && (structure.kind !== "case" || structure.phase === "header"))
            )
              return { kind: "opaque", reason: "compound-command" }
            structures.pop()
            statement()
            compoundEnd = true
            dangling = false
          }
          structure.count = 0
          index += token.length - 1
          segment = index + 1
          inList = false
          continue
        }
        if (
          !header() &&
          ((char === "!" && /[ \t\n]/.test(input[index + 1] ?? "")) ||
            (token === "coproc" &&
              /^coproc[ \t]+(?:[A-Za-z_][A-Za-z0-9_]*[ \t]+)?(?:[{(]|(?:if|while|until|for|case)\b)/.test(
                input.slice(index),
              )) ||
            (token === "time" &&
              /^time[ \t]+(?:-p[ \t]+)?(?:[{(]|(?:if|while|until|for|case)\b)/.test(input.slice(index))))
        ) {
          index += token ? token.length - 1 : 0
          if (token === "time") index += /^[ \t]+-p\b/.exec(input.slice(index + 1))?.[0].length ?? 0
          if (token === "coproc")
            index +=
              /^[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]+(?=[{(]|(?:if|while|until|for|case)\b)/.exec(
                input.slice(index + 1),
              )?.[0].length ?? 0
          segment = index + 1
          continue
        }
      }
      if (
        ((!words.length && !hasRedirect && !header()) || (structure?.kind === "for" && structure.phase === "header")) &&
        input.startsWith("((", index)
      ) {
        const expression = bashExpansion(input, index, depth, "arithmetic")
        if (!expression) return { kind: "opaque", reason: "invalid-structure" }
        const failure = addSubstitutions(expression)
        if (failure) return failure
        commands.push(...nestedCommands.splice(0))
        statement()
        compoundEnd = !header()
        dangling = false
        index = expression.end
        segment = index + 1
        continue
      }
      if (
        !words.length &&
        !hasRedirect &&
        !header() &&
        (char === "(" || (char === "{" && /[ \t\n]/.test(input[index + 1] ?? "")))
      ) {
        const group = bashDelimited(input, index, depth)
        if (!group || !group.source.trim()) return { kind: "opaque", reason: "invalid-structure" }
        const result = scanBash(group.source, depth + 1, budget)
        if (result.kind === "opaque") return result
        commands.push(...result.commands)
        statement()
        compoundEnd = true
        dangling = false
        index = group.end
        segment = index + 1
        continue
      }
      if (!words.length && !hasRedirect && input.startsWith("[[", index)) {
        const expression = bashExpansion(input, index, depth, "test")
        if (!expression) return { kind: "opaque", reason: "invalid-structure" }
        const failure = addSubstitutions(expression)
        if (failure) return failure
        commands.push(...nestedCommands.splice(0))
        statement()
        compoundEnd = true
        dangling = false
        index = expression.end
        segment = index + 1
        continue
      }
    }
    if (quote === "single") {
      wordStarted = true
      wordEnd = index + 1
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
      } else if ((char === "$" && "({[".includes(input[index + 1] ?? "\0")) || char === "`") {
        const substitution = bashExpansion(input, index, depth, undefined, true)
        if (!substitution || depth >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "command-substitution" }
        const failure = addSubstitutions(substitution)
        if (failure) return failure
        word += input.slice(index, substitution.end + 1)
        index = substitution.end
      } else word += char
      wordEnd = index + 1
      continue
    }
    if (char === "$" && input[index + 1] === "'") {
      const literal = bashAnsiQuote(input, index + 1)
      if (!literal) return { kind: "opaque", reason: "unterminated-quote" }
      wordStarted = true
      if (!assignmentWord) assignmentHeadUnsafe = true
      word += literal.value
      index = literal.end
      wordEnd = index + 1
      continue
    }
    if (char === "$" && input[index + 1] === '"') {
      quote = "double"
      wordStarted = true
      if (!assignmentWord) assignmentHeadUnsafe = true
      wordEnd = ++index + 1
      continue
    }
    if (char === "'") {
      quote = "single"
      wordStarted = true
      wordEnd = index + 1
      if (!assignmentWord) assignmentHeadUnsafe = true
      continue
    }
    if (char === '"') {
      quote = "double"
      wordStarted = true
      wordEnd = index + 1
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
        wordEnd = index + 1
      }
      continue
    }
    if (
      (char === "$" && "({[".includes(input[index + 1] ?? "\0")) ||
      char === "`" ||
      (char === "[" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(word) && /^\[[\s\S]*?\]\+?=/.test(input.slice(index))) ||
      (char === "(" && (assignmentWord || /[?*+@!]$/.test(word)))
    ) {
      const substitution =
        char === "("
          ? bashExpansion(input, index, depth, assignmentWord ? "array" : "pattern")
          : char === "["
            ? bashExpansion(input, index, depth, "subscript")
            : bashExpansion(input, index, depth)
      if (!substitution || depth >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "command-substitution" }
      const failure = addSubstitutions(substitution)
      if (failure) return failure
      wordStarted = true
      word += input.slice(index, substitution.end + 1)
      index = substitution.end
      wordEnd = index + 1
      continue
    }
    if ((char === "<" || char === ">" || (char === "=" && !wordStarted)) && input[index + 1] === "(") {
      const substitution = bashDelimited(input, index + 1, depth)
      if (!substitution || depth >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "command-substitution" }
      const failure = addSubstitutions(substitution)
      if (failure) return failure
      wordStarted = true
      word += input.slice(index, substitution.end + 1)
      index = substitution.end
      wordEnd = index + 1
      continue
    }
    if (char === "#" && !wordStarted) {
      const newline = input.indexOf("\n", index)
      if (words.length > 0 || hasRedirect) {
        finishCommand()
        dangling = false
        inList = false
      }
      if (newline === -1) break
      index = newline - 1
      segment = newline
      continue
    }
    const redirect = "<>&".includes(char)
      ? BASH_REDIRECTS.find((candidate) => input.startsWith(candidate, index))
      : undefined
    if (redirect) {
      hasRedirect = true
      if (redirectTarget) invalidRedirect = true
      if (wordStarted && !assignmentHeadUnsafe && /^(?:\d+|\{[A-Za-z_][A-Za-z0-9_]*\})$/.test(word)) {
        // A continuation separates the legacy number token from the redirect descriptor.
        if (wordEnd < index) commandEnd = wordEnd
        word = ""
        wordStarted = false
      } else finishWord()
      // Trailing redirects wrap a whole list/pipeline in the legacy grammar, not its last command.
      // Prefix redirects remain part of the command, and later words remain redirect destinations.
      if (redirectWordCount === undefined && assignmentWords.some((assignment) => !assignment)) {
        redirectWordCount = words.length
        if (inList) resourceEnd = commandEnd
      }
      if (redirect === "<<" || redirect === "<<-") {
        const delimiter = bashHeredocDelimiter(input, index)
        if (!delimiter) return { kind: "opaque", reason: "invalid-redirect" }
        heredocs.push(delimiter)
        wordEnd = delimiter.end + 1
        index = delimiter.end
        redirectTarget = false
        continue
      }
      redirectTarget = true
      index += redirect.length - 1
      continue
    }
    if (structures.at(-1)?.phase === "pattern" && (char === ")" || char === "|")) {
      finishWord()
      index--
      continue
    }
    if ("()".includes(char)) return { kind: "opaque", reason: "compound-command" }
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
      const structure = structures.at(-1)
      if (char === ";" && structure?.kind === "case" && structure.phase === "body" && (next === ";" || next === "&")) {
        if (wordStarted || words.length || hasRedirect || compoundEnd) finishCommand()
        structure.phase = "pattern"
        index += input.startsWith(";;&", index) ? 2 : 1
        segment = index + 1
        inList = false
        continue
      }
      if (separator === "\n" && !wordStarted && words.length === 0 && !hasRedirect && !compoundEnd) {
        if (heredocs.length) {
          for (const heredoc of heredocs.splice(0)) {
            const body = bashHeredoc(input, index + 1, heredoc)
            if (!body) return { kind: "opaque", reason: "heredoc" }
            if (heredoc.command) heredoc.command.resource = input.slice(heredoc.start, body.end).trim()
            if (!heredoc.quoted) {
              const expansion = bashExpansion(body.source, 0, depth, "heredoc")
              if (!expansion) return { kind: "opaque", reason: "command-substitution" }
              const failure = addSubstitutions(expansion)
              if (failure) return failure
              commands.push(...nestedCommands.splice(0))
            }
            index = body.end
          }
        }
        segment = index + 1
        continue
      }
      finishCommand(true)
      if (structure?.kind === "for" && structure.phase === "header") structure.phase = "do"
      dangling = separator !== "&" && separator !== ";" && separator !== "\n"
      inList = dangling
      if (separator === "\n" && heredocs.length) {
        index--
        continue
      }
      index += separator.length - 1
      segment = index + 1
      continue
    }
    wordStarted = true
    if (char === "=" && !assignmentHeadUnsafe && /^[A-Za-z_][A-Za-z0-9_]*(?:\[.*\])?\+?$/.test(word))
      assignmentWord = true
    word += char
    wordEnd = index + 1
  }

  if (quote) return { kind: "opaque", reason: "unterminated-quote" }
  if (heredocs.length) return { kind: "opaque", reason: "heredoc" }
  if (wordStarted || words.length > 0 || hasRedirect) {
    finishCommand()
    dangling = false
  }
  if (dangling) invalidStructure = true
  if (invalidStructure) return { kind: "opaque", reason: "invalid-structure" }
  if (invalidRedirect) return { kind: "opaque", reason: "invalid-redirect" }
  if (structures.length) return { kind: "opaque", reason: "compound-command" }
  return { kind: "scanned", commands }
}

type BashExpansion = { source: string; end: number; substitutions?: string[] }

function bashDelimited(input: string, start: number, depth: number): BashExpansion | undefined {
  if (depth >= MAX_SUBSTITUTION_DEPTH) return
  const close = input[start] === "{" ? "}" : ")"
  const cases: Array<"header" | "pattern" | "body"> = []
  const heredocs: Array<{ delimiter: string; quoted: boolean; tabs: boolean }> = []
  let commandStart = true
  for (let index = start + 1; index < input.length; index++) {
    const char = input[index]
    if (char === "\\") {
      if (input[index + 1] !== "\n") commandStart = false
      index++
      continue
    }
    if (char === "'" || char === '"' || char === "`" || (char === "$" && "({['\"".includes(input[index + 1] ?? "\0"))) {
      commandStart = false
      if (char === "'" || input.startsWith("$'", index)) {
        const end = char === "'" ? input.indexOf("'", index + 1) : bashAnsiQuote(input, index + 1)?.end
        if (end === undefined || end < 0) return
        index = end
        continue
      }
      const nested =
        char === '"' || input.startsWith('$"', index)
          ? bashExpansion(input, index + (char === "$" ? 1 : 0), depth + 1, "double")
          : bashExpansion(input, index, depth + 1)
      if (!nested) return
      index = nested.end
      continue
    }
    const boundary = index === start + 1 || /[ \t\n;|&(){}]/.test(input[index - 1])
    if (char === "#" && boundary) {
      const newline = input.indexOf("\n", index)
      if (newline < 0) return
      index = newline - 1
      continue
    }
    if (input.startsWith("<<<", index)) {
      index += 2
      continue
    }
    if (input.startsWith("<<", index)) {
      const delimiter = bashHeredocDelimiter(input, index)
      if (!delimiter) return
      heredocs.push(delimiter)
      index = delimiter.end
      continue
    }
    if (char === "\n" && heredocs.length) {
      for (const heredoc of heredocs.splice(0)) {
        const body = bashHeredoc(input, index + 1, heredoc)
        if (!body) return
        index = body.end
      }
      commandStart = true
      continue
    }
    const token = boundary ? /^[A-Za-z_][A-Za-z0-9_]*(?=[ \t\n;()<>]|$)/.exec(input.slice(index))?.[0] : undefined
    if (token === "case" && commandStart) cases.push("header")
    if (token === "in" && cases.at(-1) === "header") cases[cases.length - 1] = "pattern"
    if (token === "esac" && (commandStart || cases.at(-1) === "pattern")) cases.pop()
    if (token) {
      commandStart = commandStart && ["if", "while", "until", "then", "elif", "else", "do"].includes(token)
      index += token.length - 1
      continue
    }
    if (cases.length && char === ";" && /[;&]/.test(input[index + 1] ?? "")) cases[cases.length - 1] = "pattern"
    if (cases.at(-1) === "pattern" && char === "(") continue
    if (cases.at(-1) === "pattern" && char === ")") {
      cases[cases.length - 1] = "body"
      commandStart = true
      continue
    }
    if (input.startsWith("((", index)) {
      const nested = bashExpansion(input, index, depth + 1, "arithmetic")
      if (!nested) return
      index = nested.end
      commandStart = false
      continue
    }
    if (char === "(" || (char === "{" && boundary && /[ \t\n]/.test(input[index + 1] ?? ""))) {
      const nested = bashDelimited(input, index, depth + 1)
      if (!nested) return
      index = nested.end
      commandStart = false
      continue
    }
    if (char === close && (close === ")" || boundary)) return { source: input.slice(start + 1, index), end: index }
    if (/[\n;&|]/.test(char)) commandStart = true
    else if (!/[ \t]/.test(char)) commandStart = false
  }
}

function bashExpansion(
  input: string,
  start: number,
  depth: number,
  mode?:
    | "arithmetic"
    | "arithmetic-group"
    | "subscript"
    | "array"
    | "pattern"
    | "double"
    | "test"
    | "heredoc"
    | "parameter",
  quoted = false,
): BashExpansion | undefined {
  if (depth >= MAX_SUBSTITUTION_DEPTH) return
  if (!mode && input[start] === "`") {
    let source = ""
    for (let index = start + 1; index < input.length; index++) {
      if (input[index] === "`") return { source, end: index }
      // Backticks remove one escape layer before their body is parsed as shell source.
      if (input[index] === "\\" && "$`\\\n".includes(input[index + 1] ?? "\0")) {
        if (input[++index] !== "\n") source += input[index]
        continue
      }
      source += input[index]
    }
    return
  }
  if (!mode && input.startsWith("$(", start) && !input.startsWith("$((", start))
    return bashDelimited(input, start + 1, depth)
  if (!mode && /^\$\{[ \t\n|]/.test(input.slice(start))) {
    const nested = bashDelimited(input, start + 1, depth)
    if (!nested) return
    return { ...nested, source: nested.source.startsWith("|") ? nested.source.slice(1) : nested.source }
  }
  const kind = mode ?? (input[start + 1] === "{" ? "parameter" : input[start + 1] === "[" ? "subscript" : "arithmetic")
  const arithmetic = ["arithmetic", "arithmetic-group", "subscript"].includes(kind)
  const offset = mode
    ? kind === "heredoc"
      ? 0
      : kind === "arithmetic" || kind === "test"
        ? 2
        : 1
    : kind === "arithmetic"
      ? 3
      : 2
  const close =
    kind === "heredoc"
      ? undefined
      : kind === "double"
        ? '"'
        : kind === "parameter"
          ? "}"
          : kind === "subscript"
            ? "]"
            : kind === "test"
              ? "]]"
              : kind === "arithmetic"
                ? "))"
                : ")"
  const substitutions: string[] = []
  for (let index = start + offset; index < input.length; index++) {
    const char = input[index]
    if (close && input.startsWith(close, index))
      return { source: input.slice(start + offset, index), end: index + close.length - 1, substitutions }
    if (char === "\\") {
      if ((kind !== "heredoc" && kind !== "double") || '$`\\\n"'.includes(input[index + 1] ?? "\0")) index++
      continue
    }
    if (
      (char === "'" || input.startsWith("$'", index)) &&
      kind !== "double" &&
      kind !== "heredoc" &&
      !arithmetic &&
      !(kind === "parameter" && quoted)
    ) {
      const end = char === "'" ? input.indexOf("'", index + 1) : bashAnsiQuote(input, index + 1)?.end
      if (end === undefined || end < 0) return
      index = end
      continue
    }
    if (char === '"' && kind !== "heredoc") {
      const nested = bashExpansion(input, index, depth + 1, "double")
      if (!nested) return
      substitutions.push(...nested.substitutions!)
      index = nested.end
      continue
    }
    if (char === "`" || (char === "$" && "({[".includes(input[index + 1] ?? "\0"))) {
      const nested = bashExpansion(input, index, depth + 1, undefined, kind === "double" || quoted)
      if (!nested) return
      substitutions.push(...(nested.substitutions ?? [nested.source]))
      index = nested.end
      continue
    }
    if (kind === "array" && "<>=".includes(char) && input[index + 1] === "(") {
      const nested = bashDelimited(input, index + 1, depth + 1)
      if (!nested) return
      substitutions.push(nested.source)
      index = nested.end
      continue
    }
    if (
      ((arithmetic || kind === "array" || kind === "pattern") && (char === "(" || char === "[")) ||
      (kind === "parameter" && char === "[" && /^[!#]?[A-Za-z_][A-Za-z0-9_]*$/.test(input.slice(start + offset, index)))
    ) {
      const nested = bashExpansion(
        input,
        index,
        depth + 1,
        char === "[" ? "subscript" : arithmetic ? "arithmetic-group" : kind,
      )
      if (!nested) return
      substitutions.push(...nested.substitutions!)
      index = nested.end
      continue
    }
    if (!mode && kind === "arithmetic" && char === ";") return
  }
  if (kind === "heredoc") return { source: input.slice(start), end: input.length - 1, substitutions }
}

function bashAnsiQuote(input: string, start: number) {
  let value = ""
  for (let index = start + 1; index < input.length; index++) {
    if (input[index] === "'") return { value, end: index }
    if (input[index] !== "\\") {
      value += input[index]
      continue
    }
    const escaped = input[++index]
    const simple: Record<string, string> = {
      a: "\x07",
      b: "\b",
      e: "\x1b",
      E: "\x1b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "\\": "\\",
      "'": "'",
      '"': '"',
      "?": "?",
    }
    if (escaped in simple) value += simple[escaped]
    else if (escaped === "c" && index + 1 < input.length)
      value += String.fromCharCode(input[++index].toUpperCase().charCodeAt(0) & 31)
    else {
      const digits =
        escaped === "x"
          ? /^[\da-fA-F]{1,2}/.exec(input.slice(index + 1))?.[0]
          : escaped === "u"
            ? /^[\da-fA-F]{1,4}/.exec(input.slice(index + 1))?.[0]
            : escaped === "U"
              ? /^[\da-fA-F]{1,8}/.exec(input.slice(index + 1))?.[0]
              : /[0-7]/.test(escaped ?? "")
                ? /^[0-7]{1,3}/.exec(input.slice(index))?.[0]
                : undefined
      if (!digits) value += `\\${escaped}`
      else {
        const octal = /[0-7]/.test(escaped)
        const point = parseInt(digits, octal ? 8 : 16)
        value += point <= 0x10ffff ? String.fromCodePoint(point) : ""
        index += digits.length - (octal ? 1 : 0)
      }
    }
  }
}

function bashHeredocDelimiter(input: string, start: number) {
  const tabs = input[start + 2] === "-"
  let delimiter = ""
  let quoted = false
  let quote: "'" | '"' | undefined
  let end = start
  let started = false
  for (let index = start + (tabs ? 3 : 2); index < input.length; index++) {
    const char = input[index]
    if (!started && /[ \t]/.test(char)) continue
    if (!started && char === "#") return
    if (!quote && /[ \t\n;&|()<>]/.test(char)) return started ? { delimiter, quoted, tabs, end } : undefined
    if (!quote && input.startsWith("$'", index)) {
      const literal = bashAnsiQuote(input, index + 1)
      if (!literal) return
      delimiter += literal.value
      quoted = true
      started = true
      index = literal.end
      end = index
      continue
    }
    if (!quote && input.startsWith('$"', index)) {
      quote = '"'
      quoted = true
      started = true
      end = ++index
      continue
    }
    if (char === quote) {
      quote = undefined
      end = index
      continue
    }
    if (char === "\\" && quote !== "'") {
      const next = input[index + 1]
      if (next === undefined) return
      if (next === "\n") {
        index++
        continue
      }
      // Double quotes only remove escapes for shell-special characters.
      if (!quote || '$`"\\'.includes(next)) {
        quoted = true
        started = true
        delimiter += input[++index]
        end = index
        continue
      }
    }
    if (!quote && (char === "'" || char === '"')) {
      quote = char
      quoted = true
      started = true
      end = index
      continue
    }
    delimiter += char
    started = true
    end = index
  }
  if (started && !quote) return { delimiter, quoted, tabs, end }
}

function bashHeredoc(input: string, start: number, delimiter: { delimiter: string; tabs: boolean; quoted: boolean }) {
  const bodyStart = start
  let lineStart = start
  let line = ""
  for (let index = start; index <= input.length; index++) {
    if (index < input.length && input[index] !== "\n") continue
    const text = input.slice(start, index)
    line += delimiter.tabs ? text.replace(/^\t+/, "") : text
    if (!delimiter.quoted && /(?<!\\)(?:\\\\)*\\$/.test(line) && index < input.length) {
      line = line.slice(0, -1)
      start = index + 1
      continue
    }
    if (line === delimiter.delimiter) return { source: input.slice(bodyStart, lineStart), end: index }
    line = ""
    start = index + 1
    lineStart = start
  }
}

export function scanPowerShell(input: string): Result {
  return scanPowerShellNested(input, 0, { remaining: MAX_INPUT_LENGTH * MAX_SUBSTITUTION_DEPTH })
}

function scanPowerShellNested(input: string, depth: number, budget: { remaining: number }, hash = false): Result {
  budget.remaining -= input.length
  if (input.length > MAX_INPUT_LENGTH || depth >= MAX_SUBSTITUTION_DEPTH || budget.remaining < 0)
    return { kind: "opaque", reason: "invalid-structure" }
  // PowerShell's Unicode quotes, dashes, and whitespace differ from JavaScript's token rules.
  if (/[\0\u0085\u2013-\u2015\u2018-\u201e\ufeff]/.test(input)) return { kind: "opaque", reason: "invalid-structure" }
  const commands: Command[] = []
  const nestedCommands: Command[] = []
  const words: string[] = []
  const rawWords: string[] = []
  const wordEnds: number[] = []
  let segment = 0
  let word = ""
  let started = false
  let wordStart = 0
  let quote: "single" | "double" | undefined
  let standalone = false
  let expression = hash
  let compound = false
  let stopParsing = false
  let commandEnd = 0
  let statementHead = true
  let invalid = false
  let redirectTarget = false
  let comment = false
  let dangling = false
  let invocation = false

  const finishWord = (end: number) => {
    if (!started) return
    // Generic tokens can spell stop-parsing with escapes or embedded quotes; literal strings cannot.
    if (word === "--%" && words.length > 0 && !expression && !/['"]/.test(input[wordStart])) stopParsing = true
    if (!redirectTarget) {
      if (!words.length && !invocation && !expression) segment = wordStart
      words.push(word)
      rawWords.push(input.slice(wordStart, end))
      wordEnds.push(end)
      dangling = false
    }
    commandEnd = end
    redirectTarget = false
    word = ""
    started = false
  }
  const finishCommand = (end: number, required = false) => {
    finishWord(end)
    const start = segment + input.slice(segment, commandEnd).search(/\S|$/)
    const resource = input.slice(start, commandEnd).trimEnd()
    if (words.length && !expression)
      commands.push({
        resource,
        words: [...words],
        rawWords: [...rawWords],
        wordEnds: wordEnds.map((end) => end - start),
        ...(statementHead && !invocation ? { statementHead: true as const } : {}),
      })
    else if ((!expression && invocation) || (required && !words.length && !nestedCommands.length)) invalid = true
    if (redirectTarget) invalid = true
    commands.push(...nestedCommands.splice(0))
    words.length = 0
    rawWords.length = 0
    wordEnds.length = 0
    redirectTarget = false
    invocation = false
    expression = hash
    compound = false
    stopParsing = false
  }

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (!started) wordStart = index
    if (stopParsing) {
      const stop = powerShellStopParsing(input, index)
      const text = input.slice(index, stop).trim()
      if (text) {
        wordStart = index + input.slice(index, stop).search(/\S/)
        word = text
        started = true
        finishWord(wordStart + text.length)
      }
      stopParsing = false
      index = stop - 1
      continue
    }
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
        const escape = powerShellEscape(input, index)
        if (!escape) return { kind: "opaque", reason: "unterminated-escape" }
        word += escape.value
        index = escape.end
      } else if (char === "$" && input[index + 1] === "(") {
        const block = powerShellBlock(input, index + 1, depth)
        if (!block) return { kind: "opaque", reason: "invalid-structure" }
        const result = scanPowerShellNested(block.source, depth + 1, budget)
        if (result.kind === "opaque") return result
        nestedCommands.push(...result.commands)
        word += input.slice(index, block.end + 1)
        index = block.end
      } else word += char
      continue
    }
    if (char === "'" || char === '"') {
      if (!started && words.length === 0 && !invocation) expression = true
      quote = char === "'" ? "single" : "double"
      standalone = !started
      started = true
      continue
    }
    if (char === "`") {
      const escape = powerShellEscape(input, index)
      if (!escape) return { kind: "opaque", reason: "unterminated-escape" }
      // At a token boundary escaped whitespace is trivia, not a new argument.
      if (started || /\S/.test(escape.value)) {
        started = true
        word += escape.value
      }
      index = escape.end
      continue
    }
    if (!started && words.length > 0 && !expression && /^--%(?=$|[\s;|&(){}])/.test(input.slice(index))) {
      word = "--%"
      started = true
      finishWord(index + 3)
      stopParsing = true
      index += 2
      continue
    }
    if (char === "<" && input[index + 1] === "#" && !started) {
      const end = powerShellComment(input, index)
      if (end === undefined) return { kind: "opaque", reason: "invalid-structure" }
      if (!words.length && !invocation) segment = end + 1
      index = end
      continue
    }
    if (char === "#" && (!started || expression)) {
      if (words.length || started || invocation) finishCommand(index)
      statementHead = !dangling
      comment = true
      const endings = [input.indexOf("\n", index), input.indexOf("\r", index)].filter((ending) => ending >= 0)
      const newline = endings.length > 0 ? Math.min(...endings) : -1
      if (newline === -1) break
      comment = false
      index = input[newline] === "\r" && input[newline + 1] === "\n" ? newline + 1 : newline
      segment = index + 1
      continue
    }
    const redirect =
      !started && (char === ">" || char === "*" || /\d/.test(char)) ? powerShellRedirect(input, index) : undefined
    if (redirect === false) return { kind: "opaque", reason: "invalid-redirect" }
    if (redirect) {
      if (redirectTarget) return { kind: "opaque", reason: "invalid-redirect" }
      if (words.length === 0) return { kind: "opaque", reason: "invalid-redirect" }
      redirectTarget = !redirect.includes("&")
      index += redirect.length - 1
      commandEnd = index + 1
      continue
    }
    if (!started && !words.length && !invocation && !expression && /[A-Za-z]/.test(char)) {
      const keyword = /^[A-Za-z]+(?=$|[\s({])/.exec(input.slice(index))?.[0]?.toLowerCase()
      if (
        keyword &&
        /^(?:if|elseif|else|for|while|do|until|switch|function|filter|try|catch|finally|begin|process|end|clean|param|trap|class|enum|data|dynamicparam|using)$/.test(
          keyword,
        )
      ) {
        expression = true
        compound = true
        index += keyword.length - 1
        continue
      }
      if (keyword === "foreach" && /^foreach\s*\(/i.test(input.slice(index))) {
        expression = true
        compound = true
        index += keyword.length - 1
        continue
      }
      if (keyword && /^(?:return|throw|exit|break|continue)$/.test(keyword)) {
        index += keyword.length - 1
        segment = index + 1
        continue
      }
    }
    if (expression && !compound && (char === "=" || (/[-+*/%]/.test(char) && input[index + 1] === "="))) {
      finishWord(index)
      words.length = 0
      rawWords.length = 0
      wordEnds.length = 0
      expression = false
      if (char !== "=") index++
      segment = index + 1
      continue
    }
    if (expression && !started && /^in\b/i.test(input.slice(index))) {
      words.length = 0
      rawWords.length = 0
      wordEnds.length = 0
      expression = false
      index++
      segment = index + 1
      continue
    }
    if (char === "@" && /['"]/.test(input[index + 1] ?? "")) {
      const literal = powerShellHereString(input, index)
      if (!literal) return { kind: "opaque", reason: "unterminated-quote" }
      if (!words.length && !invocation) expression = true
      if (input[index + 1] === '"') {
        const result = powerShellExpansions(literal.source, depth + 1, budget)
        if (result.kind === "opaque") return result
        nestedCommands.push(...result.commands)
      }
      word = literal.source
      started = true
      index = literal.end
      finishWord(index + 1)
      continue
    }
    if (char === "$" && input[index + 1] === "{") {
      const end = input.indexOf("}", index + 2)
      if (end < 0) return { kind: "opaque", reason: "invalid-structure" }
      if (!started && !words.length && !invocation) expression = true
      word += input.slice(index, end + 1)
      started = true
      index = end
      continue
    }
    const opener =
      (char === "$" || char === "@") && input[index + 1] === "("
        ? index + 1
        : char === "@" && input[index + 1] === "{"
          ? index + 1
          : char === "(" || char === "{" || (char === "[" && (expression || !started))
            ? index
            : undefined
    if (opener !== undefined) {
      if (started && (char === "{" || char === "(")) {
        finishWord(index)
        wordStart = index
      }
      if (!started && !words.length && !invocation) expression = true
      const block = powerShellBlock(input, opener, depth)
      if (!block) return { kind: "opaque", reason: "invalid-structure" }
      const result = scanPowerShellNested(
        block.source,
        depth + 1,
        budget,
        input[opener] === "[" || (char === "@" && input[opener] === "{"),
      )
      if (result.kind === "opaque") return result
      nestedCommands.push(...result.commands)
      started = true
      word += input.slice(index, block.end + 1)
      index = block.end
      if (input[opener] === "{" || char === "(") finishWord(index + 1)
      if (compound && input[opener] === "{") {
        finishCommand(index + 1)
        segment = index + 1
      }
      continue
    }
    if (char === "}" || char === ")") return { kind: "opaque", reason: "invalid-structure" }
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
    if (!started && !words.length && !invocation && powerShellExpression(input.slice(index))) expression = true
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
      if (
        (separator === "\n" || separator === "\r" || separator === "\r\n") &&
        !started &&
        !words.length &&
        !invocation
      ) {
        index += separator.length - 1
        segment = index + 1
        continue
      }
      finishCommand(index, dangling || ![";", "\n", "\r", "\r\n"].includes(separator))
      dangling = ![";", "&", "\n", "\r", "\r\n"].includes(separator)
      statementHead = !dangling
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
  if (commands.some((command) => !command.words[0])) return { kind: "opaque", reason: "dynamic-command-name" }
  return { kind: "scanned", commands }
}

function powerShellBlock(input: string, start: number, depth: number): { source: string; end: number } | undefined {
  if (depth >= MAX_SUBSTITUTION_DEPTH) return
  let quote: "single" | "double" | undefined
  let standalone = false
  let started = false
  let head = true
  let expression = false
  let token = ""
  const close = input[start] === "(" ? ")" : input[start] === "[" ? "]" : "}"
  for (let index = start + 1; index < input.length; index++) {
    const char = input[index]
    if (quote === "single") {
      if (char === "'" && input[index + 1] === "'") {
        token += "'"
        index++
      } else if (char === "'") {
        quote = undefined
        started = !standalone
        if (standalone) token = ""
      } else token += char
      continue
    }
    if (quote === "double") {
      if (char === "`") {
        const escape = powerShellEscape(input, index)
        if (!escape) return
        token += escape.value
        index = escape.end
      } else if (char === '"' && input[index + 1] === '"') {
        token += '"'
        index++
      } else if (char === '"') {
        quote = undefined
        started = !standalone
        if (standalone) token = ""
      } else if (char === "$" && input[index + 1] === "(") {
        const nested = powerShellBlock(input, index + 1, depth + 1)
        if (!nested) return
        index = nested.end
      } else token += char
      continue
    }
    if (char === "`") {
      const escape = powerShellEscape(input, index)
      if (!escape) return
      if (started || /\S/.test(escape.value)) {
        started = true
        token += escape.value
      }
      index = escape.end
      continue
    }
    if (char === "<" && input[index + 1] === "#" && !started) {
      const end = powerShellComment(input, index)
      if (end === undefined) return
      index = end
      continue
    }
    if (char === "#" && (!started || expression)) {
      const endings = [input.indexOf("\n", index), input.indexOf("\r", index)].filter((ending) => ending >= 0)
      const newline = endings.length > 0 ? Math.min(...endings) : -1
      if (newline < 0) return
      index = newline
      started = false
      head = true
      expression = false
      token = ""
      continue
    }
    if (char === "@" && /['"]/.test(input[index + 1] ?? "")) {
      const literal = powerShellHereString(input, index)
      if (!literal) return
      index = literal.end
      started = false
      head = false
      continue
    }
    if (
      head &&
      !started &&
      ((char === "&" && input[index + 1] !== "&") || (char === "." && /\s/.test(input[index + 1] ?? "")))
    ) {
      head = false
      continue
    }
    if (expression && (char === "=" || (!started && /^in\b/i.test(input.slice(index))))) {
      if (char !== "=") index++
      expression = false
      head = true
      started = false
      token = ""
      continue
    }
    if (char === "'" || char === '"') {
      quote = char === "'" ? "single" : "double"
      standalone = !started
      if (head && !started) expression = true
      started = true
      continue
    }
    const redirect =
      !started && (char === ">" || char === "*" || /\d/.test(char)) ? powerShellRedirect(input, index) : undefined
    if (redirect === false) return
    if (redirect) {
      index += redirect.length - 1
      token = ""
      continue
    }
    if (char === "$" && input[index + 1] === "{") {
      const end = input.indexOf("}", index + 2)
      if (end < 0) return
      if (head && !started) expression = true
      index = end
      started = true
      continue
    }
    if (!started && !head && !expression && /^--%(?=$|[\s;|&(){}])/.test(input.slice(index))) {
      index = powerShellStopParsing(input, index + 3) - 1
      continue
    }
    if (char === close) return { source: input.slice(start + 1, index), end: index }
    if (char === "(" || char === "{" || (char === "[" && (!started || expression))) {
      if (head && !started) expression = true
      const nested = powerShellBlock(input, index, depth + 1)
      if (!nested) return
      index = nested.end
      started = false
      head = false
      token = ""
      continue
    }
    if (/[\s;&|]/.test(char)) {
      if (token === "--%" && !expression) {
        index = powerShellStopParsing(input, index) - 1
        token = ""
        continue
      }
      if (/[;&|\r\n]/.test(char)) {
        head = true
        expression = false
      } else if (started) head = false
      started = false
      token = ""
      continue
    }
    if (head && !started && powerShellExpression(input.slice(index))) expression = true
    started = true
    token += char
  }
}

const POWERSHELL_ESCAPES: Record<string, string> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  e: "\x1b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
}

function powerShellEscape(input: string, start: number) {
  const char = input[start + 1]
  if (char === undefined) return
  if (char === "\r" || char === "\n")
    return {
      value: char === "\r" && input[start + 2] === "\n" ? "\r\n" : char,
      end: start + (char === "\r" && input[start + 2] === "\n" ? 2 : 1),
    }
  if (char === "u" && input[start + 2] === "{") {
    const code = /^u\{([0-9a-f]{1,6})\}/i.exec(input.slice(start + 1))
    if (!code || Number.parseInt(code[1], 16) > 0x10ffff) return
    return { value: String.fromCodePoint(Number.parseInt(code[1], 16)), end: start + code[0].length }
  }
  return { value: POWERSHELL_ESCAPES[char] ?? char, end: start + 1 }
}

function powerShellExpression(input: string) {
  return /^(?:[$!,+]|[+-]?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?(?:[dDlLnNuU]|[kKmMgGtTpP][bB])?(?![\w'"`])|0[xX][\da-fA-F]+\b|0[bB][01]+\b|\.[0-9]|-(?:not|bnot|join|split)\b)/i.test(
    input,
  )
}

function powerShellStopParsing(input: string, start: number) {
  let quoted = false
  for (let index = start; index < input.length; index++) {
    if (input[index] === '"') quoted = !quoted
    if (input[index] === "\r" || input[index] === "\n" || (input[index] === "|" && !quoted)) return index
  }
  return input.length
}

function powerShellComment(input: string, start: number) {
  const end = input.indexOf("#>", start + 2)
  return end < 0 ? undefined : end + 1
}

function powerShellHereString(input: string, start: number) {
  const header = /^@['"][ \t]*(?:\r\n|\r|\n)/.exec(input.slice(start))
  if (!header) return
  const body = start + header[0].length
  for (let index = body; index < input.length; index++) {
    if (index !== body && input[index - 1] !== "\r" && input[index - 1] !== "\n") continue
    if (input[index] !== input[start + 1] || input[index + 1] !== "@") continue
    const end =
      index > body && input[index - 1] === "\n" && input[index - 2] === "\r"
        ? index - 2
        : index > body
          ? index - 1
          : index
    return { source: input.slice(body, end), end: index + 1 }
  }
}

function powerShellExpansions(input: string, depth: number, budget: { remaining: number }): Result {
  const commands: Command[] = []
  for (let index = 0; index < input.length; index++) {
    if (input[index] === "`") {
      index++
      continue
    }
    if (!input.startsWith("$(", index)) continue
    const block = powerShellBlock(input, index + 1, depth)
    if (!block) return { kind: "opaque", reason: "invalid-structure" }
    const result = scanPowerShellNested(block.source, depth + 1, budget)
    if (result.kind === "opaque") return result
    commands.push(...result.commands)
    index = block.end
  }
  return { kind: "scanned", commands }
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

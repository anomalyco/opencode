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
  // Executable offset within resource for assignment-prefixed commands.
  commandOffset?: number
  statementHead?: true
  declaration?: true
  // Words after a trailing redirect are destinations in the legacy command span.
  redirectWordCount?: number
}

// Opaque describes a parsing limitation, not a permission decision.
export type Result = { kind: "scanned"; commands: Command[] } | { kind: "opaque"; reason: OpaqueReason }

const BASH_REDIRECTS = ["&>>", "&>", "<<<", "<<-", "<<", "<>", "<&", ">&", ">|", ">>", ">", "<"]
const BASH_LIST_OPERATORS = ["&&", "||", "|&"]
const BASH_CASE_OPERATORS = [";;&", ";;", ";&", ";|", ...BASH_LIST_OPERATORS]
// Builtins that bind their operands to variables or evaluate them as variable names.
const BASH_BINDING_BUILTINS = new Set([
  "declare",
  "typeset",
  "local",
  "export",
  "readonly",
  "private",
  "unset",
  "read",
  "getln",
  "vared",
  "getopts",
  "mapfile",
  "readarray",
  "compgen",
  "zparseopts",
  "zregexparse",
  "zformat",
  "zstyle",
  "zstat",
  "stat",
])
const BASH_ARITHMETIC_COMPARISONS = new Set(["-eq", "-ne", "-lt", "-le", "-gt", "-ge"])
const BASH_EXPANSION_RE = /\$(?:\\.|\\\n)*[({]|`/
const BASH_ESCAPE_RE = /\\(?:x[\da-fA-F]{1,2}|[0-7]{1,3}|u[\da-fA-F]{1,4}|U[\da-fA-F]{1,8})/
const BASH_ASSIGNMENT_DECLARATIONS = new Set(["declare", "typeset", "export", "readonly", "local"])
const BASH_DECLARATIONS = new Set([...BASH_ASSIGNMENT_DECLARATIONS, "unset", "unsetenv"])
const BASH_PRECOMMANDS = new Set(["builtin", "command", "time", "coproc", "!"])
const ZSH_PRECOMMANDS = new Set(["noglob", "nocorrect", "exec", "-"])
const ZSH_ARITHMETIC_BUILTINS = new Set([
  "integer",
  "float",
  "exit",
  "return",
  "shift",
  "break",
  "continue",
  "bye",
  "logout",
])
const BASH_NON_FUNCTION_KEYWORDS = new Set([
  "if",
  "for",
  "select",
  "case",
  "then",
  "elif",
  "else",
  "fi",
  "do",
  "done",
  "in",
  "esac",
])
// Characters that can begin a quoting or expansion unit.
const BASH_UNIT_STARTS = "\\$'\"`<>"
const MAX_INPUT_LENGTH = 64 * 1024
const MAX_SUBSTITUTION_DEPTH = 32
const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*(?=(?:\\\n)*(?:[ \t\n;|&()<>]|$))/y
const BRACE_CLOSE_AHEAD_RE = /(?:\\\n)*(?:[ \t\n;&|()<>]|$)/y
const SPACE_CONTINUATION_AHEAD_RE = /(?:\\\n)*[ \t\n]/y
const NEGATION_AHEAD_RE = /(?:\\\n)*[ \t\n(]/y
const COPROC_AHEAD_RE =
  /coproc(?:[ \t]|\\\n)+(?:--(?:[ \t]|\\\n)+)?(?:[A-Za-z_][A-Za-z0-9_]*(?:[ \t]|\\\n)+)?(?=(?:!(?:[ \t]|\\\n)*)*(?:[{(]|\[\[(?:\\\n)*[ \t\n]|(?:if|while|until|for|select|case|repeat)\b))/y
const TIME_AHEAD_RE =
  /time(?:[ \t]|\\\n)+(?:-p(?:[ \t]|\\\n)+)?(?:--(?:[ \t]|\\\n)+)?(?=(?:!(?:[ \t]|\\\n)*)*(?:[{(]|\[\[(?:\\\n)*[ \t\n]|(?:if|while|until|for|select|case|repeat)\b))/y
// [function] name [()] then blanks, continuations, and comments before the body.
const FUNCTION_HEAD_RE =
  /(function[ \t](?:[ \t]|\\\n)*)?([A-Za-z_][\w.:+@%-]*)?(?:[ \t]|\\\n)*(\([ \t]*\))?((?:[ \t\n]|\\\n|#[^\n]*\n)*)/y
const FUNCTION_BODY_RE =
  /[{(]|\[\[(?=(?:\\\n)*[ \t\n])|(?:if|while|until|for|select|case|repeat)(?=(?:\\\n)*(?:[ \t\n(]|$))/y
const DO_AHEAD_RE = /(?:[ \t\n;]|\\\n|#[^\n]*(?:\n|$))*(?:do(?=(?:\\\n)*(?:[ \t\n;{(]|$))|\{(?=(?:\\\n)*[ \t\n]))/y
const NOFORK_OPEN_RE = /\$\{(?:\\\n)*(?:[ \t\n]|\|)/y
// Zsh flags that neither evaluate nor glob a value; s and j take an argument between repeated delimiters.
const ZSH_SAFE_FLAGS_RE = /\$\{\((?:[@AaBbCcDEfFikLMmNnOopqStUuVvWwXZz0-]|q[-+]?|[js]([^({[<\\])(?:(?!\1)[^)])*\1)*\)/y
const ZSH_GLOB_MODIFIER_RE = /(?:[\^=~#+]|\\\n)*~/y
const ZSH_SUBSCRIPT_RE = /\$(?:[\^=+~#]|\\\n)*(?:[A-Za-z_](?:[A-Za-z0-9_]|\\\n)*|[@*#?$!0-9-])(?:\\\n)*\[/y
const LINE_CONTINUATION_RE = /(?:\\\n)*/y
const PARAMETER_PREFIX_RE = /(?:\\\n)*(?:\([^)]*\))?(?:[!#^=+~]|\\\n)*/y
const PARAMETER_NAME_RE = /(?:[A-Za-z_](?:[A-Za-z0-9_]|\\\n)*|\d(?:\d|\\\n)*|[@*#?$!-])(?:\\\n)*/y
const PARAMETER_PROMPT_RE = /@(?:\\\n)*[EP](?:\\\n)*\}/y
const BASH_ANSI_ESCAPES: Record<string, string> = {
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

type Opaque = { kind: "opaque"; reason: OpaqueReason }

type BashResult = { kind: "scanned"; commands: Command[]; end: number } | Opaque

// Shared across one scan: the work budget, the shell dialect, and whether a bound expansion reaches a variable sink.
type BashContext = {
  remaining: number
  dialect: Dialect
  boundDollar?: boolean
  boundOpen?: boolean
  variableSink?: boolean
}

type BashHeredoc = {
  delimiter: string
  dashDelimiter?: string
  quoted: boolean
  tabs: boolean
  binding?: boolean
  command?: Command
  start?: number
}

type BashState = {
  input: string
  context: BashContext
  commands: Command[]
  nestedCommands: Command[]
  words: string[]
  rawWords: string[]
  // Pending heredocs, shared with nested groups: a body starts after the next newline token at any nesting.
  heredocs: BashHeredoc[]
  structures: Array<{
    kind: "if" | "while" | "until" | "for" | "case" | "repeat"
    phase: "header" | "condition" | "pattern" | "body" | "do"
    count: number
    sawElse?: boolean
    sawIn?: boolean
    patternStarted?: boolean
    parenthesized?: boolean
  }>
  word: string
  literal: string
  output: string
  wordStarted: boolean
  wordStart: number
  wordEnd: number
  commandStart: number | undefined
  executableStart: number | undefined
  commandEnd: number
  resourceEnd: number | undefined
  redirectWordCount: number | undefined
  // Posix shells such as Dash read `&>` as `&` and `>`, so later words would start another command there.
  ampersandRedirectWords: number | undefined
  commandWordIndex: number
  assignmentWord: boolean
  assignmentHeadUnsafe: boolean
  invalid: OpaqueReason | undefined
  redirectTarget: boolean
  hereString: boolean
  hasRedirect: boolean
  compoundEnd: boolean
  // A list operator (&&, ||, |, |&) still awaits its right-hand command.
  dangling: boolean
  // Receives each word's literal text when the list is a command substitution, whose output it stands in for.
  outer: BashText | undefined
}

// A word's cooked text, the literal text it decodes to apart from its expansions, and the literal text of its
// command substitutions' words, which stands in for their output.
type BashText = { word: string; literal: string; output: string }

// Arithmetic text, a builtin operand that names or binds a variable now, or a value bound for later.
type BashEvaluation = "arithmetic" | "binding" | "deferred"

// Bash and Zsh name those shells. Posix covers sh, dash, and any other shell, and stays sound for Bash, Zsh, and
// Dash alike, so it is the default.
export type Dialect = "bash" | "zsh" | "posix"

export function scan(input: string, dialect: Dialect = "posix"): Result {
  if (input.length > MAX_INPUT_LENGTH) return { kind: "opaque", reason: "invalid-structure" }
  const context: BashContext = { remaining: MAX_INPUT_LENGTH * MAX_SUBSTITUTION_DEPTH, dialect }
  const result = scanBash(input, 0, 0, context)
  if (result.kind === "opaque") return result
  if (context.boundDollar && context.boundOpen && context.variableSink)
    return { kind: "opaque", reason: "dynamic-execution" }
  return { kind: "scanned", commands: result.commands }
}

function bashStatement(state: BashState) {
  const structure = state.structures.at(-1)
  if (structure) structure.count++
}

function bashInHeader(state: BashState) {
  const phase = state.structures.at(-1)?.phase
  return phase === "header" || phase === "pattern" || phase === "do"
}

function atCommandStart(state: BashState) {
  return !state.words.length && !state.hasRedirect && !state.compoundEnd && !bashInHeader(state)
}

function pending(state: BashState) {
  return state.wordStarted || state.words.length > 0 || state.hasRedirect || state.compoundEnd
}

// Ends the current list; false when an operator still awaits its command.
function endBashList(state: BashState) {
  if (pending(state)) finishBashCommand(state)
  return !state.dangling
}

function closeBashList(state: BashState, end: number): BashResult {
  if (!endBashList(state)) return { kind: "opaque", reason: "invalid-structure" }
  if (state.invalid) return { kind: "opaque", reason: state.invalid }
  if (state.structures.length) return { kind: "opaque", reason: "compound-command" }
  return { kind: "scanned", commands: state.commands, end }
}

function finishBashWord(state: BashState) {
  if (!state.wordStarted) return
  if (/PS4/.test(state.word)) state.context.variableSink = true
  const evaluation = bashWordEvaluation(state)
  if (
    state.context.dialect !== "bash" &&
    (/(?:READ)?NULLCMD/.test(state.word) ||
      ((state.assignmentWord || evaluation === "binding") &&
        /^(?:-[A-Za-z]*v)?(?:(?:dis_)?(?:functions|[gs]?aliases)|options|commands)(?:\+?=|\[|$)/.test(state.word)))
  )
    state.invalid ??= "dynamic-execution"
  if (evaluation && bashEvaluatesExpansion(state, evaluation, state.context)) state.invalid ??= "dynamic-execution"
  if (state.outer) state.outer.output += ` ${state.literal} ${state.output}`
  const structure = state.structures.at(-1)
  const repeatHeader = structure?.kind === "repeat" && structure.phase === "header"
  if (!state.redirectTarget && repeatHeader) structure.phase = "do"
  if (!state.redirectTarget && !repeatHeader) {
    if (!state.assignmentWord && state.commandWordIndex < 0) {
      state.commandWordIndex = state.words.length
      state.executableStart = state.wordStart
    }
    state.commandStart ??= state.wordStart
    state.words.push(state.word)
    // Unquoted trailing continuations are ignored syntax, not part of the raw token.
    state.rawWords.push(state.input.slice(state.wordStart, state.wordEnd))
    state.commandEnd = state.wordEnd
  }
  state.redirectTarget = false
  state.hereString = false
  state.word = ""
  state.literal = ""
  state.output = ""
  state.wordStarted = false
  state.assignmentWord = false
  state.assignmentHeadUnsafe = false
}

// How the shell evaluates the current word's literal text: as arithmetic, or as a value it binds to a variable
// that a later $((name)) may evaluate.
function bashWordEvaluation(state: BashState): BashEvaluation | undefined {
  if (state.redirectTarget) return state.hereString ? "deferred" : undefined
  const structure = state.structures.at(-1)
  if (structure?.kind === "repeat" && structure.phase === "header") return "arithmetic"
  if (structure?.kind === "for" && structure.phase === "header" && structure.sawIn) return "deferred"
  if (state.commandWordIndex < 0) return state.assignmentWord ? "deferred" : undefined
  const name = bashBuiltinIndex(state)
  const command = state.words[name]
  if (command === undefined) return undefined
  if (command === "let" || (state.context.dialect !== "bash" && ZSH_ARITHMETIC_BUILTINS.has(command)))
    return "arithmetic"
  if (command === "set")
    return state.words.slice(name + 1).some((word) => /^[-+][A-Za-z0-9]*A/.test(word)) ? "binding" : "deferred"
  if (BASH_BINDING_BUILTINS.has(command)) {
    const options = state.words.slice(name + 1)
    if (options.some((word) => word.startsWith("-") && /[EFin]/.test(word))) return "arithmetic"
    // A plain `name=value` declaration without options binds a scalar unless Bash re-parses an existing array.
    if (
      state.assignmentWord &&
      BASH_ASSIGNMENT_DECLARATIONS.has(command) &&
      options.every((word) => !word.startsWith("-")) &&
      (command === "export" ||
        command === "readonly" ||
        state.context.dialect === "zsh" ||
        !/\+?=(?:\(|[$`])/.test(state.word))
    )
      return "deferred"
    return "binding"
  }
  if (command === "printf" || command === "print") {
    const options = [...state.words.slice(name + 1), state.word]
    const flag = command === "print" ? /^-[A-Za-z]*v/ : /^-v/
    return options.some((word) => flag.test(word)) ? "binding" : undefined
  }
  if (command === "wait")
    return /^-[nf]*p/.test(state.word) || /^-[nf]*p$/.test(state.words.at(-1) ?? "") ? "binding" : undefined
  if (command === "test" || command === "[") {
    if (state.words.at(-1) === "-v") return "binding"
    if (state.context.dialect !== "bash" && state.words.at(-1) === "-t") return "arithmetic"
  }
  return undefined
}

// Index of the word naming the builtin that runs, skipping precommand wrappers and their options.
function bashBuiltinIndex(state: BashState) {
  let name = state.commandWordIndex
  while (
    BASH_PRECOMMANDS.has(state.words[name] ?? "") ||
    (state.context.dialect !== "bash" && ZSH_PRECOMMANDS.has(state.words[name] ?? ""))
  ) {
    const precommand = state.words[name++]
    while (precommand !== "-" && state.words[name]?.startsWith("-")) {
      if (precommand === "exec" && /^-[cl]*a$/.test(state.words[name])) name++
      name++
    }
  }
  return name
}

function finishBashCommand(state: BashState, boundary = false) {
  finishBashWord(state)
  if (state.redirectTarget) state.invalid ??= "invalid-redirect"
  state.redirectTarget = false
  if (state.compoundEnd && state.words.length > 0) state.invalid ??= "invalid-structure"
  const name = state.commandWordIndex
  const inHeader = bashInHeader(state)
  if (name >= 0 && !state.words[name]) state.invalid ??= "invalid-structure"
  if (name >= 0 && !inHeader) {
    const raw = state.input.slice(state.commandStart, state.resourceEnd ?? state.wordEnd)
    const resource = raw.replace(/^[ \t\n]+|[ \t\n]+$/g, "")
    const offset =
      state.executableStart === undefined || state.commandStart === undefined
        ? 0
        : state.executableStart - (state.commandStart + (/^[ \t\n]*/.exec(raw)?.[0].length ?? 0))
    const command: Command = {
      resource,
      words: state.words.slice(name),
      rawWords: state.rawWords.slice(name),
      ...(name > 0 && offset > 0 && offset <= resource.length ? { commandOffset: offset } : {}),
      ...(name === 0 && BASH_DECLARATIONS.has(state.rawWords[0]) && resource.startsWith(state.rawWords[0])
        ? { declaration: true as const }
        : {}),
      ...(state.redirectWordCount !== undefined && state.redirectWordCount < state.words.length
        ? { redirectWordCount: state.redirectWordCount - name }
        : {}),
    }
    state.commands.push(command)
    const builtin = bashBuiltinIndex(state)
    const builtinName = state.words[builtin]
    const builtinArgs = state.words.slice(builtin + 1)
    if (builtinName === "eval") state.context.variableSink = true
    if (builtinName === "set" && builtinArgs.some((word) => /^-[A-Za-z0-9]*k/.test(word) || word === "keyword"))
      state.invalid ??= "dynamic-execution"
    // Dash expands an alias defined earlier in the same script, which can name any command.
    if (builtinName === "alias" && builtinArgs.some((word) => word.includes("="))) state.invalid ??= "dynamic-execution"
    // Zsh options such as globsubst, kshglob, and promptsubst enable evaluation on expansions and print -P.
    if (
      state.context.dialect !== "bash" &&
      (builtinName === "emulate" ||
        ((builtinName === "setopt" ||
          builtinName === "unsetopt" ||
          (builtinName === "set" && builtinArgs.some((word) => /^[-+][A-Za-z0-9]*o/.test(word)))) &&
          builtinArgs.some(
            (word) =>
              /^-[A-Za-z0-9]*m/.test(word) ||
              /^(?:no)?(?:globsubst|kshglob|promptsubst|promptvars|aliases)$/.test(
                word
                  .replace(/^[-+][A-Za-z0-9]*?o/i, "")
                  .toLowerCase()
                  .replace(/[_-]/g, ""),
              ),
          )))
    )
      state.invalid ??= "dynamic-execution"
    // Bash compgen -C and -F execute their argument immediately to generate completions.
    if (
      state.context.dialect !== "zsh" &&
      builtinName === "compgen" &&
      builtinArgs.some((word) => word.startsWith("-") && /[CF]/.test(word))
    )
      state.invalid ??= "dynamic-execution"
    if (BASH_BINDING_BUILTINS.has(builtinName ?? "")) {
      for (const heredoc of state.heredocs) heredoc.binding ??= true
    }
    if (state.resourceEnd === undefined) {
      for (const heredoc of state.heredocs) {
        if (heredoc.command) continue
        heredoc.command = command
        heredoc.start = state.commandStart
      }
    }
  }
  if (boundary && !state.words.length && !state.hasRedirect && !state.compoundEnd && !inHeader)
    state.invalid ??= "invalid-structure"
  if (state.words.length > (state.ampersandRedirectWords ?? Infinity)) state.invalid ??= "invalid-redirect"
  state.commands.push(...state.nestedCommands.splice(0))
  if (!inHeader && (state.words.length > 0 || state.hasRedirect)) bashStatement(state)
  state.words.length = 0
  state.rawWords.length = 0
  state.commandWordIndex = -1
  state.commandStart = undefined
  state.executableStart = undefined
  state.hasRedirect = false
  state.resourceEnd = undefined
  state.redirectWordCount = undefined
  state.ampersandRedirectWords = undefined
  state.compoundEnd = false
  state.dangling = false
}

function scanBash(
  input: string,
  start: number,
  depth: number,
  context: BashContext,
  close?: ")" | "}" | "nofork",
  // A group shares its parent's heredocs; a substitution starts its own.
  heredocs?: BashHeredoc[],
  outer?: BashText,
): BashResult {
  if (depth > MAX_SUBSTITUTION_DEPTH || context.remaining < 0) return { kind: "opaque", reason: "invalid-structure" }
  const state: BashState = {
    input,
    context,
    commands: [],
    nestedCommands: [],
    words: [],
    rawWords: [],
    heredocs: heredocs ?? [],
    structures: [],
    word: "",
    literal: "",
    output: "",
    wordStarted: false,
    wordStart: start,
    wordEnd: start,
    commandStart: undefined,
    executableStart: undefined,
    commandEnd: start,
    resourceEnd: undefined,
    redirectWordCount: undefined,
    ampersandRedirectWords: undefined,
    commandWordIndex: -1,
    assignmentWord: false,
    assignmentHeadUnsafe: false,
    invalid: undefined,
    redirectTarget: false,
    hereString: false,
    hasRedirect: false,
    compoundEnd: false,
    dangling: false,
    outer,
  }
  for (let index = start; index < input.length; index++) {
    if (--context.remaining < 0) return { kind: "opaque", reason: "invalid-structure" }
    const char = input[index]
    // Line continuations are removed before tokens are read.
    if (char === "\\" && input[index + 1] === "\n") {
      index++
      continue
    }
    if (!state.wordStarted) {
      state.wordStart = index
      if (char === " " || char === "\t") continue
      if (
        char === "}" &&
        state.words.length === 0 &&
        !state.redirectTarget &&
        (close === "}" || close === "nofork") &&
        state.structures.length === 0 &&
        (heredocs !== undefined || state.heredocs.length === 0) &&
        (close === "nofork" || ((BRACE_CLOSE_AHEAD_RE.lastIndex = index + 1), BRACE_CLOSE_AHEAD_RE.test(input)))
      )
        return closeBashList(state, index)
      if (char === "}")
        return { kind: "opaque", reason: state.structures.length ? "compound-command" : "invalid-structure" }
      const step = scanBashCommandStart(state, index, depth, context)
      if (typeof step === "object") return step
      if (step !== undefined) {
        index = step
        continue
      }
    }
    if (char === "\\" && index + 1 >= input.length) return { kind: "opaque", reason: "unterminated-escape" }
    if (
      !state.assignmentWord &&
      ("'\"\\".includes(char) || (char === "$" && (input[index + 1] === "'" || input[index + 1] === '"')))
    )
      state.assignmentHeadUnsafe = true
    const inCasePattern = state.structures.at(-1)?.phase === "pattern"
    // Elsewhere a parenthesized group inside a word is a Zsh glob qualifier, which can run code.
    const array =
      (char === "=" || char === "(") &&
      state.assignmentWord &&
      state.word.length > 1 &&
      state.word.endsWith("=") &&
      !state.word.endsWith("==") &&
      (state.commandWordIndex < 0 || BASH_ASSIGNMENT_DECLARATIONS.has(state.rawWords[state.commandWordIndex]))
    if (char === "=" && (!state.wordStarted || array) && input[index + 1] === "(") {
      const end = scanBashNested(input, index + 2, depth, context, state.nestedCommands, ")")
      if (typeof end === "object") return end
      state.wordStarted = true
      state.word += input.slice(index, end + 1)
      index = end
      state.wordEnd = index + 1
      continue
    }
    const unit = BASH_UNIT_STARTS.includes(char)
      ? scanBashUnit(
          input,
          index,
          depth,
          context,
          state.nestedCommands,
          "word",
          !state.assignmentWord && state.commandWordIndex >= 0 && !BASH_DECLARATIONS.has(state.rawWords[0]),
          state,
        )
      : undefined
    if (typeof unit === "object") return unit
    if (unit !== undefined) {
      state.wordStarted = true
      index = unit
      state.wordEnd = index + 1
      continue
    }
    if (
      char === "[" &&
      !inCasePattern &&
      !state.assignmentWord &&
      !state.assignmentHeadUnsafe &&
      state.commandWordIndex < 0 &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(state.word)
    ) {
      const subscript: Command[] = []
      const end = scanBashSubscript(input, index + 1, depth, context, subscript, BASH_SPANS.assignmentSubscript)
      if (typeof end === "object") return end
      const assign = bashOperator(input, end + 1, ["+=", "="])
      if (typeof assign === "object") return assign
      if (assign) {
        // Dash has no arrays and word-splits unquoted expansions inside `name[subscript]=value`.
        if (context.dialect === "posix" && /[$`]/.test(input.slice(index + 1, end)))
          return { kind: "opaque", reason: "invalid-structure" }
        state.nestedCommands.push(...subscript)
        state.assignmentWord = true
        state.word += input.slice(index, end + 1)
        index = end
        state.wordEnd = index + 1
        continue
      }
    }
    if (char === "(" && (array || ((inCasePattern || context.dialect === "bash") && /[?*+@!]$/.test(state.word)))) {
      const mode = array ? "array" : "pattern"
      const end = scanBashArrayOrPattern(input, index, depth + 1, context, state.nestedCommands, mode)
      if (typeof end === "object") return end
      if (bashCrossesHeredoc(state, index, end)) return { kind: "opaque", reason: "heredoc" }
      // Zsh ends an array assignment at its closing parenthesis, so text right after it starts a command.
      if (array && end + 1 < input.length && !" \t\n;&|<>)".includes(input[end + 1]))
        return { kind: "opaque", reason: "invalid-structure" }
      state.wordStarted = true
      state.word += input.slice(index, end + 1)
      index = end
      state.wordEnd = index + 1
      continue
    }
    if (char === "#" && !state.wordStarted) {
      const newline = input.indexOf("\n", index)
      if (newline === -1) break
      index = newline - 1
      continue
    }
    if ("<>&|;\n".includes(char)) {
      const step = scanBashOperatorOrSeparator(state, index, depth, context)
      if (typeof step === "object") return step
      index = step
      continue
    }
    if (inCasePattern && char === ")") {
      finishBashWord(state)
      index--
      continue
    }
    if (char === ")") {
      if (close !== ")" || state.structures.length > 0 || (heredocs === undefined && state.heredocs.length > 0))
        return { kind: "opaque", reason: "compound-command" }
      return closeBashList(state, index)
    }
    if (char === "(") return { kind: "opaque", reason: state.wordStarted ? "dynamic-execution" : "compound-command" }
    if (/\s/.test(char) && !" \t\n".includes(char)) return { kind: "opaque", reason: "invalid-structure" }
    if (char === " " || char === "\t") {
      finishBashWord(state)
      continue
    }
    state.wordStarted = true
    if (
      char === "=" &&
      !state.assignmentWord &&
      !state.assignmentHeadUnsafe &&
      /^[A-Za-z_][A-Za-z0-9_]*\+?$/.test(state.word)
    )
      state.assignmentWord = true
    bashAppend(state, char)
    state.wordEnd = index + 1
  }

  if (close) return { kind: "opaque", reason: close === ")" ? "command-substitution" : "invalid-structure" }
  if (state.heredocs.length) return { kind: "opaque", reason: "heredoc" }
  return closeBashList(state, input.length)
}

// Steps return the last consumed index.
function scanBashOperatorOrSeparator(
  state: BashState,
  index: number,
  depth: number,
  context: BashContext,
): number | Opaque {
  const input = state.input
  const char = input[index]
  const redirect = "<>&".includes(char) ? bashOperator(input, index, BASH_REDIRECTS) : undefined
  if (typeof redirect === "object") return redirect
  const caseHead = state.structures.at(-1)
  if (redirect && caseHead?.kind === "case" && caseHead.phase !== "body")
    return { kind: "opaque", reason: "invalid-redirect" }
  if (redirect) {
    state.hasRedirect = true
    state.commandStart ??= state.wordStart
    if (state.redirectTarget) state.invalid ??= "invalid-redirect"
    const fdPrefix =
      state.wordStarted && !state.assignmentHeadUnsafe && /^(?:\d+|\{[A-Za-z_][A-Za-z0-9_]*\})$/.test(state.word)
    if (fdPrefix) {
      // A continuation separates the legacy number token from the redirect descriptor.
      if (state.wordEnd < index) state.commandEnd = state.wordEnd
      state.word = ""
      state.literal = ""
      state.output = ""
      state.wordStarted = false
    }
    if (!fdPrefix) finishBashWord(state)
    if (redirect.startsWith("&") && context.dialect === "posix") state.ampersandRedirectWords ??= state.words.length
    // Trailing redirects wrap a whole list/pipeline in the legacy grammar, not its last command.
    // Prefix redirects remain part of the command, and later words remain redirect destinations.
    if (state.redirectWordCount === undefined && state.commandWordIndex >= 0) {
      state.redirectWordCount = state.words.length
      if (state.dangling) state.resourceEnd = state.commandEnd
    }
    if (redirect === "<<" || redirect === "<<-") {
      const delimiter = bashHeredocDelimiter(input, index + redirect.length, redirect === "<<-")
      if (!delimiter) return { kind: "opaque", reason: "invalid-redirect" }
      state.heredocs.push(delimiter)
      state.wordEnd = delimiter.end + 1
      state.redirectTarget = false
      return delimiter.end
    }
    state.redirectTarget = true
    state.hereString = redirect === "<<<"
    return index + redirect.length - 1
  }
  if (state.structures.at(-1)?.phase === "pattern" && char === "|") {
    finishBashWord(state)
    return index - 1
  }
  const structure = state.structures.at(-1)
  const caseBody = structure?.kind === "case" && structure.phase === "body"
  const operator = bashOperator(input, index, caseBody ? BASH_CASE_OPERATORS : BASH_LIST_OPERATORS)
  if (typeof operator === "object") return operator
  const separator = operator ?? char
  if (caseBody && separator.startsWith(";") && separator.length > 1) {
    if (!endBashList(state)) return { kind: "opaque", reason: "invalid-structure" }
    structure.phase = "pattern"
    structure.patternStarted = false
    return index + separator.length - 1
  }
  if (structure?.kind === "case" && (structure.phase === "header" || structure.phase === "pattern")) {
    if (separator !== "\n") return { kind: "opaque", reason: "compound-command" }
    if (structure.phase === "pattern" && (state.wordStarted || state.words.length > 0))
      return { kind: "opaque", reason: "compound-command" }
    finishBashWord(state)
    return readBashHeredocs(state, index, depth, context)
  }
  if (
    (structure?.kind === "for" || structure?.kind === "repeat") &&
    (structure.phase === "header" || structure.phase === "do")
  ) {
    if (separator !== ";" && separator !== "\n") return { kind: "opaque", reason: "compound-command" }
    if (structure.phase === "header" && !structure.sawIn && !state.wordStarted && state.words.length === 0)
      return { kind: "opaque", reason: "compound-command" }
  }
  if (separator === "\n" && !pending(state)) return readBashHeredocs(state, index, depth, context)
  finishBashCommand(state, true)
  if (structure?.kind === "for" && structure.phase === "header") structure.phase = "do"
  state.dangling = separator !== "&" && separator !== ";" && separator !== "\n"
  // Reprocess the newline to read pending heredoc bodies.
  if (separator === "\n" && state.heredocs.length) return index - 1
  return index + separator.length - 1
}

function bashCommandKey(command: Command) {
  return JSON.stringify([command.resource, command.words])
}

// Reads the pending heredoc bodies after the newline at index and returns the last index they cover.
function readBashHeredocs(state: BashState, index: number, depth: number, context: BashContext) {
  let end = index
  for (const heredoc of state.heredocs.splice(0)) {
    const body = bashHeredoc(state.input, end + 1, heredoc)
    if (!body) return { kind: "opaque", reason: "heredoc" } satisfies Opaque
    if (heredoc.command) heredoc.command.resource = state.input.slice(heredoc.start, body.end).trim()
    const text = heredoc.quoted ? { word: body.source, literal: body.source, output: "" } : bashText()
    if (!heredoc.quoted) {
      const expansion = scanBashSpan(body.source, 0, depth, context, state.commands, BASH_SPANS.heredoc, true, text)
      if (typeof expansion === "object") return expansion
    }
    if (heredoc.binding) bashEvaluatesExpansion(text, "deferred", context)
    end = body.end
  }
  return end
}

// Whether a construct read as one unit holds a newline token that would start pending heredoc bodies.
function bashCrossesHeredoc(state: BashState, start: number, end: number) {
  return state.heredocs.length > 0 && state.input.slice(start, end).includes("\n")
}

function scanBashCommandStart(
  state: BashState,
  index: number,
  depth: number,
  context: BashContext,
): number | Opaque | undefined {
  const input = state.input
  const char = input[index]
  const structure = state.structures.at(-1)
  if (structure?.phase === "pattern" && !structure.patternStarted && !state.words.length && char === "(") {
    structure.patternStarted = true
    return index
  }
  if (structure?.phase === "pattern" && char === "|") {
    if (!state.words.length) return { kind: "opaque", reason: "compound-command" }
    finishBashWord(state)
    structure.patternStarted = true
    return index
  }
  if (structure?.phase === "pattern" && char === ")") {
    if (!state.words.length) return { kind: "opaque", reason: "compound-command" }
    finishBashCommand(state)
    structure.phase = "body"
    structure.count = 0
    return index
  }
  if (structure?.kind === "for" && structure.phase === "header" && char === "(" && input[index + 1] !== "(") {
    const end = scanBashArrayOrPattern(input, index, depth + 1, context, state.nestedCommands, "array")
    if (typeof end === "object") return end
    if (bashCrossesHeredoc(state, index, end)) return { kind: "opaque", reason: "heredoc" }
    finishBashCommand(state)
    // Zsh permits a sublist or brace group directly after the value list, without do/done.
    structure.phase = "do"
    structure.parenthesized = true
    DO_AHEAD_RE.lastIndex = end + 1
    if (!DO_AHEAD_RE.test(input)) state.structures.pop()
    return end
  }
  if (structure?.kind === "repeat" && structure.phase === "do" && char !== "\n" && char !== "#" && char !== ";") {
    TOKEN_RE.lastIndex = index
    if (TOKEN_RE.exec(input)?.[0] !== "do") state.structures.pop()
  }
  const keywordStep = scanBashKeyword(state, index, depth, context)
  if (keywordStep !== undefined) return keywordStep
  if (structure?.kind === "for" && structure.phase === "do" && char !== "\n" && char !== "#" && char !== ";") {
    SPACE_CONTINUATION_AHEAD_RE.lastIndex = index + 1
    if (char !== "{" || !SPACE_CONTINUATION_AHEAD_RE.test(input)) return { kind: "opaque", reason: "compound-command" }
    state.structures.pop()
  }
  const atStart = atCommandStart(state)
  const functionHead = atStart && char === "(" ? bashFunctionHeadLength(input, index) : 0
  if (functionHead) return index + functionHead - 1
  if (atStart && char === "!") {
    NEGATION_AHEAD_RE.lastIndex = index + 1
    if (NEGATION_AHEAD_RE.test(input)) return index
  }
  const forHeader = structure?.kind === "for" && structure.phase === "header"
  const compoundOpen =
    (atStart || forHeader) && "([".includes(char) ? bashOperator(input, index, ["((", "[["]) : undefined
  if (typeof compoundOpen === "object") return compoundOpen
  if (compoundOpen === "((") {
    if (forHeader && state.words.length > 0) return { kind: "opaque", reason: "compound-command" }
    const span = forHeader ? BASH_SPANS.forArithmetic : BASH_SPANS.arithmetic
    const end = scanBashArithmetic(input, index + 2, depth, context, state.commands, span)
    if (typeof end === "number") {
      if (bashCrossesHeredoc(state, index, end)) return { kind: "opaque", reason: "heredoc" }
      if (!forHeader && context.dialect === "posix") {
        // Dash reads `((` as two nested subshells, so posix reports both readings.
        const subshells = scanBash(input, index + 1, depth + 1, context, ")")
        if (subshells.kind === "opaque") return subshells
        if (subshells.end !== end) return { kind: "opaque", reason: "compound-command" }
        const seen = new Set(state.commands.map(bashCommandKey))
        state.commands.push(...subshells.commands.filter((command) => !seen.has(bashCommandKey(command))))
      }
      if (forHeader) {
        structure.phase = "do"
        structure.sawIn = true
      }
      if (!forHeader) {
        bashStatement(state)
        state.compoundEnd = true
      }
      return end
    }
    if (end) return end
    if (forHeader) return { kind: "opaque", reason: "invalid-structure" }
  }
  if (
    atStart &&
    (char === "(" ||
      (char === "{" && ((SPACE_CONTINUATION_AHEAD_RE.lastIndex = index + 1), SPACE_CONTINUATION_AHEAD_RE.test(input))))
  ) {
    const group = scanBash(input, index + 1, depth + 1, context, char === "{" ? "}" : ")", state.heredocs)
    if (group.kind === "opaque") return group
    if (!input.slice(index + 1, group.end).trim()) return { kind: "opaque", reason: "invalid-structure" }
    state.commands.push(...group.commands)
    bashStatement(state)
    state.compoundEnd = true
    return group.end
  }
  if (
    atStart &&
    compoundOpen === "[[" &&
    ((SPACE_CONTINUATION_AHEAD_RE.lastIndex = index + 2), SPACE_CONTINUATION_AHEAD_RE.test(input))
  ) {
    const end = scanBashConditional(input, index + 2, depth, context, state.commands)
    if (typeof end === "object") return end
    if (bashCrossesHeredoc(state, index, end)) return { kind: "opaque", reason: "heredoc" }
    bashStatement(state)
    state.compoundEnd = true
    return end
  }
  return undefined
}

function scanBashKeyword(
  state: BashState,
  index: number,
  depth: number,
  context: BashContext,
): number | Opaque | undefined {
  const input = state.input
  const char = input[index]
  if (!((char >= "A" && char <= "Z") || (char >= "a" && char <= "z") || char === "_")) return undefined
  const structure = state.structures.at(-1)
  TOKEN_RE.lastIndex = index
  const token = TOKEN_RE.exec(input)?.[0]
  const end = index + (token?.length ?? 0) - 1
  if (structure?.kind === "case" && structure.phase === "header" && token === "in") {
    if (state.words.length !== 1 || state.hasRedirect) return { kind: "opaque", reason: "compound-command" }
    finishBashCommand(state)
    structure.phase = "pattern"
    structure.patternStarted = false
    return end
  }
  if (
    structure?.kind === "for" &&
    (structure.phase === "header" || structure.phase === "do") &&
    !structure.sawIn &&
    !structure.parenthesized &&
    token === "in" &&
    (structure.phase === "do" || state.words.length >= 1)
  ) {
    structure.sawIn = true
    structure.phase = "header"
    return end
  }
  if (structure?.phase === "pattern" && !structure.patternStarted && !state.words.length && token === "esac") {
    state.structures.pop()
    bashStatement(state)
    state.compoundEnd = true
    return end
  }
  // POSIX `for name do` omits the in list.
  if (
    structure?.kind === "for" &&
    structure.phase === "header" &&
    !structure.sawIn &&
    state.words.length === 1 &&
    !state.hasRedirect &&
    token === "do"
  ) {
    finishBashCommand(state)
    structure.phase = "do"
  }
  const inHeader = bashInHeader(state)
  if (
    token &&
    ["then", "elif", "else", "fi", "do", "done", "esac"].includes(token) &&
    !state.words.length &&
    !state.redirectTarget &&
    (!inHeader || (token === "do" && structure?.phase === "do"))
  ) {
    // Bash and Dash read a reserved word after a redirect as a command word, while Zsh reads a keyword.
    if ((state.hasRedirect && context.dialect !== "zsh") || !endBashList(state) || !structure)
      return { kind: "opaque", reason: "compound-command" }
    if (token === "then") {
      if (structure.kind !== "if" || structure.phase !== "condition" || !structure.count)
        return { kind: "opaque", reason: "compound-command" }
      structure.phase = "body"
      structure.count = 0
      return end
    }
    if (token === "elif" || token === "else") {
      if (structure.kind !== "if" || structure.phase !== "body" || !structure.count || structure.sawElse)
        return { kind: "opaque", reason: "compound-command" }
      structure.phase = token === "elif" ? "condition" : "body"
      structure.sawElse = token === "else"
      structure.count = 0
      return end
    }
    if (token === "do") {
      if (
        !["for", "while", "until", "repeat"].includes(structure.kind) ||
        !["condition", "do"].includes(structure.phase) ||
        (structure.kind !== "for" && structure.kind !== "repeat" && !structure.count)
      )
        return { kind: "opaque", reason: "compound-command" }
      structure.phase = "body"
      structure.count = 0
      return end
    }
    if (
      (token === "fi" && (structure.kind !== "if" || structure.phase !== "body" || !structure.count)) ||
      (token === "done" &&
        (!["for", "while", "until", "repeat"].includes(structure.kind) ||
          structure.phase !== "body" ||
          !structure.count)) ||
      (token === "esac" && (structure.kind !== "case" || structure.phase === "header"))
    )
      return { kind: "opaque", reason: "compound-command" }
    state.structures.pop()
    bashStatement(state)
    state.compoundEnd = true
    return end
  }
  if (!atCommandStart(state)) return undefined
  const definitionLength = bashFunctionHeadLength(input, index)
  if (definitionLength > 0) return index + definitionLength - 1
  if (
    token === "if" ||
    token === "while" ||
    token === "until" ||
    token === "for" ||
    token === "select" ||
    token === "case" ||
    (token === "repeat" && context.dialect !== "bash")
  ) {
    if (depth + state.structures.length >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "compound-command" }
    state.structures.push({
      kind: token === "select" ? "for" : token,
      phase: ["for", "select", "case", "repeat"].includes(token) ? "header" : "condition",
      count: 0,
    })
    // The compound command itself satisfies a preceding list operator.
    state.dangling = false
    return end
  }
  if (token === "coproc") {
    COPROC_AHEAD_RE.lastIndex = index
    const coprocMatch = COPROC_AHEAD_RE.exec(input)?.[0]
    if (coprocMatch) return index + coprocMatch.length - 1
  }
  if (token === "time") {
    TIME_AHEAD_RE.lastIndex = index
    const timeMatch = TIME_AHEAD_RE.exec(input)?.[0]
    if (timeMatch) return index + timeMatch.length - 1
  }
  return undefined
}

function bashFunctionHeadLength(input: string, start: number) {
  FUNCTION_HEAD_RE.lastIndex = start
  const head = FUNCTION_HEAD_RE.exec(input)
  if (!head || (head[1] ? !head[2] : !head[3] || BASH_NON_FUNCTION_KEYWORDS.has(head[2] ?? ""))) return 0
  FUNCTION_BODY_RE.lastIndex = start + head[0].length
  // Blanks, comments, and newlines before the body stay for the caller, where newlines start heredoc bodies.
  return FUNCTION_BODY_RE.test(input) ? head[0].length - head[4].length : 0
}

// Word text is unquoted. Quoted text follows double-quote rules. Arithmetic text, including subscripts,
// expands like double-quoted text while its matcher still lets a backslash escape any character.
type BashTextMode = "word" | "quoted" | "arithmetic"

type BashSpan = { open?: string; close?: string; reject: string; mode: Exclude<BashTextMode, "word"> }

const BASH_SPANS = {
  double: { close: '"', reject: "", mode: "quoted" },
  heredoc: { reject: "", mode: "quoted" },
  // Bash rereads `((...))` it cannot parse as arithmetic, such as text with a comment, as nested subshells.
  arithmetic: { open: "(", close: ")", reject: ";#}", mode: "arithmetic" },
  forArithmetic: { open: "(", close: ")", reject: "#}", mode: "arithmetic" },
  bracketArithmetic: { close: "]", reject: ";|&<>()[\n'\"\\#", mode: "arithmetic" },
  subscript: { open: "[", close: "]", reject: '"}', mode: "arithmetic" },
  quotedSubscript: { open: "[", close: "]", reject: '"', mode: "quoted" },
  // Dash splits an assignment subscript at blanks and operators, so Bash and Zsh assignments diverge.
  assignmentSubscript: { open: "[", close: "]", reject: " \t\n\r\v\f;&|<>()", mode: "arithmetic" },
  // Single quotes are literal here in some shells and quoting in others, so reject what either reading
  // would parse structurally and scan the contents for expansions. Inside a double-quoted parameter, Zsh and
  // Dash read them literally even within subscripts and arithmetic, where `"` and `}` would end the parameter.
  arithmeticQuote: { close: "'", reject: '()[];"}', mode: "quoted" },
  arithmeticDouble: { close: '"', reject: "()[];}", mode: "quoted" },
  parameterQuote: { close: "'", reject: '"}[]', mode: "quoted" },
} satisfies Record<string, BashSpan>

// Scans one quoting or expansion unit at index into commands, appending its text when given a sink.
// Returns the unit's last index, or undefined when the character is ordinary text.
function scanBashUnit(
  input: string,
  index: number,
  depth: number,
  context: BashContext,
  commands: Command[],
  mode: BashTextMode,
  allowBracket: boolean,
  text?: BashText,
): number | Opaque | undefined {
  const char = input[index]
  const next = input[index + 1] ?? "\0"
  if (char === "\\") {
    if (mode === "quoted" && !'$`"\\\n'.includes(next)) return undefined
    if (text && next !== "\n") bashAppend(text, input.slice(index + 1, index + 2))
    return index + 1
  }
  if (char === "$" && context.dialect !== "bash" && zshEvaluates(input, index))
    return { kind: "opaque", reason: "dynamic-execution" }
  if (
    char === "$" &&
    context.dialect !== "bash" &&
    (mode === "word" || mode === "quoted") &&
    ((ZSH_SUBSCRIPT_RE.lastIndex = index), ZSH_SUBSCRIPT_RE.test(input))
  ) {
    const bracket = ZSH_SUBSCRIPT_RE.lastIndex
    const subscript = bashText()
    const span = mode === "quoted" ? BASH_SPANS.quotedSubscript : BASH_SPANS.subscript
    const end = scanBashSpan(input, bracket, depth, context, commands, span, false, subscript)
    if (typeof end === "object") return end
    if (bashEvaluatesExpansion(subscript, "arithmetic", context)) return { kind: "opaque", reason: "dynamic-execution" }
    if (text) text.word += `${input.slice(index, bracket)}${subscript.word}]`
    return end
  }
  const opener =
    char === "$"
      ? bashOperator(input, index, ["$$", "$((", "$(", "${", "$[", "$'", '$"'])
      : mode === "word" && (char === "<" || char === ">")
        ? bashOperator(input, index, [`${char}(`])
        : undefined
  if (typeof opener === "object") return opener
  if (opener === "$$") {
    LINE_CONTINUATION_RE.lastIndex = index + 2
    const quoteStart = LINE_CONTINUATION_RE.exec(input) ? LINE_CONTINUATION_RE.lastIndex : index + 2
    if (input[quoteStart] === "'") {
      const nextQuote = input.indexOf("'", quoteStart + 1)
      if (nextQuote < 0) return { kind: "opaque", reason: "unterminated-quote" }
      // Zsh and Bash 3.2 inside ${...} can parse $$'...' with ANSI-C escapes while Bash 5/Dash treat $$ as PID.
      if (input.slice(quoteStart + 1, nextQuote).includes("\\") && input.includes("'", nextQuote + 1))
        return { kind: "opaque", reason: "unterminated-quote" }
    }
    if (text) text.word += "$$"
    return index + 1
  }
  if (mode === "word" && opener === "$'") {
    const quote = bashAnsiQuote(input, index + 1)
    if (!quote) return { kind: "opaque", reason: "unterminated-quote" }
    const firstQuote = input.indexOf("'", index + 2)
    // Dash does not support $'...' and closes the single-quoted span at the first `'`, even after `\`.
    if (
      quote.end !== firstQuote &&
      ((context.dialect !== "bash" && index >= 2 && input[index - 2] === "$") ||
        (context.dialect === "posix" &&
          (input.indexOf("'", firstQuote + 1) < quote.end || /[#"\n]|\\'/.test(input.slice(firstQuote + 1)))))
    )
      return { kind: "opaque", reason: "unterminated-quote" }
    if (text) bashAppend(text, quote.value)
    return quote.end
  }
  if (mode === "arithmetic" && opener === "$'") {
    const quote = bashAnsiQuote(input, index + 1)
    if (!quote || quote.end !== input.indexOf("'", index + 2) || /[()[\];"}]/.test(quote.value))
      return { kind: "opaque", reason: "invalid-structure" }
    if (text) bashAppend(text, quote.value)
    return scanBashSpan(input, index + 2, depth, context, commands, BASH_SPANS.arithmeticQuote, allowBracket, text)
  }
  if (mode === "word" && char === "'") {
    const end = input.indexOf("'", index + 1)
    if (end < 0) return { kind: "opaque", reason: "unterminated-quote" }
    if (text) bashAppend(text, input.slice(index + 1, end))
    return end
  }
  if (mode === "arithmetic" && char === "'")
    return scanBashSpan(input, index + 1, depth, context, commands, BASH_SPANS.arithmeticQuote, allowBracket, text)
  if (mode === "word" && opener === '$"')
    return scanBashSpan(input, index + 2, depth, context, commands, BASH_SPANS.double, allowBracket, text)
  if (mode !== "quoted" && char === '"') {
    const span = mode === "arithmetic" ? BASH_SPANS.arithmeticDouble : BASH_SPANS.double
    return scanBashSpan(input, index + 1, depth, context, commands, span, allowBracket, text)
  }
  const end =
    opener === "<(" || opener === ">("
      ? scanBashNested(input, index + 2, depth, context, commands, ")")
      : (opener && opener !== "$'" && opener !== '$"') || char === "`"
        ? scanBashDollarOrBacktick(input, index, depth, context, commands, mode !== "word", allowBracket, text)
        : undefined
  if (end === undefined && char === "$" && /[A-Za-z_0-9@*#?$!-]/.test(next)) {
    if (text) text.word += "$"
    return index
  }
  if (text && typeof end === "number") text.word += input.slice(index, end + 1)
  return end
}

// Zsh flag groups such as ${(e)name} evaluate a value, and a modifier run with ~, such as $^~name or
// ${(f)~name}, globs it, which can run glob qualifier code.
function zshEvaluates(input: string, index: number) {
  let at = index + 1
  if (input.startsWith("{\\\n", at)) return true
  if (input[at] === "{" && input[at + 1] === "(") {
    ZSH_SAFE_FLAGS_RE.lastIndex = index
    if (!ZSH_SAFE_FLAGS_RE.test(input)) return true
    at = ZSH_SAFE_FLAGS_RE.lastIndex
  }
  if (input[at] === "{") at++
  ZSH_GLOB_MODIFIER_RE.lastIndex = at
  return ZSH_GLOB_MODIFIER_RE.test(input)
}

function bashAppend(text: BashText, value: string) {
  text.word += value
  text.literal += value
}

// Arithmetic evaluation expands `name[subscript]` again, so a literal expansion in text the shell evaluates as
// arithmetic can run: (( )), $(( )), $[ ], subscripts, ${name:offset:length}, let operands, and the arithmetic
// operands of [[ ]]. Builtins that name or bind a variable from an operand evaluate its subscript, so a literal
// expansion there runs when the operand also has a bracket; a command substitution's words stand in for the
// output it supplies. Values bound for later, such as assignment values, array elements, for lists, and
// here-strings, reach arithmetic or subscript evaluation when a variable sink appears in the command.
// A parameter's words count as its value. Text that reaches arithmetic only at runtime, through the
// environment, a function argument, or the output a command substitution supplies to a later binding, remains
// out of reach.
function bashEvaluatesExpansion(text: BashText, evaluation: BashEvaluation, context: BashContext) {
  const combined = `${text.literal} ${text.output}`
  const hasExpansion = BASH_EXPANSION_RE.test(combined)
  const hasEscape = BASH_ESCAPE_RE.test(text.literal)
  if (hasExpansion || hasEscape || /[$`]/.test(text.literal)) context.boundDollar = true
  if (hasExpansion || hasEscape || /[({`]/.test(text.literal)) context.boundOpen = true
  if (evaluation === "deferred") return false
  if (
    evaluation === "arithmetic"
      ? /[A-Za-z_]|(?:\$(?![?#!-]|\$(?!\[)))/.test(text.word)
      : text.word.includes("$") || combined.includes("[")
  )
    context.variableSink = true
  if (evaluation === "arithmetic") return hasExpansion
  return combined.includes("[") && hasExpansion
}

function bashText(): BashText {
  return { word: "", literal: "", output: "" }
}

// Scans a subscript after its `[`; indexed arrays evaluate it as arithmetic.
function scanBashSubscript(
  input: string,
  start: number,
  depth: number,
  context: BashContext,
  commands: Command[],
  span: BashSpan = BASH_SPANS.subscript,
): number | Opaque {
  const text = bashText()
  const end = scanBashSpan(input, start, depth, context, commands, span, false, text)
  if (typeof end === "number" && bashEvaluatesExpansion(text, "arithmetic", context))
    return { kind: "opaque", reason: "dynamic-execution" }
  return end
}

// Scans to the span's unnested close character and returns its index; a span without one runs to the end.
function scanBashSpan(
  input: string,
  start: number,
  depth: number,
  context: BashContext,
  commands: Command[],
  span: BashSpan,
  allowBracket: boolean,
  text?: BashText,
): number | Opaque {
  let nesting = 0
  for (let index = start; index < input.length; index++) {
    if (--context.remaining < 0) return { kind: "opaque", reason: "invalid-structure" }
    const char = input[index]
    if (char === span.close && !nesting) return index
    // A `#` after a digit is a base prefix, and after `$` the parameter $#.
    if (span.reject.includes(char) && !(char === "#" && /[\d$]/.test(input[index - 1] ?? "")))
      return { kind: "opaque", reason: "invalid-structure" }
    if (char === span.open && ++nesting + depth > MAX_SUBSTITUTION_DEPTH)
      return { kind: "opaque", reason: "invalid-structure" }
    if (char === span.close) nesting--
    const unit =
      char === span.open || char === span.close
        ? undefined
        : scanBashUnit(input, index, depth, context, commands, span.mode, allowBracket, text)
    if (typeof unit === "object") return unit
    if (unit !== undefined) index = unit
    else if (char === "\\" && (input[index + 1] === span.open || input[index + 1] === span.close)) {
      if (text) bashAppend(text, input.slice(index, index + 2))
      index++
    } else if (text) bashAppend(text, char)
  }
  return span.close ? { kind: "opaque", reason: "unterminated-quote" } : input.length
}

// Scans a nested list such as a command or process substitution and returns its closing index.
function scanBashNested(
  input: string,
  start: number,
  depth: number,
  context: BashContext,
  commands: Command[],
  close: ")" | "nofork",
  text?: BashText,
): number | Opaque {
  const nested = scanBash(input, start, depth + 1, context, close, undefined, text)
  if (nested.kind === "opaque") return nested
  commands.push(...nested.commands)
  return nested.end
}

// Returns the first listed operator at index. Shells disagree about operators split by line continuations.
function bashOperator(input: string, index: number, operators: string[]): string | Opaque | undefined {
  let text = ""
  for (let cursor = index; text.length < 3 && cursor < input.length; cursor++) {
    if (input.startsWith("\\\n", cursor)) cursor++
    else text += input[cursor]
  }
  const operator = operators.find((candidate) => text.startsWith(candidate))
  if (operator && !input.startsWith(operator, index)) return { kind: "opaque", reason: "invalid-structure" }
  return operator
}

function scanBashDollarOrBacktick(
  input: string,
  start: number,
  depth: number,
  context: BashContext,
  commands: Command[],
  quoted: boolean,
  allowBracket: boolean,
  text?: BashText,
): number | Opaque {
  if (depth >= MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "command-substitution" }
  if (input[start] === "`") return scanBashBacktick(input, start, depth + 1, context, commands, quoted, text)
  if (input.startsWith("$((", start)) {
    const end = scanBashArithmetic(input, start + 3, depth + 1, context, commands, BASH_SPANS.arithmetic)
    if (end !== undefined) return end
  }
  if (input.startsWith("$(", start)) return scanBashNested(input, start + 2, depth, context, commands, ")", text)
  NOFORK_OPEN_RE.lastIndex = start
  const nofork = NOFORK_OPEN_RE.exec(input)
  if (nofork) return scanBashNested(input, start + nofork[0].length, depth, context, commands, "nofork", text)
  if (input.startsWith("${", start)) {
    // Literal text in parameter words reaches the enclosing word's value.
    const parameter = bashText()
    const end = scanBashParameter(input, start + 2, depth + 1, context, commands, quoted, parameter)
    // ${!name} evaluates the subscript in its name.
    if (/^(?:\\\n)*!/.test(input.slice(start + 2))) {
      context.variableSink = true
      if (bashEvaluatesExpansion(parameter, "binding", context)) return { kind: "opaque", reason: "dynamic-execution" }
    }
    if (text) {
      text.literal += parameter.literal
      text.output += parameter.output
    }
    return end
  }
  // Dash leaves `$[` literal, which splits words differently; Bash and Zsh always read arithmetic.
  if (!allowBracket && context.dialect === "posix") return { kind: "opaque", reason: "command-substitution" }
  const expression = bashText()
  const end = scanBashSpan(
    input,
    start + 2,
    depth + 1,
    context,
    commands,
    BASH_SPANS.bracketArithmetic,
    true,
    expression,
  )
  if (typeof end === "number" && bashEvaluatesExpansion(expression, "arithmetic", context))
    return { kind: "opaque", reason: "dynamic-execution" }
  return end
}

// Scans the text of ((...)) after its opening parentheses. Returns undefined when the text closes with a single
// parenthesis, which makes it a nested subshell instead.
function scanBashArithmetic(
  input: string,
  start: number,
  depth: number,
  context: BashContext,
  commands: Command[],
  span: BashSpan,
): number | Opaque | undefined {
  const arithmetic: Command[] = []
  const text = bashText()
  const end = scanBashSpan(input, start, depth, context, arithmetic, span, true, text)
  if (typeof end === "object") return { kind: "opaque", reason: "invalid-structure" }
  const close = bashOperator(input, end, ["))"])
  if (typeof close === "object") return close
  if (!close) return undefined
  if (bashEvaluatesExpansion(text, "arithmetic", context)) return { kind: "opaque", reason: "dynamic-execution" }
  commands.push(...arithmetic)
  return end + 1
}

function scanBashBacktick(
  input: string,
  start: number,
  depth: number,
  context: BashContext,
  commands: Command[],
  quoted: boolean,
  text?: BashText,
): number | Opaque {
  let source = ""
  for (let index = start + 1; index < input.length; index++) {
    if (--context.remaining < 0) return { kind: "opaque", reason: "invalid-structure" }
    if (input[index] === "`") {
      const inner = scanBash(source, 0, depth, context, undefined, undefined, text)
      if (inner.kind === "opaque") return { kind: "opaque", reason: "command-substitution" }
      commands.push(...inner.commands)
      return index
    }
    const next = input[index + 1] ?? "\0"
    if (input[index] === "\\" && ("$`\\\n".includes(next) || (quoted && next === '"'))) {
      index++
      if (next !== "\n") source += next
      continue
    }
    source += input[index]
  }
  return { kind: "opaque", reason: "command-substitution" }
}

function scanBashParameter(
  input: string,
  start: number,
  depth: number,
  context: BashContext,
  commands: Command[],
  quoted: boolean,
  text: BashText,
): number | Opaque {
  PARAMETER_PREFIX_RE.lastIndex = start
  const nameStart = PARAMETER_PREFIX_RE.exec(input) ? PARAMETER_PREFIX_RE.lastIndex : start
  // The operands of ${name:offset:length} are arithmetic, and ${name:=word} or ${name=word} binds a variable.
  PARAMETER_NAME_RE.lastIndex = nameStart
  let colon = PARAMETER_NAME_RE.test(input) ? PARAMETER_NAME_RE.lastIndex : -1
  const name = colon > nameStart ? input.slice(nameStart, colon).replace(/\\\n/g, "") : ""
  if (
    context.dialect !== "bash" &&
    (/^(?:READ)?NULLCMD$/.test(name) ||
      (/^(?:(?:dis_)?(?:functions|[gs]?aliases)|options|commands)$/.test(name) && "[=:".includes(input[colon] ?? "")))
  )
    return { kind: "opaque", reason: "dynamic-execution" }
  if (name === "PS4") context.variableSink = true
  let evaluation: BashEvaluation | undefined
  let wordOffset = 0
  let literalOffset = 0
  for (let index = start; index < input.length; index++) {
    if (--context.remaining < 0) return { kind: "opaque", reason: "invalid-structure" }
    const char = input[index]
    if (char === "}") {
      if (
        evaluation &&
        bashEvaluatesExpansion(
          { word: text.word.slice(wordOffset), literal: text.literal.slice(literalOffset), output: text.output },
          evaluation,
          context,
        )
      )
        return { kind: "opaque", reason: "dynamic-execution" }
      return index
    }
    if (index === colon && !evaluation) {
      if (char === ":" && !"-=?+".includes(input[index + 1] ?? "")) evaluation = "arithmetic"
      if (char === "=" || (char === ":" && input[index + 1] === "=")) evaluation = "deferred"
      if (evaluation) {
        wordOffset = text.word.length
        literalOffset = text.literal.length
      }
    }
    // Bash ${name@P} evaluates the value as prompt text.
    if (char === "@") {
      PARAMETER_PROMPT_RE.lastIndex = index
      if (PARAMETER_PROMPT_RE.test(input)) return { kind: "opaque", reason: "dynamic-execution" }
    }
    // Zsh globs an unquoted parameter's words, where a parenthesized group can be a glob qualifier.
    if (!quoted && context.dialect !== "bash" && char === "(" && index > start)
      return { kind: "opaque", reason: "dynamic-execution" }
    if (quoted && char === "'" && input[index - 1] === "$") {
      const ansi = bashAnsiQuote(input, index)
      if (!ansi) return { kind: "opaque", reason: "unterminated-quote" }
      text.literal += ansi.value
    }
    const subscript = index === colon && char === "["
    const unit = subscript
      ? scanBashSubscript(input, index + 1, depth, context, commands)
      : quoted && char === "'"
        ? scanBashSpan(input, index + 1, depth, context, commands, BASH_SPANS.parameterQuote, false, text)
        : quoted && char === '"'
          ? scanBashSpan(input, index + 1, depth, context, commands, BASH_SPANS.double, false, text)
          : scanBashUnit(input, index, depth, context, commands, quoted ? "quoted" : "word", false, text)
    if (typeof unit === "object") return unit
    // Bash 3.2 ends a double-quoted parameter at an unquoted `}` inside `$(...)`.
    if (quoted && unit !== undefined && input.startsWith("$(", index) && input.slice(index, unit + 1).includes("}"))
      return { kind: "opaque", reason: "command-substitution" }
    if (subscript || (index === nameStart && input.startsWith("${", index) && unit !== undefined)) {
      LINE_CONTINUATION_RE.lastIndex = Number(unit) + 1
      colon = LINE_CONTINUATION_RE.exec(input) ? LINE_CONTINUATION_RE.lastIndex : Number(unit) + 1
    }
    if (unit !== undefined) index = unit
    else bashAppend(text, char)
  }
  return { kind: "opaque", reason: "command-substitution" }
}

function scanBashConditional(
  input: string,
  start: number,
  depth: number,
  context: BashContext,
  commands: Command[],
): number | Opaque {
  const words: BashText[] = []
  let text = bashText()
  let wordStarted = false
  let hasWord = false
  let parenDepth = 0
  let patternParenDepth = 0
  const flushWord = () => {
    if (!hasWord) return
    words.push(text)
    text = bashText()
    hasWord = false
  }
  for (let index = start; index < input.length; index++) {
    if (--context.remaining < 0) return { kind: "opaque", reason: "invalid-structure" }
    const char = input[index]
    if (char === "\\" && input[index + 1] === "\n") {
      index++
      continue
    }
    if (!wordStarted) flushWord()
    const close = !wordStarted && char === "]" ? bashOperator(input, index, ["]]"]) : undefined
    if (typeof close === "object") return close
    if (close) {
      BRACE_CLOSE_AHEAD_RE.lastIndex = index + 2
      if (BRACE_CLOSE_AHEAD_RE.test(input)) {
        if (parenDepth !== 0) return { kind: "opaque", reason: "invalid-structure" }
        // -v names a variable, -t in Zsh evaluates the descriptor, and arithmetic comparisons evaluate both operands.
        const evaluated = words.some(
          (word, at) =>
            (words[at - 1]?.word === "-v" && bashEvaluatesExpansion(word, "binding", context)) ||
            (((context.dialect !== "bash" && words[at - 1]?.word === "-t") ||
              BASH_ARITHMETIC_COMPARISONS.has(words[at - 1]?.word ?? "") ||
              BASH_ARITHMETIC_COMPARISONS.has(words[at + 1]?.word ?? "")) &&
              bashEvaluatesExpansion(word, "arithmetic", context)),
        )
        if (evaluated) return { kind: "opaque", reason: "dynamic-execution" }
        return index + 1
      }
    }
    if (!wordStarted && char === "#") {
      const newline = input.indexOf("\n", index)
      if (newline < 0) return { kind: "opaque", reason: "invalid-structure" }
      index = newline
      continue
    }
    if (char === " " || char === "\t" || char === "\n") {
      if (!patternParenDepth) wordStarted = false
      continue
    }
    if (char === ";") return { kind: "opaque", reason: "invalid-structure" }
    if (char === "(" || char === ")") {
      if (char === ")" && parenDepth === 0) return { kind: "opaque", reason: "invalid-structure" }
      const inPattern =
        patternParenDepth > 0 || (char === "(" && ["=", "==", "!=", "=~"].includes(words.at(-1)?.word ?? ""))
      parenDepth += char === "(" ? 1 : -1
      if (inPattern) {
        patternParenDepth += char === "(" ? 1 : -1
        wordStarted = true
        hasWord = true
        bashAppend(text, char)
        continue
      }
      flushWord()
      words.push({ word: char, literal: "", output: "" })
      wordStarted = false
      continue
    }
    const unit = scanBashUnit(input, index, depth, context, commands, "word", true, text)
    if (typeof unit === "object") return unit
    if (unit !== undefined) index = unit
    if (unit === undefined && !patternParenDepth && "&|<>".includes(char)) {
      flushWord()
      words.push({ word: char, literal: "", output: "" })
      wordStarted = false
      continue
    }
    wordStarted = true
    hasWord = true
    if (unit === undefined) bashAppend(text, char)
  }
  return { kind: "opaque", reason: "invalid-structure" }
}

function scanBashArrayOrPattern(
  input: string,
  start: number,
  depth: number,
  context: BashContext,
  commands: Command[],
  mode: "array" | "pattern",
): number | Opaque {
  if (depth > MAX_SUBSTITUTION_DEPTH) return { kind: "opaque", reason: "command-substitution" }
  // Array elements bind variables, so their decoded text is a subscript sink.
  const text = mode === "array" ? bashText() : undefined
  let wordStarted = false
  for (let index = start + 1; index < input.length; index++) {
    if (--context.remaining < 0) return { kind: "opaque", reason: "invalid-structure" }
    const char = input[index]
    if (char === "\\" && input[index + 1] === "\n") {
      index++
      continue
    }
    if (text && (char === ")" || char === " " || char === "\t" || char === "\n")) {
      bashEvaluatesExpansion(text, "deferred", context)
      text.literal = ""
      text.output = ""
    }
    if (char === ")") return index
    if (mode === "array" && !wordStarted && char === "#") {
      const newline = input.indexOf("\n", index)
      if (newline < 0) return { kind: "opaque", reason: "command-substitution" }
      index = newline
      continue
    }
    if (char === " " || char === "\t" || (mode === "array" && char === "\n")) {
      wordStarted = false
      continue
    }
    // Array elements are globbed, where a parenthesized group can be a Zsh glob qualifier.
    if (char === "\n" || char === ";" || char === "&" || (mode === "array" && "|(".includes(char)))
      return { kind: "opaque", reason: "command-substitution" }
    wordStarted = true
    const unit =
      mode === "array" && char === "=" && input[index + 1] === "("
        ? scanBashNested(input, index + 2, depth, context, commands, ")")
        : char === "("
          ? scanBashArrayOrPattern(input, index, depth + 1, context, commands, mode)
          : char === "["
            ? scanBashSubscript(input, index + 1, depth, context, commands)
            : scanBashUnit(input, index, depth, context, commands, "word", false, text)
    if (typeof unit === "object") return unit
    if (unit !== undefined) index = unit
    else if (text) text.literal += char
  }
  return { kind: "opaque", reason: "command-substitution" }
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
    if (escaped === undefined) return
    if (escaped in BASH_ANSI_ESCAPES) {
      value += BASH_ANSI_ESCAPES[escaped]
      continue
    }
    const digits =
      escaped === "x"
        ? /^[\da-fA-F]{1,2}/.exec(input.slice(index + 1, index + 3))?.[0]
        : /[0-7]/.test(escaped)
          ? /^[0-7]{1,3}/.exec(input.slice(index, index + 3))?.[0]
          : undefined
    if (!digits) return
    const octal = /[0-7]/.test(escaped)
    const point = parseInt(digits, octal ? 8 : 16)
    if (point === 0) return
    value += String.fromCodePoint(point)
    index += digits.length - (octal ? 1 : 0)
  }
}

function bashHeredocDelimiter(input: string, start: number, tabs: boolean) {
  let delimiter = ""
  let dashDelimiter: string | undefined
  let quoted = false
  let quote: "'" | '"' | undefined
  let end = start
  let started = false
  for (let index = start; index < input.length; index++) {
    const char = input[index]
    if (!started && /[ \t]/.test(char)) continue
    if (!started && char === "#") return
    if (!quote && /[ \t\n;&|()<>]/.test(char))
      return started ? { delimiter, dashDelimiter, quoted, tabs, end } : undefined
    if (!quote && char === "$" && input.startsWith("\\\n", index + 1)) return
    // Dash retains $ in $'...' heredoc delimiters while Bash and Zsh strip $.
    if (!quote && input.startsWith("$'", index)) {
      const literal = bashAnsiQuote(input, index + 1)
      if (!literal || literal.end !== input.indexOf("'", index + 2)) return
      dashDelimiter = `${dashDelimiter ?? delimiter}$${input.slice(index + 2, literal.end)}`
      delimiter += literal.value
      quoted = true
      started = true
      index = literal.end
      end = index
      continue
    }
    // Bash strips $ from $"..." heredoc delimiters while Zsh and Dash retain $.
    if (!quote && input.startsWith('$"', index)) return
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
        const escaped = input[++index]
        if (dashDelimiter !== undefined) dashDelimiter += escaped
        delimiter += escaped
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
    if (dashDelimiter !== undefined) dashDelimiter += char
    delimiter += char
    started = true
    end = index
  }
  if (started && !quote) return { delimiter, dashDelimiter, quoted, tabs, end }
}

function bashHeredoc(
  input: string,
  start: number,
  delimiter: { delimiter: string; dashDelimiter?: string; tabs: boolean; quoted: boolean },
) {
  const bodyStart = start
  let lineStart = start
  let line = ""
  // Backslashes ending the joined line; an odd count continues it.
  let backslashes = 0
  for (let index = start; index <= input.length; index++) {
    if (index < input.length && input[index] !== "\n") continue
    const text =
      delimiter.tabs && start === lineStart ? input.slice(start, index).replace(/^\t+/, "") : input.slice(start, index)
    let run = 0
    while (text[text.length - 1 - run] === "\\") run++
    backslashes = run === text.length ? backslashes + run : run
    const continued = !delimiter.quoted && backslashes % 2 === 1 && index < input.length
    const maxLength = Math.max(delimiter.delimiter.length, delimiter.dashDelimiter?.length ?? 0)
    // Joined lines only grow, so text past the delimiter's length cannot change the comparison.
    if (line.length <= maxLength) line += continued ? text.slice(0, -1) : text
    if (continued) {
      backslashes--
      start = index + 1
      continue
    }
    if (delimiter.dashDelimiter !== undefined && line === delimiter.dashDelimiter) return
    if (line === delimiter.delimiter) {
      // Dash does not join backslash-continued delimiter lines; fail closed if a physical delimiter follows.
      if (start > lineStart && input.slice(index + 1).includes(delimiter.delimiter)) return
      return { source: input.slice(bodyStart, lineStart), end: index }
    }
    line = ""
    backslashes = 0
    start = index + 1
    lineStart = start
  }
}

export function scanPowerShell(input: string): Result {
  if (input.length > MAX_INPUT_LENGTH) return { kind: "opaque", reason: "invalid-structure" }
  // PowerShell's Unicode quotes, dashes, and whitespace differ from JavaScript's token rules.
  if (/[\0\u0085\u2013-\u2015\u2018-\u201e\ufeff]/.test(input)) return { kind: "opaque", reason: "invalid-structure" }
  const result = scanPowerShellList(input, 0, 0, { remaining: MAX_INPUT_LENGTH * MAX_SUBSTITUTION_DEPTH })
  if (result.kind === "opaque") return result
  return { kind: "scanned", commands: result.commands }
}

type PowerShellClause = "member" | "block" | "if" | "try" | "clause" | "switch" | "paren" | "do" | undefined

function scanPowerShellList(
  input: string,
  start: number,
  depth: number,
  budget: { remaining: number },
  close?: ")" | "}" | "]",
  hash: boolean | "clause" | "switch" = false,
  skipped?: ReadonlySet<number>,
): BashResult {
  if (depth >= MAX_SUBSTITUTION_DEPTH || budget.remaining < 0) return { kind: "opaque", reason: "invalid-structure" }
  const commands: Command[] = []
  const nestedCommands: Command[] = []
  const words: string[] = []
  const rawWords: string[] = []
  const wordEnds: number[] = []
  const initialExpression = hash === true || hash === "clause"
  const initialClause: PowerShellClause = hash === "clause" || hash === "switch" ? "member" : undefined
  let segment = start
  let word = ""
  let started = false
  let wordStart = start
  let quote: "'" | '"' | undefined
  let standalone = false
  let expression = initialExpression
  let clause: PowerShellClause = initialClause
  let after: "do" | "if" | "try" | undefined
  let indexable: false | "variable" | "closed" | "member" = false
  let stopParsing = false
  let commandEnd = start
  let statementHead = true
  let invalid = false
  let redirectTarget = false
  let dangling = false
  let invocation = false

  const finishWord = (end: number) => {
    if (!started) return
    // Generic tokens can spell stop-parsing with escapes or embedded quotes; literal strings cannot.
    if (
      word === "--%" &&
      words.length > 0 &&
      !expression &&
      !clause &&
      !redirectTarget &&
      !/['"]/.test(input[wordStart]) &&
      !rawWords.at(-1)?.endsWith(",") &&
      !POWERSHELL_PARAMETER_COLON_RE.test(rawWords.at(-1) ?? "")
    )
      stopParsing = true
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
    if (words.length && !expression && !clause)
      commands.push({
        resource: input.slice(segment, commandEnd).trimEnd(),
        words: [...words],
        rawWords: [...rawWords],
        wordEnds: wordEnds.map((value) => value - segment),
        ...(statementHead && !invocation ? { statementHead: true as const } : {}),
      })
    else if (
      (!expression && !clause && invocation) ||
      (required && !words.length && !nestedCommands.length) ||
      (clause !== undefined && clause !== "member")
    )
      invalid = true
    if (redirectTarget) invalid = true
    commands.push(...nestedCommands.splice(0))
    words.length = 0
    rawWords.length = 0
    wordEnds.length = 0
    redirectTarget = false
    invocation = false
    expression = initialExpression
    clause = initialClause
    after = undefined
    indexable = false
    stopParsing = false
  }

  let index = start
  for (; index < input.length; index++) {
    if (--budget.remaining < 0) return { kind: "opaque", reason: "invalid-structure" }
    if (skipped?.has(index)) continue
    const char = input[index]
    const inExpression = expression && !redirectTarget
    const atBoundary = !started || (!inExpression && word.endsWith(","))
    if (!started) wordStart = index
    if (stopParsing) {
      const stop = powerShellStopParsing(input, index, skipped)
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
    if (quote) {
      let nextQuote = index + 1
      while (skipped?.has(nextQuote)) nextQuote++
      if (char === quote && input[nextQuote] === quote) {
        word += quote
        index = nextQuote
      } else if (char === quote) {
        quote = undefined
        if (standalone) {
          finishWord(index + 1)
          indexable = "closed"
        }
      } else if (quote === '"' && char === "`") {
        const escape = powerShellEscape(input, index, false, skipped)
        if (!escape) return { kind: "opaque", reason: "unterminated-escape" }
        word += escape.value
        index = escape.end
      } else if (quote === '"' && char === "$" && input[index + 1] === "{") {
        const end = powerShellBracedVariable(input, index, skipped)
        if (end === undefined) return { kind: "opaque", reason: "invalid-structure" }
        word += input.slice(index, end + 1)
        index = end
      } else if (quote === '"' && char === "$" && input[index + 1] === "(") {
        const sub = powerShellSubExpression(input, index + 2, false, budget, skipped)
        if (!sub) return { kind: "opaque", reason: "invalid-structure" }
        const result = scanPowerShellList(input, index + 2, depth + 1, budget, ")", false, sub.skipped)
        if (result.kind === "opaque") return result
        nestedCommands.push(...result.commands)
        const end = sub.rawEnd !== undefined && sub.rawEnd > result.end ? sub.rawEnd : result.end
        word += input.slice(index, end + 1)
        index = end
      } else word += char
      continue
    }
    if (char === "'" || char === '"') {
      if (!started && words.length === 0 && !invocation) expression = true
      quote = char
      standalone = atBoundary || (expression && !redirectTarget) || (indexable === "member" && /[.:]$/.test(word))
      if (!standalone) indexable = false
      started = true
      continue
    }
    if (char === "`") {
      const escape = powerShellEscape(input, index, atBoundary || inExpression, skipped)
      if (!escape) return { kind: "opaque", reason: "unterminated-escape" }
      const rawSpace = /\s/.test(input[index + 1] ?? "")
      if ((inExpression || atBoundary) && started && rawSpace) finishWord(index)
      // At a token boundary escaped whitespace is trivia, not a new argument.
      else if (!atBoundary || !rawSpace) {
        started = true
        indexable = false
        word += escape.value
      }
      index = escape.end
      continue
    }
    if (
      !started &&
      words.length > 0 &&
      !expression &&
      !clause &&
      !redirectTarget &&
      testAt(POWERSHELL_STOP_PARSING_RE, input, index)
    ) {
      word = "--%"
      started = true
      finishWord(index + 3)
      index += 2
      continue
    }
    if (char === "<" && input[index + 1] === "#" && (atBoundary || inExpression || indexable === "member")) {
      const memberOperator = indexable === "member" && /[.:]$/.test(started ? word : (words.at(-1) ?? ""))
      if (started) finishWord(index)
      const end = input.indexOf("#>", index + 2)
      if (end < 0) return { kind: "opaque", reason: "invalid-structure" }
      if (!memberOperator) indexable = false
      index = end + 1
      continue
    }
    if (
      char === "#" &&
      (atBoundary ||
        indexable === "member" ||
        (inExpression && !(close === "]" && /^[\p{L}\p{Nl}_][\p{L}\p{Nl}\d_.#+`\\]*$/u.test(word))))
    ) {
      const prev = started ? word : (words.at(-1) ?? "")
      const memberOperator = indexable === "member" && /[.:]$/.test(prev)
      if ((clause && clause !== "member") || prev.endsWith(",") || memberOperator) finishWord(index)
      else if (words.length || started || invocation) finishCommand(index)
      statementHead = !dangling
      const endings = [input.indexOf("\n", index), input.indexOf("\r", index)].filter((ending) => ending >= 0)
      const newline = endings.length > 0 ? Math.min(...endings) : -1
      if (newline === -1) {
        index = input.length
        break
      }
      index = input[newline] === "\r" && input[newline + 1] === "\n" ? newline + 1 : newline
      continue
    }
    if (inExpression && started && (char === ">" || (char === "*" && input[index + 1] === ">"))) finishWord(index)
    const redirect =
      !started &&
      (char === ">" ||
        char === "*" ||
        (/\d/.test(char) && (words.length > 0 || testAt(POWERSHELL_MERGE_REDIRECT_RE, input, index))))
        ? powerShellRedirect(input, index)
        : undefined
    if (redirect === false) return { kind: "opaque", reason: "invalid-redirect" }
    if (redirect) {
      if (redirectTarget || words.length === 0 || (clause && clause !== "member"))
        return { kind: "opaque", reason: "invalid-redirect" }
      redirectTarget = !redirect.includes("&")
      indexable = false
      index += redirect.length - 1
      commandEnd = index + 1
      continue
    }
    if (!started && !words.length && !invocation && !expression && !clause && char === ":") {
      const label = matchAt(POWERSHELL_LABEL_RE, input, index)
      if (label) {
        index += label[0].length - 1
        continue
      }
    }
    if (
      !started &&
      !invocation &&
      !clause &&
      (!words.length ? !expression : words.every((item) => item.startsWith("["))) &&
      /[A-Za-z]/.test(char)
    ) {
      const keyword = matchAt(POWERSHELL_KEYWORD_RE, input, index)?.[0]?.toLowerCase()
      if (
        keyword &&
        (words.length > 0
          ? (keyword === "param" && testAt(POWERSHELL_PARAM_RE, input, index)) ||
            keyword === "class" ||
            keyword === "enum"
          : (keyword === "param" && testAt(POWERSHELL_PARAM_RE, input, index)) ||
            (keyword === "foreach" && testAt(POWERSHELL_FOREACH_RE, input, index)) ||
            (keyword === "until" && after === "do") ||
            ((keyword === "else" || keyword === "elseif") && after === "if") ||
            ((keyword === "catch" || keyword === "finally") && after === "try") ||
            /^(?:if|for|while|do|switch|function|filter|workflow|parallel|sequence|configuration|try|begin|process|end|clean|trap|class|enum|data|dynamicparam|using|break|continue)$/.test(
              keyword,
            ))
      ) {
        expression = /^(?:class|enum|break|continue)$/.test(keyword)
        clause =
          keyword === "using" || keyword === "break" || keyword === "continue"
            ? "member"
            : keyword === "param" || keyword === "until" || (keyword === "while" && after === "do")
              ? "paren"
              : keyword === "do"
                ? "do"
                : keyword === "if" || keyword === "elseif"
                  ? "if"
                  : keyword === "try" || keyword === "catch"
                    ? "try"
                    : keyword === "switch"
                      ? "switch"
                      : keyword === "class" || keyword === "enum"
                        ? "clause"
                        : "block"
        after = undefined
        index += keyword.length - 1
        continue
      }
      if (!words.length && keyword && /^(?:return|throw|exit)$/.test(keyword)) {
        after = undefined
        index += keyword.length - 1
        continue
      }
    }
    const assign = inExpression && !clause && (char === "=" || (/[-+*/%]/.test(char) && input[index + 1] === "="))
    if (assign || (inExpression && close === ")" && !started && testAt(POWERSHELL_IN_RE, input, index))) {
      if (assign) finishWord(index)
      words.length = 0
      rawWords.length = 0
      wordEnds.length = 0
      expression = false
      indexable = false
      if (!assign || char !== "=") index++
      continue
    }
    if (atBoundary && char === "@" && !testAt(POWERSHELL_AT_OPENER_RE, input, index + 1))
      return { kind: "opaque", reason: "invalid-structure" }
    if (atBoundary && char === "@" && (input[index + 1] === "'" || input[index + 1] === '"')) {
      if (started) finishWord(index)
      wordStart = index
      const literal = powerShellHereString(input, index, depth, budget, skipped)
      if (literal.kind === "opaque") return literal
      if (!words.length && !invocation) expression = true
      nestedCommands.push(...literal.commands)
      word = literal.source
      started = true
      index = literal.end
      finishWord(index + 1)
      indexable = "closed"
      continue
    }
    if (char === "$" && input[index + 1] === "{") {
      const end = powerShellBracedVariable(input, index, skipped)
      if (end === undefined) return { kind: "opaque", reason: "invalid-structure" }
      if (!started && !words.length && !invocation && hash !== "switch") expression = true
      indexable = atBoundary || (indexable === "member" && /[.:]$/.test(word)) ? "closed" : false
      word += input.slice(index, end + 1)
      started = true
      index = end
      if (expression && !redirectTarget && input[index + 1] !== "[") finishWord(index + 1)
      continue
    }
    const opener =
      (char === "$" || (atBoundary && char === "@")) && input[index + 1] === "("
        ? index + 1
        : atBoundary && char === "@" && input[index + 1] === "{"
          ? index + 1
          : char === "(" ||
              char === "{" ||
              (char === "[" &&
                (inExpression ||
                  Boolean(indexable) ||
                  (!started && !invocation && (!words.length || clause === "block" || clause === "try"))))
            ? index
            : undefined
    if (opener !== undefined) {
      const openChar = input[opener]
      const standaloneBlock = atBoundary || inExpression || char === "(" || openChar === "{"
      const blockClose = openChar === "(" ? ")" : openChar === "[" ? "]" : "}"
      const blockHash =
        openChar === "["
          ? true
          : char === "@" && openChar === "{"
            ? true
            : clause === "switch" && openChar === "{"
              ? "switch"
              : clause === "clause" && openChar === "{"
                ? "clause"
                : close === "]" && char === "(" && started
                  ? "clause"
                  : false
      if (started && (char === "{" || char === "(" || (char === "@" && atBoundary))) {
        finishWord(index)
        if (stopParsing) {
          index--
          continue
        }
        wordStart = index
      }
      if (!started && !words.length && !invocation) expression = true
      const result = scanPowerShellList(input, opener + 1, depth + 1, budget, blockClose, blockHash, skipped)
      if (result.kind === "opaque") return result
      nestedCommands.push(...result.commands)
      started = true
      word += input.slice(index, result.end + 1)
      index = result.end
      if (openChar === "[") {
        indexable = "closed"
        if (input[index + 1] !== "[") finishWord(index + 1)
      } else if (standaloneBlock) {
        finishWord(index + 1)
        indexable = "closed"
      }
      if ((clause === "paren" && char === "(") || (clause && clause !== "paren" && char === "{")) {
        const completed = clause === "do" || clause === "if" || clause === "try" ? clause : undefined
        clause = "member"
        finishCommand(index + 1)
        after = completed
      }
      continue
    }
    if (char === close) break
    if (char === "}" || char === ")" || (char === "]" && inExpression))
      return { kind: "opaque", reason: "invalid-structure" }
    if (
      !started &&
      words.length === 0 &&
      ((char === "&" && input[index + 1] !== "&") ||
        (char === "." && (!input[index + 1] || /[\s"'$(),;{|}&]/.test(input[index + 1]))))
    ) {
      if (invocation) return { kind: "opaque", reason: "invalid-structure" }
      segment = index
      invocation = true
      after = undefined
      continue
    }
    if (/\s/.test(char) && char !== "\n" && char !== "\r") {
      finishWord(index)
      indexable = false
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
        close === "]" &&
        (separator === ";" || separator === "|" || separator === "||" || separator === "&&" || separator === "&")
      )
        return { kind: "opaque", reason: "invalid-structure" }
      if (separator === "\n" || separator === "\r" || separator === "\r\n") {
        const prev = started ? word : (words.at(-1) ?? "")
        const memberOperator = indexable === "member" && /[.:]$/.test(prev)
        if ((clause && clause !== "member") || prev.endsWith(",") || memberOperator) {
          finishWord(index)
          index += separator.length - 1
          if (!memberOperator) indexable = false
          continue
        }
        if (!started && !words.length && !invocation) {
          index += separator.length - 1
          indexable = false
          continue
        }
      }
      finishCommand(index, dangling || ![";", "\n", "\r", "\r\n"].includes(separator))
      dangling = ![";", "&", "\n", "\r", "\r\n"].includes(separator)
      statementHead = !dangling
      index += separator.length - 1
      continue
    }
    if (!started && !words.length && !invocation && hash !== "switch" && testAt(POWERSHELL_EXPRESSION_RE, input, index))
      expression = true
    if ((atBoundary || (indexable === "member" && /[.:]$/.test(word))) && char === "$")
      indexable = testAt(POWERSHELL_INDEXABLE_VAR_RE, input, index + 1) ? "variable" : false
    else if (indexable === "closed")
      indexable =
        (char === "." && input[index + 1] !== "." && !/\s/.test(input[index + 1] ?? "")) ||
        (!started && char === ":" && input[index + 1] === ":" && !/\s/.test(input[index + 2] ?? "")) ||
        (!started &&
          char === "?" &&
          input[index + 1] === "." &&
          input[index + 2] !== "." &&
          !/\s/.test(input[index + 2] ?? ""))
          ? "member"
          : !started && char === "?" && input[index + 1] === "["
            ? "closed"
            : false
    else if (indexable === "variable")
      indexable =
        (char === "." && input[index + 1] !== "." && !/\s/.test(input[index + 1] ?? "")) ||
        (char === ":" && input[index + 1] === ":" && !/\s/.test(input[index + 2] ?? ""))
          ? "member"
          : (char === "." && input[index + 1] === ".") || !/[\p{L}\p{Nl}\d_:?]/u.test(char)
            ? false
            : "variable"
    else if (indexable === "member")
      indexable =
        char === "." && input[index + 1] === "."
          ? false
          : (char === "." && !/\s/.test(input[index + 1] ?? "")) ||
              (char === ":" && (input[index + 1] === ":" || input[index - 1] === ":")) ||
              (char === "?" && input[index + 1] === "." && input[index + 2] !== ".") ||
              /[\p{L}\p{Nl}\d_]/u.test(char)
            ? "member"
            : false
    after = undefined
    started = true
    dangling = false
    word += char
  }

  if (close !== undefined && input[index] !== close) return { kind: "opaque", reason: "invalid-structure" }
  if (quote) return { kind: "opaque", reason: "unterminated-quote" }
  finishCommand(index)
  if (redirectTarget || invalid || dangling) return { kind: "opaque", reason: "invalid-structure" }
  if (commands.some((command) => !command.words[0])) return { kind: "opaque", reason: "dynamic-command-name" }
  return { kind: "scanned", commands, end: index }
}

const POWERSHELL_STOP_PARSING_RE = /--%(?=$|[\s;|&(){}])/y
const POWERSHELL_PARAMETER_COLON_RE = /^-[\p{L}\p{Nl}_?][\p{L}\p{Nl}\d_?-]*:$/u
const POWERSHELL_MERGE_REDIRECT_RE = /\d>&/y
const POWERSHELL_LABEL_RE = /:[A-Za-z_]\w*(?=\s*(?:while|for|foreach|do|switch)(?=$|[\s&(),;{|}]))/iy
const POWERSHELL_KEYWORD_RE = /[A-Za-z]+(?=$|[\s&(),;{|}])/y
const POWERSHELL_FOREACH_RE = /foreach\s*\(/isy
const POWERSHELL_PARAM_RE = /param\s*\(/isy
const POWERSHELL_IN_RE = /in(?=$|[\s&(),;{|}])/iy
const POWERSHELL_AT_OPENER_RE = /[({'"\p{L}\p{Nl}\d_?]/uy
const POWERSHELL_INDEXABLE_VAR_RE = /(?::[\p{L}\p{Nl}\d_?]+|[\p{L}\p{Nl}\d_][\p{L}\p{Nl}\d_?]*)/uy
const POWERSHELL_HERE_HEADER_RE = /@['"][^\S\r\n]*(?:\r\n|\r|\n)/y
const POWERSHELL_UNICODE_ESCAPE_RE = /u\{([0-9a-f]{1,6})\}/iy
const POWERSHELL_EXPRESSION_RE =
  /(?:!*(?:\+\+|--|[+-])?\$(?:\{|(?:\?|\$|\^)(?=$|[\s;|&(){},#>])|:[\p{L}\p{Nl}\d_?]+|[\p{L}\p{Nl}\d_][\p{L}\p{Nl}\d_?]*(?::[\p{L}\p{Nl}\d_?]+)?)|!(?![\p{L}\p{Nl}_.\d])|\+(?![=\p{L}\p{Nl}_.\d])|--(?!=)|-(?![=\p{L}\p{Nl}\d_?.])|,(?!\s*$)|!*[+-]?(?:0[xX][\da-fA-F]+|0[bB][01]+|(?:\d+(?:\.(?!\.)\d*|(?!\.(?!\.)))|\.\d+)(?:[eE][+-]?\d+)?)(?:[dDlLnN]|[uU][sSyYlL]?|[sSyY])?(?:[kKmMgGtTpP][bB])?(?=$|[\s!#%&()*+,\-/.;<=>\]|{}])|-(?:not|bnot|join|[ic]?split)(?![\p{L}\p{Nl}]))/iuy

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

function matchAt(regex: RegExp, input: string, index: number) {
  regex.lastIndex = index
  return regex.exec(input)
}

function testAt(regex: RegExp, input: string, index: number) {
  regex.lastIndex = index
  return regex.test(input)
}

function powerShellEscape(input: string, start: number, lineContinuation = false, skipped?: ReadonlySet<number>) {
  let next = start + 1
  while (skipped?.has(next)) next++
  const char = input[next]
  if (char === undefined) return
  if (char === "\r" || char === "\n")
    return {
      value: lineContinuation && char === "\r" && input[next + 1] === "\n" ? "\r\n" : char,
      end: next + (lineContinuation && char === "\r" && input[next + 1] === "\n" ? 1 : 0),
    }
  if (char === "u" && input[next + 1] === "{") {
    const code = matchAt(POWERSHELL_UNICODE_ESCAPE_RE, input, next)
    if (!code || Number.parseInt(code[1], 16) > 0x10ffff) return
    return { value: String.fromCodePoint(Number.parseInt(code[1], 16)), end: next + code[0].length - 1 }
  }
  return { value: POWERSHELL_ESCAPES[char] ?? char, end: next }
}

function powerShellBracedVariable(input: string, start: number, skipped?: ReadonlySet<number>) {
  for (let index = start + 2; index < input.length; index++) {
    if (skipped?.has(index)) continue
    if (input[index] === "`") {
      const escape = powerShellEscape(input, index, false, skipped)
      if (!escape) return
      index = escape.end
      continue
    }
    if (input[index] === "}") return index > start + 2 ? index : undefined
  }
}

function powerShellSubExpression(
  input: string,
  start: number,
  hereString: boolean,
  budget: { remaining: number },
  skipped?: ReadonlySet<number>,
) {
  const nextSkipped = new Set(skipped)
  let depth = 1
  let rawEnd: number | undefined
  for (let index = start; index < input.length; index++) {
    if (--budget.remaining < 0) return
    if (nextSkipped.has(index)) continue
    const char = input[index]
    if (char === "(") depth++
    else if (char === ")") {
      if (--depth === 0 && rawEnd === undefined) rawEnd = index
    } else if (!hereString && (char === '"' || char === "`")) {
      let next = index + 1
      while (nextSkipped.has(next)) next++
      if (input[next] === '"') {
        nextSkipped.add(index)
        index = next
      }
    }
  }
  return { skipped: nextSkipped, rawEnd }
}

function powerShellStopParsing(input: string, start: number, skipped?: ReadonlySet<number>) {
  let quoted = false
  for (let index = start; index < input.length; index++) {
    if (skipped?.has(index)) continue
    if (input[index] === '"') quoted = !quoted
    if (
      input[index] === "\r" ||
      input[index] === "\n" ||
      ((input[index] === "|" || (input[index] === "&" && input[index + 1] === "&")) && !quoted)
    )
      return index
  }
  return input.length
}

function powerShellHereString(
  input: string,
  start: number,
  depth: number,
  budget: { remaining: number },
  skipped?: ReadonlySet<number>,
): (Result & { source: string; end: number }) | { kind: "opaque"; reason: OpaqueReason } {
  const header = matchAt(POWERSHELL_HERE_HEADER_RE, input, start)
  if (!header) return { kind: "opaque", reason: "unterminated-quote" }
  const quote = input[start + 1]
  const body = start + header[0].length
  const commands: Command[] = []
  let lineStart = true
  for (let index = body; index < input.length; index++) {
    if (--budget.remaining < 0) return { kind: "opaque", reason: "invalid-structure" }
    if (skipped?.has(index)) continue
    if (lineStart && input[index] === quote && input[index + 1] === "@") {
      const end =
        index > body && input[index - 1] === "\n" && input[index - 2] === "\r"
          ? index - 2
          : index > body
            ? index - 1
            : index
      return { kind: "scanned", commands, source: input.slice(body, end), end: index + 1 }
    }
    if (quote === '"') {
      if (input[index] === "`") {
        const escape = powerShellEscape(input, index, false, skipped)
        if (!escape) return { kind: "opaque", reason: "unterminated-escape" }
        index = escape.end
        lineStart = false
        continue
      }
      if (input[index] === "$" && input[index + 1] === "{") {
        const end = powerShellBracedVariable(input, index, skipped)
        if (end === undefined) return { kind: "opaque", reason: "invalid-structure" }
        index = end
        lineStart = false
        continue
      }
      if (input[index] === "$" && input[index + 1] === "(") {
        const sub = powerShellSubExpression(input, index + 2, true, budget, skipped)
        if (!sub) return { kind: "opaque", reason: "invalid-structure" }
        const result = scanPowerShellList(input, index + 2, depth + 1, budget, ")", false, sub.skipped)
        if (result.kind === "opaque") return result
        commands.push(...result.commands)
        index = sub.rawEnd !== undefined && sub.rawEnd > result.end ? sub.rawEnd : result.end
        lineStart = false
        continue
      }
    }
    lineStart = input[index] === "\r" || input[index] === "\n"
  }
  return { kind: "opaque", reason: "unterminated-quote" }
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

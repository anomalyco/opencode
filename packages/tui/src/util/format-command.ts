/**
 * Formats a shell command for display by inserting line breaks at top-level
 * shell operators (;, |, &&, ||, ;;, |&). Only applies when the command
 * exceeds `threshold` characters. Continuation lines are indented two spaces.
 *
 * Quote-aware: will not split inside single/double quotes, backticks,
 * shell comments, arithmetic expansion $((...)), or heredoc bodies.
 */
export function formatShellCommand(command: string, threshold = 60): string {
  if (command.length <= threshold) return command
  return format(tokenize(command))
}

type Token =
  | { kind: "text"; value: string }
  | { kind: "op"; value: string }
  | { kind: "newline" }
  | { kind: "heredoc"; value: string }

function tokenize(command: string): Token[] {
  const s = new Scanner(command)
  const tokens: Token[] = []
  let text = ""
  let quote: "'" | '"' | "`" | null = null
  let inComment = false
  let heredocDelim: string | null = null
  let arithDepth = 0

  const flush = () => {
    if (text) {
      tokens.push({ kind: "text", value: text })
      text = ""
    }
  }

  while (!s.done) {
    if (inComment) {
      if (s.char === "\n") {
        inComment = false
        flush()
        tokens.push({ kind: "newline" })
      } else {
        text += s.char
      }
      s.advance()
      continue
    }

    if (quote) {
      text += s.char
      // Backslash escapes in double quotes and backticks, not single quotes
      if (quote !== "'" && s.char === "\\" && s.peek() !== undefined) {
        text += s.peek()
        s.advance(2)
        continue
      }
      if (s.char === quote) quote = null
      s.advance()
      continue
    }

    if (s.char === "'" || s.char === '"' || s.char === "`") {
      quote = s.char
      text += s.char
      s.advance()
      continue
    }

    if (s.char === "\\" && s.peek() !== undefined) {
      text += s.char + s.peek()
      s.advance(2)
      continue
    }

    if (s.char === "\n") {
      flush()
      tokens.push({ kind: "newline" })
      s.advance()
      if (heredocDelim) {
        tokens.push(...readHeredocBody(s, heredocDelim))
        heredocDelim = null
      }
      continue
    }

    // # at a word boundary starts a comment
    if (s.char === "#" && (s.i === 0 || /[;|&(){}\s]/.test(s.prev))) {
      inComment = true
      text += s.char
      s.advance()
      continue
    }

    if (s.char === "<" && s.peek() === "<") {
      const delim = readHeredocDelim(s.command, s.i)
      if (delim) {
        heredocDelim = delim.value
        text += s.slice(delim.end)
        s.i = delim.end
        continue
      }
    }

    if (s.char === "$" && s.peek() === "(" && s.peek(2) === "(") {
      arithDepth++
      text += "$(("
      s.advance(3)
      continue
    }

    if (s.char === ")" && s.peek() === ")" && arithDepth > 0) {
      arithDepth--
      text += "))"
      s.advance(2)
      continue
    }

    const two = s.take(2)
    if (two === "&&" || two === "||" || two === ";;" || two === "|&") {
      // && and || are arithmetic operators inside $((...))
      if (arithDepth > 0 && (two === "&&" || two === "||")) {
        text += two
        s.advance(2)
        continue
      }
      flush()
      tokens.push({ kind: "op", value: two })
      s.advance(2)
      s.skipSpaces()
      continue
    }

    if (s.char === ";" || s.char === "|") {
      flush()
      tokens.push({ kind: "op", value: s.char })
      s.advance()
      s.skipSpaces()
      continue
    }

    text += s.char
    s.advance()
  }

  flush()
  return tokens
}

function format(tokens: Token[]): string {
  const lines: string[] = []
  let current = ""

  const flushLine = () => {
    const trimmed = current.trimEnd()
    if (trimmed) lines.push(trimmed)
    current = ""
  }

  for (const token of tokens) {
    if (token.kind === "op") {
      current += token.value
      lines.push(current.trimEnd())
      current = "  "
    } else if (token.kind === "newline" || token.kind === "heredoc") {
      flushLine()
      if (token.kind === "heredoc") lines.push(token.value)
    } else {
      current += token.value
    }
  }

  flushLine()
  return lines.join("\n")
}

class Scanner {
  i = 0
  constructor(readonly command: string) {}

  get char() { return this.command[this.i] }
  get done() { return this.i >= this.command.length }
  get prev() { return this.command[this.i - 1] }

  peek(offset = 1) { return this.command[this.i + offset] }
  take(n: number) { return this.command.slice(this.i, this.i + n) }
  slice(end: number) { return this.command.slice(this.i, end) }
  advance(n = 1) { this.i += n }
  skipSpaces() { while (this.i < this.command.length && this.command[this.i] === " ") this.i++ }
}

/** Parses a heredoc delimiter (<<DELIM, <<-DELIM, <<'DELIM') starting at `start`. */
function readHeredocDelim(command: string, start: number): { value: string; end: number } | null {
  let j = start + 2
  if (command[j] === "-") j++
  const delimQuote = command[j] === "'" || command[j] === '"' ? command[j] : null
  if (delimQuote) j++
  let delim = ""
  while (j < command.length && /[a-zA-Z0-9_]/.test(command[j])) {
    delim += command[j]
    j++
  }
  if (delimQuote && command[j] === delimQuote) j++
  if (!delim) return null
  return { value: delim, end: j }
}

/** Reads heredoc body lines from the scanner until `delim` is found. Advances `s.i`. */
function readHeredocBody(s: Scanner, delim: string): Token[] {
  const tokens: Token[] = []
  while (!s.done) {
    const j = s.command.indexOf("\n", s.i)
    const end = j === -1 ? s.command.length : j
    const line = s.command.slice(s.i, end)
    tokens.push({ kind: "heredoc", value: line })
    s.i = j === -1 ? s.command.length : j + 1
    if (line.trim() === delim) break
  }
  return tokens
}

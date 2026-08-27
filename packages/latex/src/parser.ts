import {
  LatexParseError,
  type AccentKind,
  type MathNode,
  type MathVariant,
  type MatrixEnvironment,
  type ParseOptions,
} from "./types"
import {
  assertNestingDepth,
  assertSourceLength,
  DEFAULT_MAX_NESTING_DEPTH,
  DEFAULT_MAX_SOURCE_LENGTH,
  resolvePositiveInteger,
} from "./limits"
import { delimiterTable, largeOperators, namedOperators, spacingCommands, symbolTable } from "./symbols"

const matrixEnvironments: MatrixEnvironment[] = [
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "cases",
  "aligned",
  "align",
  "gathered",
  "gather",
  "smallmatrix",
  "array",
]

const accents: Readonly<Record<string, AccentKind>> = {
  hat: "hat",
  widehat: "widehat",
  bar: "bar",
  overline: "overline",
  underline: "underline",
  vec: "vec",
  tilde: "tilde",
  widetilde: "tilde",
  dot: "dot",
  ddot: "ddot",
}

const variants: Readonly<Record<string, MathVariant>> = {
  mathrm: "normal",
  textrm: "normal",
  mathnormal: "normal",
  mathbf: "bold",
  boldsymbol: "bold",
  bm: "bold",
  mathit: "italic",
  mathsf: "sans",
  mathtt: "monospace",
  mathbb: "double-struck",
  mathcal: "script",
  mathscr: "script",
  mathfrak: "fraktur",
}

export function parseLatex(source: string, options: ParseOptions = {}): MathNode {
  const expanded = expandLatexMacros(source, options)
  const maxDepth = resolvePositiveInteger(options.maxDepth, DEFAULT_MAX_NESTING_DEPTH, "maxDepth")
  return new Parser(expanded, options.strict ?? false, maxDepth).parse()
}

export function expandLatexMacros(source: string, options: ParseOptions = {}): string {
  const maxSourceLength = resolvePositiveInteger(options.maxSourceLength, DEFAULT_MAX_SOURCE_LENGTH, "maxSourceLength")
  const maxExpandedLength = resolvePositiveInteger(options.maxExpandedLength, maxSourceLength, "maxExpandedLength")
  const maxExpand = resolvePositiveInteger(options.maxExpand, 100, "maxExpand")
  const maxDepth = resolvePositiveInteger(options.maxDepth, DEFAULT_MAX_NESTING_DEPTH, "maxDepth")
  assertSourceLength(source, maxSourceLength)
  assertNestingDepth(source, maxDepth)
  const expanded = expandMacros(source, options.macros, maxExpand, maxExpandedLength)
  if (expanded !== source) assertNestingDepth(expanded, maxDepth)
  return expanded
}

function expandMacros(
  source: string,
  macros: ParseOptions["macros"],
  maxExpand: number,
  maxExpandedLength: number,
): string {
  assertSourceLength(source, maxExpandedLength, "Expanded LaTeX source")
  if (!macros || Object.keys(macros).length === 0) return source

  let result = source
  for (let pass = 0; pass < maxExpand; pass++) {
    let changed = false
    let cursor = 0
    let outputLength = 0
    const output: string[] = []
    const commands = /\\[A-Za-z@]+|\\./g

    for (const match of result.matchAll(commands)) {
      const command = match[0]
      const index = match.index
      const replacement = macros[command] ?? macros[command.slice(1)]
      if (replacement === undefined) continue
      if (typeof replacement !== "string") {
        throw new TypeError(`Macro ${command} must expand to a string`)
      }

      appendWithinLimit(output, result.slice(cursor, index), outputLength, maxExpandedLength)
      outputLength += index - cursor
      appendWithinLimit(output, replacement, outputLength, maxExpandedLength)
      outputLength += replacement.length
      cursor = index + command.length
      changed = true
    }

    if (!changed) return result
    appendWithinLimit(output, result.slice(cursor), outputLength, maxExpandedLength)
    result = output.join("")
  }

  throw new LatexParseError(`Macro expansion exceeded ${maxExpand} passes`, 0)
}

function appendWithinLimit(output: string[], value: string, currentLength: number, maximum: number): void {
  if (currentLength + value.length > maximum) {
    throw new LatexParseError(`Expanded LaTeX source exceeds the ${maximum}-character limit`, maximum)
  }
  output.push(value)
}

class Parser {
  private position = 0
  private depth = 0

  constructor(
    private readonly source: string,
    private readonly strict: boolean,
    private readonly maxDepth: number,
  ) {}

  public parse(): MathNode {
    const body = this.parseRow()
    this.skipMathWhitespace()
    if (!this.done()) this.fail(`Unexpected "${this.peek()}"`)
    return row(body)
  }

  private parseRow(stop?: () => boolean): MathNode[] {
    const body: MathNode[] = []

    while (!this.done()) {
      this.skipMathWhitespace()
      if (this.done() || stop?.()) break

      const current = this.peek()
      if (current === "}") break

      if (current === "^" || current === "_") {
        this.position++
        const script = this.parseArgument()
        const previous = body.pop() ?? { type: "row", body: [] }
        const existing = previous.type === "scripts" ? previous : { type: "scripts" as const, base: previous }
        if (current === "^") existing.superscript = script
        else existing.subscript = script
        body.push(existing)
        continue
      }

      if (current === "\\" && this.applyLimitsModifier(body)) continue
      body.push(this.parseAtom())
    }

    return body
  }

  private parseAtom(): MathNode {
    this.depth++
    if (this.depth > this.maxDepth) {
      this.depth--
      this.fail(`LaTeX nesting exceeds the ${this.maxDepth}-level limit`)
    }
    try {
      return this.parseAtomInner()
    } finally {
      this.depth--
    }
  }

  private parseAtomInner(): MathNode {
    const current = this.peek()
    if (current === "{") return this.parseGroup()
    if (current === "\\") return this.parseCommand()
    if (current === "~") {
      this.position++
      return { type: "space", width: 1 }
    }

    this.position++
    return { type: "symbol", value: current, role: inferRole(current) }
  }

  private parseCommand(): MathNode {
    const start = this.position
    const command = this.readCommand()

    if (command === "\\") return { type: "row", body: [] }
    if (command === "begin") return this.parseEnvironment()
    if (command === "frac" || command === "dfrac" || command === "tfrac" || command === "cfrac") {
      this.skipMathWhitespace()
      const alignment =
        command === "cfrac" && this.peek() === "[" ? /^\[([lr]?)\]/.exec(this.source.slice(this.position)) : undefined
      if (alignment === null) this.fail("Unsupported \\cfrac alignment; expected [l], [r], or []")
      if (alignment) this.position += alignment[0].length
      return {
        type: "fraction",
        numerator: this.parseArgument(),
        denominator: this.parseArgument(),
        bar: true,
        ...(alignment?.[1] ? { numeratorAlign: alignment[1] === "l" ? "left" : "right" } : {}),
      }
    }
    if (command === "binom" || command === "dbinom" || command === "tbinom") {
      const fraction: MathNode = {
        type: "fraction",
        numerator: this.parseArgument(),
        denominator: this.parseArgument(),
        bar: false,
      }
      return { type: "delimited", left: "(", body: fraction, right: ")" }
    }
    if (command === "sqrt") {
      const index = this.parseOptionalArgument()
      const result: MathNode = { type: "root", body: this.parseArgument() }
      if (index) result.index = index
      return result
    }
    if (command === "left") return this.parseLeftRight()
    if (command === "middle") return { type: "symbol", value: this.readDelimiter() }
    if (command === "right") {
      this.position = start
      this.fail("Unexpected \\right")
    }
    if (command in accents) {
      return { type: "accent", accent: accents[command], body: this.parseArgument() }
    }
    if (command in variants) {
      return {
        type: "variant",
        variant: variants[command],
        body: command === "textrm" ? { type: "text", value: this.readTextGroup() } : this.parseArgument(),
      }
    }
    if (command === "text" || command === "mbox") return { type: "text", value: this.readTextGroup() }
    if (command === "operatorname") {
      const limits = this.peek() === "*"
      if (limits) this.position++
      return { type: "operator", value: this.readTextGroup(), limits }
    }
    if (command === "overset" || command === "stackrel") {
      const over = this.parseArgument()
      const base = this.parseArgument()
      return { type: "overunder", base, over }
    }
    if (command === "underset") {
      const under = this.parseArgument()
      const base = this.parseArgument()
      return { type: "overunder", base, under }
    }
    if (command === "overbrace" || command === "underbrace") {
      return { type: "brace", body: this.parseArgument(), position: command === "overbrace" ? "over" : "under" }
    }
    if (command === "textcolor") {
      const color = this.readRawGroup()
      return { type: "color", color, body: this.parseArgument() }
    }
    if (command === "color") {
      const color = this.readRawGroup()
      return { type: "color", color, body: row(this.parseRow()) }
    }
    if (command === "not") {
      const target = this.parseAtom()
      if (target.type === "symbol") return { ...target, value: negateSymbol(target.value) }
      return { type: "row", body: [{ type: "symbol", value: "¬" }, target] }
    }
    if (command === "pmod") {
      return {
        type: "row",
        body: [
          { type: "space", width: 1 },
          { type: "text", value: "(mod " },
          this.parseArgument(),
          { type: "text", value: ")" },
        ],
      }
    }
    if (command === "mod" || command === "bmod") return { type: "operator", value: "mod", limits: false }
    if (command === "displaylines") {
      this.skipMathWhitespace()
      this.expect("{")
      return this.parseMatrix("gathered", "}")
    }
    if (
      command === "limits" ||
      command === "nolimits" ||
      command === "displaystyle" ||
      command === "textstyle" ||
      command === "scriptstyle" ||
      command === "scriptscriptstyle"
    ) {
      return { type: "row", body: [] }
    }
    if (/^(?:big|Big|bigg|Bigg)[lrm]?$/.test(command)) {
      return { type: "symbol", value: this.readDelimiter() }
    }
    if (command in spacingCommands) return { type: "space", width: spacingCommands[command] }
    if (command in symbolTable) {
      const symbol = symbolTable[command]
      return { type: "symbol", value: symbol.value, ...(symbol.role ? { role: symbol.role } : {}) }
    }
    if (command in largeOperators) {
      return { type: "operator", value: largeOperators[command], limits: !command.includes("int") }
    }
    if (namedOperators.has(command)) {
      return {
        type: "operator",
        value: command,
        limits: command.startsWith("lim") || command === "min" || command === "max",
      }
    }
    if (command === "backslash") return { type: "symbol", value: "\\" }
    const delimiter = delimiterTable[`\\${command}`] ?? delimiterTable[command]
    if (delimiter !== undefined) return { type: "symbol", value: delimiter }
    if (command === "{" || command === "}") return { type: "symbol", value: command }
    if (command === "%" || command === "#" || command === "$" || command === "&" || command === "_") {
      return { type: "symbol", value: command }
    }

    if (this.strict) this.fail(`Unsupported command \\${command}`, start)
    return { type: "text", value: `\\${command}` }
  }

  private parseEnvironment(): MathNode {
    const rawEnvironment = this.readRawGroup()
    const unstarredEnvironment = rawEnvironment.endsWith("*") ? rawEnvironment.slice(0, -1) : rawEnvironment
    const environment = matrixEnvironments.find((name) => name === unstarredEnvironment)
    if (!environment) {
      if (this.strict) this.fail(`Unsupported environment ${unstarredEnvironment}`)
      const content = this.readUntilEnd(rawEnvironment)
      return { type: "text", value: content }
    }
    const columns = environment === "array" ? this.readRawGroup().replace(/\s/g, "") : undefined
    if (columns !== undefined && (!/^[lcr|]+$/.test(columns) || !/[lcr]/.test(columns))) {
      this.fail("Unsupported array columns; expected l, c, r, and |")
    }
    return this.parseMatrix(environment, `\\end{${rawEnvironment}}`, columns)
  }

  private parseMatrix(environment: MatrixEnvironment, end: string, columns?: string): MathNode {
    const rows: MathNode[][] = []
    let cells: MathNode[] = []

    while (!this.done()) {
      this.skipMathWhitespace()
      if (this.source.startsWith(end, this.position) && cells.length === 0) break

      const cellStart = this.position
      const cell = row(
        this.parseRow(
          () =>
            this.peek() === "&" ||
            this.source.startsWith("\\\\", this.position) ||
            this.source.startsWith(end, this.position),
        ),
      )
      cells.push(cell)
      this.skipMathWhitespace()

      if (this.peek() === "&") {
        this.position++
        continue
      }
      if (this.source.startsWith("\\\\", this.position)) {
        this.position += 2
        this.consumeOptionalBracket()
        rows.push(cells)
        cells = []
        continue
      }
      if (this.source.startsWith(end, this.position)) break
      // Empty cells are valid only when a cell, row, or closing delimiter advances the parser.
      if (this.position === cellStart) this.fail(`Unexpected "${this.peek()}" in ${environment}`)
    }

    if (!this.source.startsWith(end, this.position)) this.fail(`Missing ${end}`)
    this.expect(end)
    if (cells.length > 0 || rows.length === 0) rows.push(cells)
    return { type: "matrix", rows, environment, ...(columns !== undefined ? { columns } : {}) }
  }

  private parseLeftRight(): MathNode {
    const left = this.readDelimiter()
    const atRight = () =>
      this.source.startsWith("\\right", this.position) && !/[A-Za-z@]/.test(this.source[this.position + 6] ?? "")
    const body = row(this.parseRow(atRight))
    if (!atRight()) this.fail("Missing \\right")
    this.readCommand()
    const right = this.readDelimiter()
    return { type: "delimited", left, body, right }
  }

  private parseArgument(): MathNode {
    this.skipMathWhitespace()
    if (this.peek() === "{") return this.parseGroup()
    if (this.done()) this.fail("Expected an argument")
    return this.parseAtom()
  }

  private parseGroup(): MathNode {
    this.expect("{")
    const body = row(this.parseRow())
    this.expect("}")
    return body
  }

  private parseOptionalArgument(): MathNode | undefined {
    this.skipMathWhitespace()
    if (this.peek() !== "[") return undefined
    this.position++
    const body = row(this.parseRow(() => this.peek() === "]"))
    this.expect("]")
    return body
  }

  private consumeOptionalBracket(): void {
    this.skipMathWhitespace()
    if (this.peek() !== "[") return
    let depth = 0
    while (!this.done()) {
      const char = this.source[this.position++]
      if (char === "[") depth++
      if (char === "]" && --depth === 0) return
    }
  }

  private readDelimiter(): string {
    this.skipMathWhitespace()
    if (this.done()) this.fail("Expected a delimiter")
    const start = this.position
    if (this.peek() === "\\") {
      const command = this.readCommand()
      const delimiter = delimiterTable[`\\${command}`] ?? delimiterTable[command]
      if (delimiter !== undefined) return delimiter
      if (this.strict) this.fail(`Unsupported delimiter \\${command}`, start)
      return `\\${command}`
    }
    const token = this.source[this.position++]
    return delimiterTable[token] ?? token
  }

  private readCommand(): string {
    this.expect("\\")
    if (this.done()) return "\\"
    const next = this.peek()
    if (!/[A-Za-z@]/.test(next)) {
      this.position++
      return next
    }

    const start = this.position
    while (!this.done() && /[A-Za-z@]/.test(this.peek())) this.position++
    const command = this.source.slice(start, this.position)
    if (this.peek() === " ") this.position++
    return command
  }

  private readRawGroup(): string {
    this.skipMathWhitespace()
    this.expect("{")
    const start = this.position
    let depth = 1
    while (!this.done()) {
      const char = this.source[this.position++]
      const escaped = (char === "{" || char === "}") && this.isEscaped(this.position - 1)
      if (char === "{" && !escaped) depth++
      if (char === "}" && !escaped && --depth === 0) return this.source.slice(start, this.position - 1)
    }
    return this.fail("Unterminated group", start)
  }

  private applyLimitsModifier(body: MathNode[]): boolean {
    const match = /^\\(limits|nolimits)(?![A-Za-z@])/.exec(this.source.slice(this.position))
    if (!match) return false
    this.position += match[0].length

    const target = body.at(-1)
    const operator =
      target?.type === "operator"
        ? target
        : target?.type === "scripts" && target.base.type === "operator"
          ? target.base
          : undefined
    if (operator) operator.limits = match[1] === "limits"
    return true
  }

  private isEscaped(index: number): boolean {
    let slashCount = 0
    for (let cursor = index - 1; cursor >= 0 && this.source[cursor] === "\\"; cursor--) slashCount++
    return slashCount % 2 === 1
  }

  private readTextGroup(): string {
    return this.readRawGroup()
      .replace(/\\([A-Za-z@]+|.)/g, (match, command: string) => {
        if ("{}%#$&_ ".includes(command)) return command
        if (command === "textbackslash") return "\\"
        if (command === "!") return ""
        if (command in spacingCommands) return " ".repeat(Math.max(1, spacingCommands[command]))
        return match
      })
      .replace(/~/g, " ")
  }

  private readUntilEnd(environment: string): string {
    const marker = `\\end{${environment}}`
    const end = this.source.indexOf(marker, this.position)
    if (end < 0) this.fail(`Missing ${marker}`)
    const content = this.source.slice(this.position, end)
    this.position = end + marker.length
    return content
  }

  private skipMathWhitespace(): void {
    while (!this.done()) {
      if (/\s/.test(this.peek())) {
        this.position++
        continue
      }
      if (this.peek() === "%") {
        while (!this.done() && this.peek() !== "\n") this.position++
        continue
      }
      break
    }
  }

  private expect(value: string): void {
    if (!this.source.startsWith(value, this.position)) this.fail(`Expected "${value}"`)
    this.position += value.length
  }

  private peek(): string {
    return this.source[this.position] ?? ""
  }

  private done(): boolean {
    return this.position >= this.source.length
  }

  private fail(message: string, position = this.position): never {
    throw new LatexParseError(message, position)
  }
}

function row(body: MathNode[]): MathNode {
  if (body.length === 1) return body[0]
  return { type: "row", body }
}

function inferRole(value: string): "binary" | "relation" | "punctuation" | "opening" | "closing" | "ordinary" {
  if ("+-*/×÷±∓".includes(value)) return "binary"
  if ("=<>≤≥≠≈∈∉⊂⊃".includes(value)) return "relation"
  if (",;:".includes(value)) return "punctuation"
  if ("([{".includes(value)) return "opening"
  if (")]}".includes(value)) return "closing"
  return "ordinary"
}

function negateSymbol(value: string): string {
  const negated: Record<string, string> = {
    "=": "≠",
    "∈": "∉",
    "∋": "∌",
    "≡": "≢",
    "≈": "≉",
    "∼": "≁",
    "<": "≮",
    ">": "≯",
    "≤": "≰",
    "≥": "≱",
    "⊂": "⊄",
    "⊃": "⊅",
    "⊆": "⊈",
    "⊇": "⊉",
    "∣": "∤",
    "∥": "∦",
  }
  return negated[value] ?? `${value}̸`
}

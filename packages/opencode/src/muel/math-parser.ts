export interface MathMatch {
  expression: string
  claimedResult: string
  correctResult: number
  startIndex: number
  endIndex: number
}

type TokenType = "NUMBER" | "PLUS" | "MINUS" | "STAR" | "SLASH" | "PERCENT" | "LPAREN" | "RPAREN" | "EQUALS" | "EOF"

interface Token {
  type: TokenType
  value: string
}

function isDigit(c: string): boolean {
  const code = c.charCodeAt(0)
  return code >= 48 && code <= 57
}

function isAlpha(c: string): boolean {
  const code = c.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95
}

const MATH_OPS = new Set<string>(["+", "-", "*", "x", "X", "/", "%", "=", "(", ")"])

function scanSegment(text: string, start: number): { tokens: Token[]; endIndex: number } | null {
  const tokens: Token[] = []
  let i = start
  while (i < text.length) {
    const c = text[i]
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++
      continue
    }
    if (isDigit(c) || c === ".") {
      let num = ""
      let dotCount = 0
      while (i < text.length && (isDigit(text[i]) || text[i] === ".")) {
        if (text[i] === ".") dotCount++
        if (dotCount > 1) return null
        num += text[i]
        i++
      }
      tokens.push({ type: "NUMBER", value: num })
    } else if (MATH_OPS.has(c)) {
      switch (c) {
        case "+": tokens.push({ type: "PLUS", value: "+" }); break
        case "-": tokens.push({ type: "MINUS", value: "-" }); break
        case "*": case "x": case "X": tokens.push({ type: "STAR", value: "*" }); break
        case "/": tokens.push({ type: "SLASH", value: "/" }); break
        case "%": tokens.push({ type: "PERCENT", value: "%" }); break
        case "(": tokens.push({ type: "LPAREN", value: "(" }); break
        case ")": tokens.push({ type: "RPAREN", value: ")" }); break
        case "=": tokens.push({ type: "EQUALS", value: "=" }); break
      }
      i++
    } else {
      if (tokens.length === 0) return null
      break
    }
  }
  if (tokens.length === 0) return null
  return { tokens, endIndex: i }
}

class Parser {
  private tokens: Token[]
  private pos: number

  constructor(tokens: Token[]) {
    this.tokens = tokens
    this.pos = 0
  }

  private peek(): Token {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : { type: "EOF", value: "" }
  }

  private consume(): Token {
    const t = this.tokens[this.pos]
    this.pos++
    return t ?? { type: "EOF", value: "" }
  }

  private expect(type: TokenType): Token {
    const t = this.consume()
    if (t.type !== type) throw new Error(`Expected ${type}, got ${t.type}`)
    return t
  }

  parseExpression(): number {
    let left = this.parseTerm()
    while (this.peek().type === "PLUS" || this.peek().type === "MINUS") {
      const op = this.consume().type
      const right = this.parseTerm()
      left = op === "PLUS" ? left + right : left - right
    }
    return left
  }

  private parseTerm(): number {
    let left = this.parseFactor()
    while (this.peek().type === "STAR" || this.peek().type === "SLASH" || this.peek().type === "PERCENT") {
      const op = this.consume().type
      const right = this.parseFactor()
      if (op === "STAR") left = left * right
      else if (op === "SLASH") {
        left = right === 0 ? (left >= 0 ? Infinity : -Infinity) : left / right
      } else {
        left = left % right
      }
    }
    return left
  }

  private parseFactor(): number {
    if (this.peek().type === "MINUS") {
      this.consume()
      return -this.parseFactor()
    }
    if (this.peek().type === "LPAREN") {
      this.consume()
      const val = this.parseExpression()
      this.expect("RPAREN")
      return val
    }
    return this.parseNumber()
  }

  private parseNumber(): number {
    const t = this.consume()
    if (t.type !== "NUMBER") throw new Error(`Expected NUMBER, got ${t.type}`)
    return parseFloat(t.value)
  }
}

function parseClaimed(tokens: Token[]): number | null {
  let i = 0
  let negative = false
  if (i < tokens.length && tokens[i].type === "MINUS") {
    negative = true
    i++
  }
  if (i < tokens.length && tokens[i].type === "NUMBER") {
    const val = parseFloat(tokens[i].value)
    return negative ? -val : val
  }
  return null
}

function parseExpressionOnly(tokens: Token[]): { expr: string; result: number } | null {
  const nonEq = tokens.filter((t) => t.type !== "EQUALS")
  const filtered = nonEq.filter((t) => t.type !== "EQUALS")
  if (filtered.length === 0) return null
  const expr = filtered.map((t) => t.value).join("")
  const parser = new Parser(filtered)
  try {
    const result = parser.parseExpression()
    return { expr, result }
  } catch {
    return null
  }
}

export function detectAndVerify(text: string): MathMatch | null {
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (isDigit(c) || c === "." || c === "(" || c === "+" || c === "-") {
      const scanned = scanSegment(text, i)
      if (scanned && scanned.tokens.length > 2) {
        const eqPos = scanned.tokens.findIndex((t) => t.type === "EQUALS")
        if (eqPos > 0 && eqPos < scanned.tokens.length - 1) {
          const leftTokens = scanned.tokens.slice(0, eqPos)
          const rightTokens = scanned.tokens.slice(eqPos + 1)
          const claimed = parseClaimed(rightTokens)
          if (claimed !== null) {
            const exprText = leftTokens.map((t) => t.value).join("")
            const parsed = parseExpressionOnly(leftTokens)
            if (parsed) {
              const epsilon = 0.001
              if (Math.abs(parsed.result - claimed) > epsilon) {
                return {
                  expression: parsed.expr,
                  claimedResult: String(claimed),
                  correctResult: parsed.result,
                  startIndex: i,
                  endIndex: scanned.endIndex,
                }
              }
            }
          }
        }
        i = scanned.endIndex
      } else {
        i++
      }
    } else {
      i++
    }
  }
  return null
}

export function extractExpressionFromText(text: string): { expr: string; result: number } | null {
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (isDigit(c) || c === "." || c === "(" || c === "+" || c === "-") {
      const scanned = scanSegment(text, i)
      if (scanned && scanned.tokens.length > 2) {
        const noEq = scanned.tokens.filter((t) => t.type !== "EQUALS")
        const plusMinusStarSlash = noEq.filter((t) => t.type === "NUMBER" || t.type === "PLUS" || t.type === "MINUS" || t.type === "STAR" || t.type === "SLASH" || t.type === "PERCENT" || t.type === "LPAREN" || t.type === "RPAREN")
        if (plusMinusStarSlash.length >= 3) {
          try {
            const parser = new Parser(plusMinusStarSlash)
            const result = parser.parseExpression()
            const expr = plusMinusStarSlash.map((t) => t.value).join("")
            return { expr, result }
          } catch {
            // not a valid expression, continue scanning
          }
        }
      }
      i = scanned ? scanned.endIndex : i + 1
    } else {
      i++
    }
  }
  return null
}

export function tokenizeExpression(expr: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < expr.length) {
    const c = expr[i]
    if (c === " " || c === "\t") { i++; continue }
    if (isDigit(c) || c === ".") {
      let num = ""
      while (i < expr.length && (isDigit(expr[i]) || expr[i] === ".")) { num += expr[i]; i++ }
      tokens.push(num)
    } else if (c === "-" && (tokens.length === 0 || tokens[tokens.length - 1] === "(" || "+-*/%".includes(tokens[tokens.length - 1]))) {
      tokens.push(c); i++
      if (i < expr.length && isDigit(expr[i])) {
        let num = c
        while (i < expr.length && (isDigit(expr[i]) || expr[i] === ".")) { num += expr[i]; i++ }
        tokens[tokens.length - 1] = num
      }
    } else {
      tokens.push(c); i++
    }
  }
  return tokens
}

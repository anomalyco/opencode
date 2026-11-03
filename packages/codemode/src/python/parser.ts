import { fail, stringLiteral, tokenize, type Token } from "./lexer.js"
import { pythonKeywords } from "./names.js"

export type Expr = { site: Token } & (
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "name"; name: string }
  | { kind: "lambda"; params: string[]; body: Body }
  | { kind: "list" | "tuple" | "fstring"; items: Expr[] }
  | { kind: "dict"; pairs: [Expr, Expr][] }
  | { kind: "comprehension"; item: Expr; binding: Binding; source: Expr; guard?: Expr }
  | { kind: "attribute"; target: Expr; name: string }
  | { kind: "index"; target: Expr; key: Expr }
  | { kind: "slice"; target: Expr; start?: Expr; stop?: Expr; step?: Expr }
  | { kind: "call"; target: Expr; args: { spread: boolean; keyword?: string; expr: Expr }[] }
  | { kind: "unary"; op: string; arg: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "compare"; left: Expr; rest: { op: string; right: Expr }[] }
)
export type Body = Stmt[]
export type Binding = string | { items: Binding[]; star: number }
export function bindingNames(target: Binding): string[] {
  return typeof target === "string" ? [target] : target.items.flatMap(bindingNames)
}
export type Stmt = { site: Token } & (
  | { kind: "expr"; expr: Expr }
  | { kind: "assign"; target: Extract<Expr, { kind: "name" | "index" }>; op: string; expr: Expr }
  | { kind: "unpack"; binding: Binding; expr: Expr }
  | { kind: "return"; expr?: Expr }
  | { kind: "pass" | "break" | "continue" }
  | { kind: "import"; name: string; gather: boolean }
  | { kind: "if"; branches: { test: Expr; body: Body }[]; otherwise: Body }
  | { kind: "for"; binding: Binding; source: Expr; body: Body }
  | { kind: "while"; test: Expr; body: Body }
  | { kind: "function"; name: string; params: string[]; async: boolean; body: Body }
  | { kind: "try"; body: Body; name?: string; handler: Body }
)

const comparison = new Set(["==", "!=", "<", "<=", ">", ">=", "in", "not in", "is", "is not"])
const precedence = new Map(
  [["or"], ["and"], [...comparison], ["+", "-"], ["*", "/", "//", "%"], ["**"]].flatMap((ops, index) =>
    ops.map((op) => [op, index + 1] as const),
  ),
)

export function parsePython(source: string): Body {
  const tokens = tokenize(source)
  let at = 0
  let depth = 0
  let loops = 0
  let async = true // the submitted program is an implicit async body
  const peek = () => tokens[at]!
  const take = () => tokens[at++]!
  const eat = (text: string) => {
    if (peek().text !== text) return false
    at++
    return true
  }
  const need = (text: string) => {
    if (!eat(text)) fail(peek(), `Expected '${text}'.`)
  }
  const kind = (type: string) => {
    if (peek().type !== type) fail(peek(), `Expected ${type}.`)
    return take()
  }
  const name = () => {
    const site = kind("name")
    if (pythonKeywords.has(site.text)) fail(site, `Expected a name, not '${site.text}'.`)
    return site.text
  }
  const checkDepth = () => {
    if (++depth > 100) fail(peek(), "Maximum Python syntax nesting exceeded.")
  }

  function suite(loop = false): Body {
    need(":")
    kind("newline")
    kind("indent")
    checkDepth()
    if (loop) loops++
    const result = block()
    if (loop) loops--
    depth--
    kind("dedent")
    return result
  }
  function block(): Body {
    const result: Body = []
    while (peek().type !== "dedent" && peek().type !== "eof") result.push(statement())
    return result
  }
  function statement(): Stmt {
    const site = peek()
    if (eat("if")) {
      const branches = [{ test: expression(), body: suite() }]
      while (eat("elif")) branches.push({ test: expression(), body: suite() })
      return { kind: "if", site, branches, otherwise: eat("else") ? suite() : [] }
    }
    if (eat("for")) {
      const target = binding("in")
      need("in")
      return { kind: "for", site, binding: target, source: tupleExpression(), body: suite(true) }
    }
    if (eat("while")) return { kind: "while", site, test: expression(), body: suite(true) }
    if (site.text === "async" || site.text === "def") {
      const isAsync = eat("async")
      need("def")
      const target = name()
      need("(")
      const params = parameters(")", site)
      const outer = { loops, async }
      loops = 0
      async = isAsync
      const body = suite()
      loops = outer.loops
      async = outer.async
      return { kind: "function", site, name: target, async: isAsync, params, body }
    }
    if (eat("try")) {
      const body = suite()
      need("except")
      need("Exception")
      const target = eat("as") ? name() : undefined
      return { kind: "try", site, body, ...(target && { name: target }), handler: suite() }
    }
    const result = simple(site)
    kind("newline")
    return result
  }
  function simple(site: Token): Stmt {
    if (eat("return"))
      return peek().type === "newline" ? { kind: "return", site } : { kind: "return", site, expr: tupleExpression() }
    if (eat("break") || eat("continue")) {
      if (!loops) fail(site, `'${site.text}' outside a loop.`)
      return { kind: site.text === "break" ? "break" : "continue", site }
    }
    if (eat("pass")) return { kind: "pass", site }
    if (eat("import") || eat("from")) {
      if (!eat("asyncio"))
        fail(
          site,
          "Only the built-in asyncio module is available; no import is needed for asyncio.gather.",
          "UnsupportedSyntax",
        )
      const gather = site.text === "from"
      if (gather) {
        need("import")
        if (!eat("gather")) fail(peek(), "Only gather is available from asyncio.", "UnsupportedSyntax")
      }
      return { kind: "import", site, name: eat("as") ? name() : gather ? "gather" : "asyncio", gather }
    }
    if (unpackAhead()) {
      const target = binding("=")
      need("=")
      return { kind: "unpack", site, binding: target, expr: tupleExpression() }
    }
    const target = tupleExpression()
    if (!["=", "+=", "-=", "*="].includes(peek().text)) return { kind: "expr", site, expr: target }
    const op = take().text
    if (target.kind !== "name" && target.kind !== "index")
      fail(site, "Expected a name or subscript as assignment target.")
    return { kind: "assign", site, target, op, expr: tupleExpression() }
  }
  // Patterns and expressions share tuple/list syntax, but *rest is only a binding here.
  // Try the pattern grammar only for an assignment, never for an ordinary subscript like row[key] = value.
  function unpackAhead() {
    const first = peek().text
    if (!["(", "[", "*"].includes(first) && tokens[at + 1]?.text !== ",") return false
    for (let i = at; ; i++) {
      const t = tokens[i]!
      if (t.type === "name" && !pythonKeywords.has(t.text)) continue
      if (t.type !== "operator") return false
      if (t.text === "=") return true
      if (!["(", ")", "[", "]", ",", "*"].includes(t.text)) return false
      // After a completed target, an opening delimiter starts a call or subscript, not a pattern.
      if (i > at && (t.text === "(" || t.text === "[")) {
        const prev = tokens[i - 1]!
        if (prev.type === "name" || prev.text === ")" || prev.text === "]") return false
      }
    }
  }
  function binding(end: string, forceSequence = false): Binding {
    checkDepth()
    const items: Binding[] = []
    let star = -1
    let sequence = forceSequence
    while (peek().text !== end) {
      if (peek().text === "*") {
        if (star !== -1) fail(peek(), "Only one starred target is allowed at each unpacking level.")
        star = items.length
        take()
      }
      if (eat("(")) {
        items.push(binding(")"))
        need(")")
      } else if (eat("[")) {
        items.push(binding("]", true))
        need("]")
      } else items.push(name())
      if (!eat(",")) break
      sequence = true
    }
    depth--
    if (!items.length && end !== ")" && end !== "]") fail(peek(), "Expected an unpacking target.")
    if (!sequence && star !== -1) fail(peek(), "A starred target must be in a list or tuple.")
    return !sequence && items.length === 1 ? items[0]! : { items, star }
  }
  function parameters(end: string, site: Token) {
    const params = list(end, name)
    if (new Set(params).size !== params.length) fail(site, "Duplicate parameter name.")
    return params
  }
  function tupleExpression(): Expr {
    const first = expression()
    if (!eat(",")) return first
    const items = [first]
    while (peek().type !== "newline" && !["=", ":", ")", "}"].includes(peek().text)) {
      items.push(expression())
      if (!eat(",")) break
    }
    return { kind: "tuple", site: first.site, items }
  }
  function list<A>(end: string, item: () => A): A[] {
    const items: A[] = []
    while (peek().text !== end) {
      items.push(item())
      if (!eat(",")) break
    }
    need(end)
    return items
  }
  function atom(): Expr {
    const site = peek()
    if (eat("(")) {
      if (eat(")")) return { kind: "tuple", site, items: [] }
      const result = tupleExpression()
      need(")")
      return result
    }
    if (eat("[")) {
      if (eat("]")) return { kind: "list", site, items: [] }
      const item = expression()
      if (eat("for")) {
        const target = binding("in")
        need("in")
        const source = expression()
        const guard = eat("if") ? expression() : undefined
        need("]")
        return { kind: "comprehension", site, item, binding: target, source, ...(guard && { guard }) }
      }
      const items = [item]
      while (eat(",") && peek().text !== "]") items.push(expression())
      need("]")
      return { kind: "list", site, items }
    }
    if (eat("{"))
      return {
        kind: "dict",
        site,
        pairs: list("}", (): [Expr, Expr] => {
          const key = expression()
          need(":")
          return [key, expression()]
        }),
      }
    if (site.type === "fstart") {
      take()
      const items: Expr[] = []
      while (peek().type !== "fend") {
        if (peek().type === "ftext") {
          const text = take()
          items.push({ kind: "literal", site: text, value: stringLiteral(text) })
          continue
        }
        kind("field")
        items.push(tupleExpression())
        kind("endfield")
      }
      take()
      return { kind: "fstring", site, items }
    }
    if (site.type === "string") return { kind: "literal", site, value: stringLiteral(take()) }
    if (site.type === "number") {
      const value = Number(take().text)
      if (!Number.isFinite(value) || /^0\d/.test(site.text)) fail(site, "Invalid or out-of-range number.")
      return { kind: "literal", site, value }
    }
    if (eat("True") || eat("False")) return { kind: "literal", site, value: site.text === "True" }
    if (eat("None")) return { kind: "literal", site, value: null }
    if (pythonKeywords.has(site.text)) fail(site, `Unsupported Python syntax '${site.text}'.`, "UnsupportedSyntax")
    return { kind: "name", site, name: name() }
  }
  function expression(min = 1): Expr {
    checkDepth()
    const site = peek()
    let left: Expr
    if (min === 1 && eat("lambda")) {
      const params = parameters(":", site)
      const outer = async
      async = false
      const expr = expression()
      async = outer
      depth--
      return { kind: "lambda", site, params, body: [{ kind: "return", site: expr.site, expr }] }
    }
    if (eat("not") || eat("-") || eat("+") || eat("await")) {
      if (min > 6 || (site.text === "not" && min > 3)) fail(site, `Unexpected '${site.text}'.`)
      if (site.text === "await" && !async) fail(site, "'await' outside an async function.")
      left = {
        kind: "unary",
        site,
        op: site.text,
        arg: expression(site.text === "not" ? 3 : site.text === "await" ? 7 : 6),
      }
    } else {
      left = atom()
      while (true) {
        if (eat(".")) left = { kind: "attribute", site, target: left, name: name() }
        else if (eat("[")) {
          const start = peek().text !== ":" ? expression() : undefined
          if (eat(":")) {
            const stop = ![":", "]"].includes(peek().text) ? expression() : undefined
            const step = eat(":") && peek().text !== "]" ? expression() : undefined
            left = {
              kind: "slice",
              site,
              target: left,
              ...(start && { start }),
              ...(stop && { stop }),
              ...(step && { step }),
            }
          } else left = { kind: "index", site, target: left, key: start! }
          need("]")
        } else if (eat("(")) {
          const keywords = new Set<string>()
          const args = list(")", () => {
            if (peek().type === "name" && tokens[at + 1]?.text === "=") {
              const here = peek()
              const keyword = name()
              need("=")
              if (keywords.has(keyword)) fail(here, `Repeated keyword '${keyword}'.`)
              keywords.add(keyword)
              return { keyword, spread: false, expr: expression() }
            }
            if (keywords.size) fail(peek(), "Positional arguments must precede keyword arguments.")
            return { spread: eat("*"), expr: expression() }
          })
          left = { kind: "call", site, target: left, args }
        } else break
      }
    }
    while (true) {
      const here = peek()
      const pair =
        (here.text === "not" && tokens[at + 1]?.text === "in") || (here.text === "is" && tokens[at + 1]?.text === "not")
      const op = pair ? `${here.text} ${tokens[at + 1]!.text}` : here.text
      const priority = precedence.get(op) ?? 0
      if (priority < min) break
      at += pair ? 2 : 1
      const right = expression(priority + (op === "**" ? 0 : 1))
      if (comparison.has(op)) {
        if (left.kind === "compare" && left.site === site) left.rest.push({ op, right })
        else left = { kind: "compare", site, left, rest: [{ op, right }] }
      } else left = { kind: "binary", site, op, left, right }
    }
    depth--
    return left
  }
  const program = block()
  kind("eof")
  return program
}

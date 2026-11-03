import { Result } from "effect"
import { normalizeError } from "../interpreter/errors.js"
import { fail, type Token } from "./lexer.js"
import { bindingNames, type Binding, type Body, type Expr, parsePython } from "./parser.js"

/** Scheduled checks may only use the tools root as the start of a statically named call. */
export function scanPythonTools(code: string) {
  return Result.try({
    try: () => {
      const paths = new Set<string>()
      const binding = (target: Binding | undefined, site: Token) => {
        if (target !== undefined && bindingNames(target).includes("tools"))
          fail(site, "Schedule checks cannot rebind tools.", "UnsupportedSyntax")
      }
      function visit(expr: Expr): void {
        switch (expr.kind) {
          case "name":
            if (expr.name === "tools")
              fail(expr.site, "Schedule checks must call tools directly with static paths.", "UnsupportedSyntax")
            return
          case "literal":
            return
          case "lambda":
            expr.params.forEach((p) => binding(p, expr.site))
            return block(expr.body)
          case "call": {
            const path = toolPath(expr.target)
            if (path !== undefined) paths.add(path)
            else visit(expr.target)
            for (const arg of expr.args) visit(arg.expr)
            return
          }
          case "attribute":
            return visit(expr.target)
          case "index":
            visit(expr.target)
            return visit(expr.key)
          case "slice":
            visit(expr.target)
            if (expr.start) visit(expr.start)
            if (expr.stop) visit(expr.stop)
            if (expr.step) visit(expr.step)
            return
          case "unary":
            return visit(expr.arg)
          case "binary":
            visit(expr.left)
            return visit(expr.right)
          case "compare":
            visit(expr.left)
            for (const item of expr.rest) visit(item.right)
            return
          case "dict":
            for (const [key, value] of expr.pairs) {
              visit(key)
              visit(value)
            }
            return
          case "list":
          case "tuple":
          case "fstring":
            return expr.items.forEach(visit)
          case "comprehension":
            binding(expr.binding, expr.site)
            visit(expr.item)
            visit(expr.source)
            if (expr.guard) visit(expr.guard)
            return
          default:
            expr satisfies never
            throw new Error("Unsupported expression in schedule check.")
        }
      }
      function block(body: Body): void {
        for (const stmt of body) {
          switch (stmt.kind) {
            case "expr":
              visit(stmt.expr)
              break
            case "assign":
              visit(stmt.target)
              visit(stmt.expr)
              break
            case "unpack":
              binding(stmt.binding, stmt.site)
              visit(stmt.expr)
              break
            case "return":
              if (stmt.expr) visit(stmt.expr)
              break
            case "if":
              for (const branch of stmt.branches) {
                visit(branch.test)
                block(branch.body)
              }
              block(stmt.otherwise)
              break
            case "for":
              binding(stmt.binding, stmt.site)
              visit(stmt.source)
              block(stmt.body)
              break
            case "while":
              visit(stmt.test)
              block(stmt.body)
              break
            case "function":
              binding(stmt.name, stmt.site)
              stmt.params.forEach((name) => binding(name, stmt.site))
              block(stmt.body)
              break
            case "try":
              binding(stmt.name, stmt.site)
              block(stmt.body)
              block(stmt.handler)
              break
            case "import":
              binding(stmt.name, stmt.site)
              break
            case "pass":
            case "continue":
            case "break":
              break
            default:
              stmt satisfies never
              throw new Error("Unsupported statement in schedule check.")
          }
        }
      }
      block(parsePython(code))
      return [...paths]
    },
    catch: normalizeError,
  })
}

function toolPath(target: Expr): string | undefined {
  const segments: string[] = []
  while (target.kind === "attribute" || target.kind === "index") {
    if (target.kind === "attribute") segments.push(target.name)
    else if (target.key.kind === "literal" && typeof target.key.value === "string") segments.push(target.key.value)
    else return
    target = target.target
  }
  if (target.kind === "name" && target.name === "tools" && segments.length) return segments.reverse().join(".")
}

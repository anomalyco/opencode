import { toBoundary, type Json } from "../data.js"
import { type Interpreter } from "../interpreter/interpreter.js"
import { locate, materialize } from "../interpreter/errors.js"
import { checkArrayLength, checkStringLength } from "../interpreter/limits.js"
import { type AstNode, rangeError, referenceError, typeError } from "../interpreter/model.js"
import { fn } from "../interpreter/native.js"
import { Coroutine, define, Native, Obj, PromiseObj, record, type Value } from "../interpreter/objects.js"
import { combinator } from "../interpreter/promises.js"
import { Call, type Eval, Interruption, Slice } from "../interpreter/runner.js"
import { ToolReference } from "../tool-runtime.js"
import { type Binding, type Body, type Expr, parsePython } from "./parser.js"
import { type pythonNames } from "./names.js"
import { slice, sorted } from "./sequence.js"
import {
  arity,
  attribute,
  binary,
  display,
  integer,
  list,
  numeric,
  put,
  size,
  stringKey,
  subscript,
  truth,
  Tuple,
  values,
} from "./values.js"

type Scope = { locals: Map<string, Value>; parent?: Scope }
type Flow = { kind: "return"; value: Value } | { kind: "break" | "continue" } | undefined

export function compilePython(source: string) {
  const body = parsePython(source)
  return function* <R>(ctx: Interpreter<R>, globals: ReadonlyArray<readonly [string, Value]>): Eval<Json | undefined> {
    const builtins = ctx.builtins
    const asyncio = record(builtins.Object, {
      gather: fn(builtins, "gather", 0, (_, args, site) => {
        if (!args.every((arg) => arg instanceof Coroutine || arg instanceof PromiseObj))
          throw typeError("asyncio.gather expects awaitables.")
        // Schedule each distinct coroutine once. The caller keeps running until its next suspension.
        const scheduled = new Map<Coroutine, PromiseObj>()
        const futures = args.map((arg) => {
          if (arg instanceof PromiseObj) return arg
          const existing = scheduled.get(arg)
          if (existing) return existing
          const task = ctx.runner.schedule(arg.run(), site)
          scheduled.set(arg, task)
          return task
        })
        return combinator(ctx, "all", list(ctx, futures), site)
      }),
    })
    const names: Record<(typeof pythonNames)[number], Value> = {
      tools: new ToolReference([]),
      search: fn(builtins, "search", 1, (_, args) => ctx.tool(ctx.tools.search, args)),
      print: fn(builtins, "print", 0, function* (_, args) {
        ctx.logs.push(yield* display(ctx, args))
        return null
      }),
      str: fn(builtins, "str", 1, (_, args) => {
        arity("str", args, 0, 1)
        return display(ctx, args)
      }),
      len: fn(builtins, "len", 1, (_, args) => {
        arity("len", args, 1)
        return size(args[0])
      }),
      bool: fn(builtins, "bool", 1, (_, args) => {
        arity("bool", args, 0, 1)
        return truth(args[0])
      }),
      sorted: fn(builtins, "sorted", 1, (_, args, site) => sorted(ctx, args, new Map(), site)),
      list: fn(builtins, "list", 1, function* (_, args): Eval<Value> {
        arity("list", args, 0, 1)
        const result = list(ctx)
        if (args.length) {
          checkArrayLength(size(args[0]))
          for (const item of values(args[0])) {
            if (ctx.runner.tick()) yield Slice
            result.items.push(item)
          }
        }
        return result
      }),
      range: fn(builtins, "range", 1, function* (_, args): Eval<Value> {
        arity("range", args, 1, 3)
        const nums = args.map(integer)
        const start = nums.length === 1 ? 0 : nums[0]!
        const end = nums.length === 1 ? nums[0]! : nums[1]!
        const step = nums[2] ?? 1
        if (!step) throw rangeError("range() step cannot be zero.")
        const length = Math.max(0, Math.ceil((end - start) / step))
        checkArrayLength(length)
        const result = list(ctx)
        for (let i = 0; i < length; i++) {
          if (ctx.runner.tick()) yield Slice
          result.items.push(start + step * i)
        }
        return result
      }),
      asyncio,
    }
    const scope: Scope = { locals: new Map(), parent: { locals: new Map([...Object.entries(names), ...globals]) } }
    const parameters = new WeakMap<Native, Map<string, number>>()
    const lookup = (scope: Scope, expr: Extract<Expr, { kind: "name" }>): Value => {
      for (let frame: Scope | undefined = scope; frame; frame = frame.parent) {
        if (frame.locals.has(expr.name)) {
          const value = frame.locals.get(expr.name)
          if (value !== unbound) return value
          break
        }
      }
      throw referenceError(`Name '${expr.name}' is not defined.`, expr.site)
    }
    function* bind(binding: Binding, value: Value, scope: Scope, site: AstNode): Eval<void> {
      if (typeof binding === "string") {
        scope.locals.set(binding, value)
        return
      }
      // Do not change any target until the arity is known. Read at most one extra item.
      const iter = values(value, site)[Symbol.iterator]()
      const items: Value[] = []
      for (const _ of binding) {
        if (ctx.runner.tick()) yield Slice
        const item = iter.next()
        if (item.done) throw typeError(`Not enough values to unpack (expected ${binding.length}).`, site)
        items.push(item.value)
      }
      if (!iter.next().done) throw typeError(`Too many values to unpack (expected ${binding.length}).`, site)
      binding.forEach((name, i) => scope.locals.set(name, items[i]))
    }
    function* evaluate(expr: Expr, scope: Scope): Eval<Value> {
      if (ctx.runner.tick()) yield Slice
      try {
        switch (expr.kind) {
          case "literal":
            return expr.value
          case "name":
            return lookup(scope, expr)
          case "attribute":
            return attribute(ctx, yield* evaluate(expr.target, scope), expr.name)
          case "index":
            return subscript(yield* evaluate(expr.target, scope), yield* evaluate(expr.key, scope))
          case "slice":
            return yield* slice(
              ctx,
              yield* evaluate(expr.target, scope),
              expr.start && (yield* evaluate(expr.start, scope)),
              expr.stop && (yield* evaluate(expr.stop, scope)),
              expr.step && (yield* evaluate(expr.step, scope)),
            )
          case "fstring": {
            let result = ""
            for (const item of expr.items) {
              const text = yield* display(ctx, [yield* evaluate(item, scope)])
              checkStringLength(result.length + text.length)
              result += text
            }
            return result
          }
          case "tuple":
          case "list": {
            const result = expr.kind === "tuple" ? new Tuple(builtins.Array) : list(ctx)
            for (const item of expr.items) result.items.push(yield* evaluate(item, scope))
            return result
          }
          case "dict": {
            const result = new Obj(null)
            for (const [k, v] of expr.pairs)
              define(result, stringKey(yield* evaluate(k, scope)), yield* evaluate(v, scope))
            return result
          }
          case "comprehension": {
            const result = list(ctx)
            const inner = { locals: new Map<string, Value>(), parent: scope }
            for (const value of values(yield* evaluate(expr.source, scope))) {
              yield* bind(expr.binding, value, inner, expr.site)
              if (expr.guard && !truth(yield* evaluate(expr.guard, inner))) continue
              checkArrayLength(result.items.length + 1)
              result.items.push(yield* evaluate(expr.item, inner))
            }
            return result
          }
          case "call": {
            const callable = yield* evaluate(expr.target, scope)
            const args: Value[] = []
            const kw = new Map<string, Value>()
            for (const arg of expr.args) {
              const value = yield* evaluate(arg.expr, scope)
              if (arg.keyword !== undefined) {
                kw.set(arg.keyword, value)
                continue
              }
              if (!arg.spread) {
                checkArrayLength(args.length + 1)
                args.push(value)
                continue
              }
              for (const item of values(value)) {
                if (ctx.runner.tick()) yield Slice
                checkArrayLength(args.length + 1)
                args.push(item)
              }
            }
            if (kw.size) {
              if (callable instanceof ToolReference || callable === names.search) {
                if (args.length) throw typeError("Use a single input dictionary or keywords, not both.")
                const input = new Obj(null)
                for (const [k, v] of kw) define(input, k, v)
                args.push(input)
              } else if (callable === names.sorted) {
                return yield* sorted(ctx, args, kw, expr.site)
              } else {
                const params = callable instanceof Native && parameters.get(callable)
                if (!params) throw typeError("This callable does not accept keyword arguments.")
                const positional = args.length
                for (const [name, v] of kw) {
                  const index = params.get(name)
                  if (index === undefined) throw typeError(`Unexpected keyword argument '${name}'.`)
                  if (index < positional) throw typeError(`Multiple values for argument '${name}'.`)
                  args[index] = v
                }
                if (positional + kw.size !== params.size) throw typeError("Missing required function argument.")
              }
            }
            return (yield* ctx.call(callable, undefined, args, expr.site)) ?? null
          }
          case "unary": {
            const arg = yield* evaluate(expr.arg, scope)
            if (expr.op === "await") {
              if (arg instanceof Coroutine) return (yield new Call(arg.run())) as Value
              if (!(arg instanceof PromiseObj)) throw typeError("await expects an asynchronous tool or function call.")
              return (yield* ctx.awaitValue(arg, expr.site)) ?? null
            }
            if (expr.op === "not") return !truth(arg)
            return expr.op === "-" ? -numeric(arg) : numeric(arg)
          }
          case "binary": {
            const left = yield* evaluate(expr.left, scope)
            if (expr.op === "and" || expr.op === "or")
              return truth(left) === (expr.op === "and") ? yield* evaluate(expr.right, scope) : left
            return yield* binary(ctx, expr.op, left, yield* evaluate(expr.right, scope))
          }
          case "compare": {
            let left = yield* evaluate(expr.left, scope)
            for (const { op, right } of expr.rest) {
              const next = yield* evaluate(right, scope)
              if (!(yield* binary(ctx, op, left, next))) return false
              left = next
            }
            return true
          }
        }
      } catch (error) {
        throw locate(error, expr.site)
      }
    }
    function* block(stmts: Body, scope: Scope, top = false): Eval<Flow> {
      for (const [i, stmt] of stmts.entries()) {
        if (ctx.runner.tick()) yield Slice
        switch (stmt.kind) {
          case "expr": {
            const value = yield* evaluate(stmt.expr, scope)
            if (top && i === stmts.length - 1) return { kind: "return", value }
            break
          }
          case "return":
            return { kind: "return", value: stmt.expr ? yield* evaluate(stmt.expr, scope) : null }
          case "break":
          case "continue":
            return { kind: stmt.kind }
          case "pass":
            break
          case "asyncio":
            scope.locals.set("asyncio", asyncio)
            break
          case "unpack":
            yield* bind(stmt.names, yield* evaluate(stmt.expr, scope), scope, stmt.site)
            break
          case "assign": {
            // Simple assignment evaluates the RHS first. Augmented assignment reads its target exactly once, first.
            const target = stmt.target
            const rhs = stmt.op === "=" ? yield* evaluate(stmt.expr, scope) : undefined
            const container = target.kind === "index" ? yield* evaluate(target.target, scope) : undefined
            const key = target.kind === "index" ? yield* evaluate(target.key, scope) : undefined
            const value =
              stmt.op === "="
                ? rhs
                : yield* binary(
                    ctx,
                    stmt.op[0]!,
                    target.kind === "name" ? lookup(scope, target) : subscript(container, key),
                    yield* evaluate(stmt.expr, scope),
                  )
            if (target.kind === "name") scope.locals.set(target.name, value)
            else put(container, key, value)
            break
          }
          case "if": {
            let selected = stmt.otherwise
            for (const branch of stmt.branches)
              if (truth(yield* evaluate(branch.test, scope))) {
                selected = branch.body
                break
              }
            const flow = yield* block(selected, scope)
            if (flow) return flow
            break
          }
          case "for": {
            for (const v of values(yield* evaluate(stmt.source, scope))) {
              yield* bind(stmt.binding, v, scope, stmt.site)
              const flow = yield* block(stmt.body, scope)
              if (flow?.kind === "break") break
              if (flow?.kind === "return") return flow
            }
            break
          }
          case "while": {
            while (truth(yield* evaluate(stmt.test, scope))) {
              const flow = yield* block(stmt.body, scope)
              if (flow?.kind === "break") break
              if (flow?.kind === "return") return flow
            }
            break
          }
          case "function": {
            const locals = localNames(stmt.body)
            const func = fn(builtins, stmt.name, stmt.params.length, function* (_, args, site) {
              arity(stmt.name, args, stmt.params.length)
              const inner = { locals: new Map<string, Value>(locals.map((k) => [k, unbound])), parent: scope }
              stmt.params.forEach((p, i) => inner.locals.set(p, args[i]))
              const run = function* (): Eval<Value> {
                const result = yield* block(stmt.body, inner)
                return result?.kind === "return" ? result.value : null
              }
              if (stmt.async) return new Coroutine(run(), site)
              return (yield new Call(run())) as Value
            })
            parameters.set(func, new Map(stmt.params.map((name, i) => [name, i])))
            scope.locals.set(stmt.name, func)
            break
          }
          case "try": {
            try {
              const flow = yield* block(stmt.body, scope)
              if (flow) return flow
            } catch (error) {
              if (error instanceof Interruption) throw error
              if (stmt.name) scope.locals.set(stmt.name, materialize(ctx, error))
              try {
                const flow = yield* block(stmt.handler, scope)
                if (flow) return flow
              } finally {
                if (stmt.name) scope.locals.set(stmt.name, unbound)
              }
            }
            break
          }
        }
      }
    }
    const result = yield* block(body, scope, true)
    return yield* toBoundary(ctx, result?.kind === "return" ? result.value : null)
  }
}

const unbound = Symbol("unbound local")
function localNames(body: Body): string[] {
  return body.flatMap((stmt) => {
    switch (stmt.kind) {
      case "assign":
        return stmt.target.kind === "name" ? [stmt.target.name] : []
      case "unpack":
        return stmt.names
      case "function":
        return [stmt.name]
      case "asyncio":
        return ["asyncio"]
      case "for":
        return [stmt.binding, ...localNames(stmt.body)].flat()
      case "while":
        return localNames(stmt.body)
      case "if":
        return [...stmt.branches.flatMap((b) => localNames(b.body)), ...localNames(stmt.otherwise)]
      case "try":
        return [...(stmt.name ? [stmt.name] : []), ...localNames(stmt.body), ...localNames(stmt.handler)]
      default:
        return []
    }
  })
}

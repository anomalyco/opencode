import { toBoundary, type Json } from "../data.js"
import { type Interpreter } from "../interpreter/interpreter.js"
import { locate, materialize } from "../interpreter/errors.js"
import { checkArrayLength, checkStringLength } from "../interpreter/limits.js"
import { type AstNode, rangeError, referenceError, typeError } from "../interpreter/model.js"
import { fn } from "../interpreter/native.js"
import { Coroutine, define, getOwn, Native, Obj, PromiseObj, record, type Value } from "../interpreter/objects.js"
import { combinator } from "../interpreter/promises.js"
import { Call, type Eval, Interruption, Slice } from "../interpreter/runner.js"
import { ToolReference } from "../tool-runtime.js"
import { bindingNames, type Binding, type Body, type Expr, parsePython } from "./parser.js"
import { type pythonNames } from "./names.js"
import { slice, sorted } from "./sequence.js"
import { helpers } from "./helpers.js"
import { KeywordFunction, PythonType } from "./native.js"
import { jsonModule } from "./json.js"
import { reModule } from "./re.js"
import { PythonSet } from "./set.js"
import {
  arity,
  cursor,
  iterator,
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
    const discovered = new WeakSet<Obj>()
    const names: Record<(typeof pythonNames)[number], Value> = {
      ...helpers(ctx),
      json: jsonModule(ctx),
      re: reModule(ctx),
      tools: new ToolReference([]),
      search: fn(builtins, "search", 1, function* (_, args) {
        const result = yield* ctx.tool(ctx.tools.search, args)
        if (result instanceof Obj) discovered.add(result)
        return result
      }),
      print: fn(builtins, "print", 0, function* (_, args) {
        ctx.logs.push(yield* display(ctx, args))
        return null
      }),
      len: fn(builtins, "len", 1, (_, args) => {
        arity("len", args, 1)
        return size(args[0])
      }),
      sorted: fn(builtins, "sorted", 1, (_, args, site) => sorted(ctx, args, new Map(), site)),
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
      // Validate one sequence at a time, then assign left to right. A later nested failure
      // preserves earlier sibling assignments, as in Python.
      const iter = cursor(value, site)
      const items: Value[] = []
      const { star, items: targets } = binding
      for (let i = 0; i < (star < 0 ? targets.length : star); i++) {
        if (ctx.runner.tick()) yield Slice
        const item = yield* iter.next()
        if (item.done) throw typeError("Not enough values to unpack.", site)
        items.push(item.value)
      }
      if (star === -1) {
        if (!(yield* iter.next()).done) throw typeError(`Too many values to unpack (expected ${targets.length}).`, site)
      } else {
        const rest = list(ctx)
        const trailing = targets.length - star - 1
        for (let item = yield* iter.next(); !item.done; item = yield* iter.next()) {
          if (ctx.runner.tick()) yield Slice
          checkArrayLength(rest.items.length + 1)
          rest.items.push(item.value)
        }
        if (rest.items.length < trailing) throw typeError("Not enough values to unpack.", site)
        items.push(rest)
        for (const item of rest.items.splice(rest.items.length - trailing, trailing)) items.push(item)
      }
      for (const [i, target] of targets.entries()) yield* bind(target, items[i], scope, site)
    }
    function makeFunction(scope: Scope, name: string, params: string[], body: Body, async: boolean) {
      const locals = localNames(body)
      const func = fn(builtins, name, params.length, function* (_, args, site) {
        arity(name, args, params.length)
        const inner = { locals: new Map<string, Value>(locals.map((k) => [k, unbound])), parent: scope }
        params.forEach((p, i) => inner.locals.set(p, args[i]))
        const run = function* (): Eval<Value> {
          const result = yield* block(body, inner)
          return result?.kind === "return" ? result.value : null
        }
        if (async) return new Coroutine(run(), site)
        return (yield new Call(run())) as Value
      })
      parameters.set(func, new Map(params.map((name, i) => [name, i])))
      return func
    }
    function* evaluate(expr: Expr, scope: Scope): Eval<Value> {
      if (ctx.runner.tick()) yield Slice
      try {
        switch (expr.kind) {
          case "literal":
            return expr.value
          case "name":
            return lookup(scope, expr)
          case "lambda":
            return makeFunction(scope, "<lambda>", expr.params, expr.body, false)
          case "conditional":
            return yield* evaluate(truth(yield* evaluate(expr.test, scope)) ? expr.yes : expr.no, scope)
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
          case "set": {
            const result = new PythonSet(builtins.Set)
            for (const item of expr.items) result.addItem(yield* evaluate(item, scope))
            return result
          }
          case "dict": {
            const result = new Obj(null)
            for (const [k, v] of expr.pairs)
              define(result, stringKey(yield* evaluate(k, scope)), yield* evaluate(v, scope))
            return result
          }
          case "comprehension":
          case "dictcomp": {
            const source = cursor(yield* evaluate(expr.source, scope))
            const inner = { locals: new Map<string, Value>(), parent: scope }
            const next = function* (): Eval<boolean> {
              for (let s = yield* source.next(); !s.done; s = yield* source.next()) {
                yield* bind(expr.binding, s.value, inner, expr.site)
                if (!expr.guard || truth(yield* evaluate(expr.guard, inner))) return true
              }
              return false
            }
            if (expr.kind === "dictcomp") {
              const result = new Obj(null)
              while (yield* next())
                define(result, stringKey(yield* evaluate(expr.key, inner)), yield* evaluate(expr.value, inner))
              return result
            }
            if (expr.lazy)
              return iterator(ctx, "generator", function* () {
                return (yield* next())
                  ? { done: false, value: yield* evaluate(expr.item, inner) }
                  : { done: true, value: null }
              })
            if (expr.set) {
              const result = new PythonSet(builtins.Set)
              while (yield* next()) result.addItem(yield* evaluate(expr.item, inner))
              return result
            }
            const result = list(ctx)
            while (yield* next()) {
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
              const iter = cursor(value)
              for (let item = yield* iter.next(); !item.done; item = yield* iter.next()) {
                if (ctx.runner.tick()) yield Slice
                checkArrayLength(args.length + 1)
                args.push(item.value)
              }
            }
            if (callable === names.dir && !kw.size && !args.length) {
              const locals = list(ctx)
              for (const [k, v] of scope.locals) {
                if (ctx.runner.tick()) yield Slice
                if (v !== unbound) locals.items.push(k)
              }
              return yield* sorted(ctx, [locals], new Map())
            }
            if (kw.size) {
              if (callable === names.dict) {
                const result = (yield* ctx.call(callable, undefined, args, expr.site)) as Obj
                for (const [k, v] of kw) define(result, k, v)
                return result
              }
              if (callable instanceof KeywordFunction) return yield* callable.invoke(args, kw, expr.site)
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
              if (arg instanceof Obj && discovered.has(arg)) return arg
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
          case "import":
            {
              const mod = names[stmt.module] as Obj
              scope.locals.set(stmt.name, stmt.member ? getOwn(mod, stmt.member) : mod)
            }
            break
          case "unpack":
            yield* bind(stmt.binding, yield* evaluate(stmt.expr, scope), scope, stmt.site)
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
            const iter = cursor(yield* evaluate(stmt.source, scope))
            for (let s = yield* iter.next(); !s.done; s = yield* iter.next()) {
              yield* bind(stmt.binding, s.value, scope, stmt.site)
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
            scope.locals.set(stmt.name, makeFunction(scope, stmt.name, stmt.params, stmt.body, stmt.async))
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
    const value = result?.kind === "return" ? result.value : null
    return value instanceof PythonType ? yield* display(ctx, [value]) : yield* toBoundary(ctx, value)
  }
}

const unbound = Symbol("unbound local")
function localNames(body: Body): string[] {
  return body.flatMap((stmt) => {
    switch (stmt.kind) {
      case "assign":
        return stmt.target.kind === "name" ? [stmt.target.name] : []
      case "unpack":
        return bindingNames(stmt.binding)
      case "function":
      case "import":
        return [stmt.name]
      case "for":
        return [...bindingNames(stmt.binding), ...localNames(stmt.body)]
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

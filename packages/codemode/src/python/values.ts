import { type Interpreter } from "../interpreter/interpreter.js"
import { checkArrayLength, checkStringLength, MAX_VALUE_DEPTH } from "../interpreter/limits.js"
import { type AstNode, rangeError, typeError } from "../interpreter/model.js"
import { fn } from "../interpreter/native.js"
import { Arr, define, ErrorObj, getOwn, hasOwn, keys, Obj, type Value } from "../interpreter/objects.js"
import { rejectCircularInsertion } from "../interpreter/references.js"
import { type Eval, Slice } from "../interpreter/runner.js"
import { ToolReference } from "../tool-runtime.js"

// Only ordinary records are dictionaries. Interpreter machinery never exposes its fields or prototype.
export const dict = (v: Value): v is Obj => v instanceof Obj && v.constructor === Obj
// Tuples cross the JSON boundary as arrays, but are distinct, immutable sequences inside Python.
export class Tuple extends Arr {}
export const list = <R>(ctx: Interpreter<R>, items: Value[] = []) => new Arr(ctx.builtins.Array, items)
export const truth = (v: Value): boolean => (v instanceof Arr ? v.items.length > 0 : dict(v) ? v.props.size > 0 : !!v)

export function numeric(v: Value): number {
  if (typeof v === "boolean") return Number(v)
  if (typeof v !== "number") throw typeError("Expected a number.")
  return v
}
export function integer(v: Value): number {
  const n = numeric(v)
  if (!Number.isSafeInteger(n)) throw typeError("Expected a safe integer.")
  return n
}
export function stringKey(v: Value): string {
  if (typeof v !== "string") throw typeError("Dictionary keys and tool names must be strings.")
  return v
}
export function arity(name: string, args: Value[], min: number, max = min) {
  if (args.length < min || args.length > max)
    throw typeError(`${name} expects ${min === max ? min : `${min} to ${max}`} arguments, got ${args.length}.`)
}
export function values(v: Value, site?: AstNode): Iterable<Value> {
  if (v instanceof Arr) return v.items
  if (typeof v === "string") return v
  if (dict(v)) return dictionaryKeys(v)
  throw typeError("Expected a list, tuple, string or dictionary.", site)
}
function* dictionaryKeys(v: Obj) {
  const length = v.props.size
  for (const [key, slot] of v.props) {
    if (typeof key !== "string" || !slot.enumerable) continue
    yield key
    if (length !== v.props.size) throw typeError("Dictionary changed size during iteration.")
  }
}
export function size(v: Value): number {
  if (v instanceof Arr) return v.items.length
  if (dict(v)) return v.props.size
  if (typeof v === "string") {
    // Python indices count code points. Count surrogate pairs without allocating an array of every character.
    let n = v.length
    const pair = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g
    while (pair.test(v)) n--
    return n
  }
  throw typeError("len() expects a list, string or dictionary.")
}
function position(key: Value, length: number) {
  const n = integer(key)
  const at = n < 0 ? length + n : n
  if (at < 0 || at >= length) throw rangeError("Index out of range.")
  return at
}
export function subscript(v: Value, key: Value): Value {
  if (v instanceof ToolReference) return new ToolReference([...v.path, stringKey(key)])
  if (v instanceof Arr) return v.items[position(key, v.items.length)] ?? null
  if (typeof v === "string") {
    let at = position(key, size(v))
    for (const char of v) if (at-- === 0) return char
    throw rangeError("Index out of range.")
  }
  if (!dict(v)) throw typeError("Value is not subscriptable.")
  const k = stringKey(key)
  if (!hasOwn(v, k)) throw typeError(`Key not found: ${k}.`)
  return getOwn(v, k) ?? null
}
export function put(v: Value, key: Value, value: Value) {
  if (v instanceof Tuple) throw typeError("Tuples do not support item assignment.")
  if (v instanceof Arr) {
    const at = position(key, v.items.length)
    rejectCircularInsertion(v, value, "List")
    v.items[at] = value
    return
  }
  if (!dict(v)) throw typeError("Expected a list or dictionary for assignment.")
  rejectCircularInsertion(v, value, "Dictionary")
  define(v, stringKey(key), value)
}

export function attribute<R>(ctx: Interpreter<R>, v: Value, name: string): Value {
  if (v instanceof ToolReference) return new ToolReference([...v.path, name])
  if (v instanceof Arr && !(v instanceof Tuple) && name === "append")
    return fn(ctx.builtins, name, 1, (_, args) => {
      arity(name, args, 1)
      rejectCircularInsertion(v, args[0], "List")
      checkArrayLength(v.items.length + 1)
      v.items.push(args[0])
      return null
    })
  if (dict(v)) {
    // Host extension modules are records of functions. Only explicitly supplied own members are reachable.
    if (hasOwn(v, name)) return getOwn(v, name) ?? null
    if (name === "get")
      return fn(ctx.builtins, name, 1, (_, args) => {
        arity(name, args, 1, 2)
        const key = stringKey(args[0])
        return hasOwn(v, key) ? getOwn(v, key) : (args[1] ?? null)
      })
    if (name === "keys" || name === "values" || name === "items")
      return fn(ctx.builtins, name, 0, function* (_, args): Eval<Value> {
        arity(name, args, 0)
        checkArrayLength(v.props.size)
        const result = list(ctx)
        for (const k of dictionaryKeys(v)) {
          if (ctx.runner.tick()) yield Slice
          result.items.push(
            name === "keys" ? k : name === "values" ? getOwn(v, k) : new Tuple(ctx.builtins.Array, [k, getOwn(v, k)]),
          )
        }
        return result
      })
  }
  throw typeError(`No attribute '${name}'.`)
}

// Shared subtrees can make even a shallow pair of lists exponentially large to compare naively.
function* equal<R>(ctx: Interpreter<R>, a: Value, b: Value, seen = new Map<Obj, Set<Obj>>(), depth = 0): Eval<boolean> {
  if (ctx.runner.tick()) yield Slice
  if (depth > MAX_VALUE_DEPTH) throw rangeError("Comparison nested too deeply.")
  if (a === b || (a == null && b == null)) return true
  if (typeof a === "boolean" || typeof b === "boolean")
    return (
      (typeof a === "number" || typeof a === "boolean") &&
      (typeof b === "number" || typeof b === "boolean") &&
      Number(a) === Number(b)
    )
  if (!(a instanceof Obj) || !(b instanceof Obj)) return false
  if (seen.get(a)?.has(b)) return true
  const matches = seen.get(a) ?? new Set<Obj>()
  seen.set(a, matches.add(b))
  if (a instanceof Arr && b instanceof Arr) {
    if (a instanceof Tuple !== b instanceof Tuple) return false
    if (a.items.length !== b.items.length) return false
    for (let i = 0; i < a.items.length; i++)
      if (!(yield* equal(ctx, a.items[i], b.items[i], seen, depth + 1))) return false
    return true
  }
  if (!dict(a) || !dict(b) || a.props.size !== b.props.size) return false
  for (const key of keys(a))
    if (!hasOwn(b, key) || !(yield* equal(ctx, getOwn(a, key), getOwn(b, key), seen, depth + 1))) return false
  return true
}

export function* binary<R>(ctx: Interpreter<R>, op: string, a: Value, b: Value): Eval<Value> {
  if (op === "is" || op === "is not") return (a === b) === (op === "is")
  if (op === "==" || op === "!=") return (yield* equal(ctx, a, b)) === (op === "==")
  if (op === "in" || op === "not in") {
    if (typeof b === "string") return b.includes(stringKey(a)) === (op === "in")
    if (dict(b)) return hasOwn(b, stringKey(a)) === (op === "in")
    for (const item of values(b)) if (yield* equal(ctx, a, item)) return op === "in"
    return op === "not in"
  }
  if (op === "+" && a instanceof Arr && b instanceof Arr) {
    if (a instanceof Tuple !== b instanceof Tuple) throw typeError("Cannot concatenate lists and tuples.")
    checkArrayLength(a.items.length + b.items.length)
    if (a instanceof Tuple) return new Tuple(ctx.builtins.Array, a.items.concat(b.items))
    return list(ctx, a.items.concat(b.items))
  }
  if (typeof a === "string" && typeof b === "string") {
    if (op === "+") {
      checkStringLength(a.length + b.length)
      return a + b
    }
    if (op === "<") return a < b
    if (op === "<=") return a <= b
    if (op === ">") return a > b
    if (op === ">=") return a >= b
  }
  if (op === "*" && (typeof a === "string" || typeof b === "string")) {
    const text = typeof a === "string" ? a : stringKey(b)
    const n = Math.max(0, integer(typeof a === "string" ? b : a))
    checkStringLength(text.length * n)
    return text.repeat(n)
  }
  const x = numeric(a)
  const y = numeric(b)
  if (op === "<") return x < y
  if (op === "<=") return x <= y
  if (op === ">") return x > y
  if (op === ">=") return x >= y
  if (["/", "//", "%"].includes(op) && y === 0) throw rangeError("Division by zero.")
  if (op === "%" || op === "//") {
    const rem = x % y
    const adjust = rem !== 0 && Math.sign(rem) !== Math.sign(y)
    if (op === "%") return adjust ? rem + y : rem || 0
    // Recover the integral quotient from the remainder. floor(x/y) rounds 1.0 // 0.1 up to 10.
    const quotient = Math.round((x - rem) / y) - Number(adjust)
    if (!Number.isFinite(quotient)) throw rangeError("Numeric result is out of range.")
    return quotient
  }
  const result = op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "/" ? x / y : x ** y
  if (!Number.isFinite(result)) throw rangeError("Numeric result is out of range.")
  return result
}

export function* display<R>(ctx: Interpreter<R>, args: Value[]): Eval<string> {
  let out = ""
  const add = (text: string) => {
    checkStringLength(out.length + text.length)
    out += text
  }
  function* visit(v: Value, depth: number): Eval<void> {
    if (ctx.runner.tick()) yield Slice
    if (depth > MAX_VALUE_DEPTH) throw rangeError("Value nested too deeply to print.")
    if (v instanceof Arr || dict(v)) {
      const array = v instanceof Arr
      add(v instanceof Tuple ? "(" : array ? "[" : "{")
      let i = 0
      for (const item of values(v)) {
        if (i++) add(", ")
        yield* visit(item, depth + 1)
        if (!array) {
          add(": ")
          yield* visit(getOwn(v, stringKey(item)), depth + 1)
        }
      }
      return add(v instanceof Tuple ? (i === 1 ? ",)" : ")") : array ? "]" : "}")
    }
    if (v == null) return add("None")
    if (typeof v === "boolean") return add(v ? "True" : "False")
    if (typeof v === "string") return add(depth ? JSON.stringify(v) : v)
    if (v instanceof ErrorObj) return add(String(getOwn(v, "message") ?? ""))
    if (typeof v === "number") return add(String(v))
    return add("<opaque>")
  }
  for (const [i, arg] of args.entries()) {
    if (i) add(" ")
    yield* visit(arg, 0)
  }
  return out
}

import { type Interpreter } from "../interpreter/interpreter.js"
import { checkArrayLength, checkStringLength, MAX_VALUE_DEPTH } from "../interpreter/limits.js"
import { type AstNode, rangeError, typeError } from "../interpreter/model.js"
import { fn } from "../interpreter/native.js"
import {
  Arr,
  define,
  ErrorObj,
  getOwn,
  hasOwn,
  keys,
  Obj,
  remove,
  type Value,
  PythonIterator,
  hostCursor,
  type Cursor,
  type Step,
} from "../interpreter/objects.js"
import { rejectCircularInsertion } from "../interpreter/references.js"
import { Call, type Eval, Slice } from "../interpreter/runner.js"
import { ToolReference } from "../tool-runtime.js"
import { keyword, KeywordFunction, PythonType, onlyKeywords } from "./native.js"
import { listMethods, dictMethods } from "./names.js"
import { less, sorted } from "./sequence.js"
import { PythonSet, setMethod, setMethods } from "./set.js"
import { textMethod, textMethods } from "./text.js"

// Only ordinary records are dictionaries. Interpreter machinery never exposes its fields or prototype.
export const dict = (v: Value): v is Obj => v instanceof Obj && v.constructor === Obj
// Tuples cross the JSON boundary as arrays, but are distinct, immutable sequences inside Python.
export class Tuple extends Arr {}
export const list = <R>(ctx: Interpreter<R>, items: Value[] = []) => new Arr(ctx.builtins.Array, items)
export const truth = (v: Value): boolean =>
  v instanceof Arr ? v.items.length > 0 : v instanceof PythonSet ? v.set.size > 0 : dict(v) ? v.props.size > 0 : !!v

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
  if (v instanceof PythonSet) return v.members()
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
export function cursor(v: Value, site?: AstNode): Cursor {
  return v instanceof PythonIterator ? v.cursor : hostCursor(values(v, site)[Symbol.iterator]())
}
export function iterator<R>(ctx: Interpreter<R>, name: string, pull: () => Eval<Step>) {
  let done = false,
    running = false
  return new PythonIterator(
    ctx.builtins.Iterator,
    {
      next: function* () {
        if (done) return { done: true, value: null }
        if (running) throw typeError("Iterator is already executing.")
        running = true
        try {
          const step = (yield new Call(pull())) as Step
          done = step.done
          return step
        } catch (error) {
          if (name === "generator") done = true
          throw error
        } finally {
          running = false
        }
      },
      close: function* () {
        done = true
      },
    },
    name,
  )
}
export function size(v: Value): number {
  if (v instanceof Arr) return v.items.length
  if (v instanceof PythonSet) return v.set.size
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

export function* updateDict<R>(ctx: Interpreter<R>, dest: Obj, source: Value): Eval<void> {
  if (dict(source)) {
    for (const key of dictionaryKeys(source)) {
      if (ctx.runner.tick()) yield Slice
      put(dest, key, getOwn(source, key))
    }
    return
  }
  const it = cursor(source)
  for (let s = yield* it.next(); !s.done; s = yield* it.next()) {
    if (ctx.runner.tick()) yield Slice
    const pair = cursor(s.value),
      k = yield* pair.next(),
      v = yield* pair.next()
    if (k.done || v.done || !(yield* pair.next()).done) throw typeError("Expected key/value pairs.")
    put(dest, k.value, v.value)
  }
}

export function attribute<R>(ctx: Interpreter<R>, v: Value, name: string): Value {
  const member = memberValue(ctx, v, name)
  if (member !== undefined) return member
  throw typeError(`No attribute '${name}'.`)
}

export function memberValue<R>(ctx: Interpreter<R>, v: Value, name: string): Value {
  if (v instanceof ToolReference) return new ToolReference([...v.path, name])
  if (v instanceof PythonType && name === "__name__") return v.pythonName
  // Class-level method references are useful callbacks, e.g. map(str.strip, lines).
  // Only dispatch allowlisted guest methods; never look up a property on a host class.
  if (
    v instanceof PythonType &&
    ((v.pythonName === "str" && textMethods.has(name)) ||
      (v.pythonName === "list" && listMethods.includes(name)) ||
      (v.pythonName === "tuple" && ["index", "count"].includes(name)))
  ) {
    return keyword(ctx, name, function* (args, kw): Eval<Value> {
      const [receiver, ...rest] = args
      const valid =
        v.pythonName === "str"
          ? typeof receiver === "string"
          : v.pythonName === "tuple"
            ? receiver instanceof Tuple
            : receiver instanceof Arr && !(receiver instanceof Tuple)
      if (!valid) throw typeError(`${v.pythonName}.${name} requires a ${v.pythonName} receiver.`)
      const f = attribute(ctx, receiver, name)
      if (f instanceof KeywordFunction) return yield* f.invoke(rest, kw)
      onlyKeywords(kw)
      return yield* ctx.call(f, undefined, rest)
    })
  }
  if (v instanceof PythonType && v.pythonName === "dict" && name === "fromkeys")
    return fn(ctx.builtins, name, 1, function* (_, args): Eval<Value> {
      arity(name, args, 1, 2)
      const out = new Obj(null),
        it = cursor(args[0])
      for (let s = yield* it.next(); !s.done; s = yield* it.next()) {
        if (ctx.runner.tick()) yield Slice
        define(out, stringKey(s.value), args[1] ?? null)
      }
      return out
    })
  if (typeof v === "string" && textMethods.has(name)) return textMethod(ctx, v, name)
  if (v instanceof PythonSet && setMethods.includes(name)) return setMethod(ctx, v, name)
  if (v instanceof Arr && listMethods.includes(name) && (!(v instanceof Tuple) || name === "count" || name === "index"))
    return keyword(ctx, name, function* (args, kw): Eval<Value> {
      const a = v.items
      if (name === "sort") {
        arity(name, args, 0)
        let copy = list(ctx, a.slice())
        a.length = 0
        try {
          copy = yield* sorted(ctx, [copy], kw)
          if (a.length) throw typeError("List modified during sort.")
        } finally {
          a.length = 0
          for (const x of copy.items) {
            if (ctx.runner.tick()) yield Slice
            a.push(x)
          }
        }
        return null
      }
      onlyKeywords(kw)
      if (name === "copy" || name === "reverse" || name === "clear") {
        arity(name, args, 0)
        if (name === "copy") return list(ctx, a.slice())
        if (name === "reverse") a.reverse()
        else a.length = 0
        return null
      }
      if (name === "pop") {
        arity(name, args, 0, 1)
        return a.splice(position(args.length ? args[0] : -1, a.length), 1)[0]
      }
      if (name === "append" || name === "insert") {
        arity(name, args, name === "append" ? 1 : 2)
        const x = args.at(-1)
        rejectCircularInsertion(v, x, "List")
        checkArrayLength(a.length + 1)
        if (name === "append") a.push(x)
        else a.splice(integer(args[0]), 0, x)
        return null
      }
      if (name === "extend") {
        arity(name, args, 1)
        const iter = cursor(args[0] === v ? list(ctx, a.slice()) : args[0])
        for (let s = yield* iter.next(); !s.done; s = yield* iter.next()) {
          const x = s.value
          if (ctx.runner.tick()) yield Slice
          rejectCircularInsertion(v, x, "List")
          checkArrayLength(a.length + 1)
          a.push(x)
        }
        return null
      }
      arity(name, args, 1, name === "index" ? 3 : 1)
      const bound = (x: Value) => {
        const i = integer(x)
        return i < 0 ? Math.max(0, a.length + i) : i
      }
      const start = args.length > 1 ? bound(args[1]) : 0,
        end = args.length > 2 ? bound(args[2]) : a.length
      let count = 0
      for (let i = start; i < Math.min(end, a.length); i++)
        if (yield* equal(ctx, a[i], args[0])) {
          if (name === "index") return i
          if (name === "remove") {
            a.splice(i, 1)
            return null
          }
          count++
        }
      if (name === "count") return count
      throw typeError("Value not found in sequence.")
    })
  if (dict(v)) {
    // Host extension modules are records of functions. Only explicitly supplied own members are reachable.
    if (hasOwn(v, name)) return getOwn(v, name) ?? null
    if (dictMethods.includes(name) && !["keys", "items", "values", "get"].includes(name))
      return keyword(ctx, name, function* (args, kw): Eval<Value> {
        if (name === "update") {
          arity(name, args, 0, 1)
          if (args.length) yield* updateDict(ctx, v, args[0])
          for (const [k, x] of kw) put(v, k, x)
          return null
        }
        onlyKeywords(kw)
        if (name === "clear") {
          arity(name, args, 0)
          v.props.clear()
          return null
        }
        if (name === "copy") {
          arity(name, args, 0)
          const copy = new Obj(null)
          yield* updateDict(ctx, copy, v)
          return copy
        }
        arity(name, args, 1, 2)
        const k = stringKey(args[0])
        if (hasOwn(v, k)) {
          const val = getOwn(v, k)
          if (name === "pop") remove(v, k)
          return val
        }
        if (name === "setdefault") {
          const d = args[1] ?? null
          put(v, k, d)
          return d
        }
        if (args.length === 2) return args[1]
        throw typeError(`Key not found: ${k}.`)
      })
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
  return undefined
}

// Shared subtrees can make even a shallow pair of lists exponentially large to compare naively.
export function* equal<R>(
  ctx: Interpreter<R>,
  a: Value,
  b: Value,
  seen = new Map<Obj, Set<Obj>>(),
  depth = 0,
): Eval<boolean> {
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
  if (a instanceof PythonSet && b instanceof PythonSet) {
    if (a.set.size !== b.set.size) return false
    for (const v of a.members()) {
      if (ctx.runner.tick()) yield Slice
      if (!b.hasItem(v)) return false
    }
    return true
  }
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
  if (["<", "<=", ">", ">="].includes(op)) {
    if (op === "<") return yield* less(ctx, a, b)
    if (op === ">") return yield* less(ctx, b, a)
    return !(yield* less(ctx, op === "<=" ? b : a, op === "<=" ? a : b))
  }
  if (op === "in" || op === "not in") {
    if (typeof b === "string") return b.includes(stringKey(a)) === (op === "in")
    if (b instanceof PythonSet) return b.hasItem(a) === (op === "in")
    if (dict(b)) return hasOwn(b, stringKey(a)) === (op === "in")
    const iter = cursor(b)
    for (let s = yield* iter.next(); !s.done; s = yield* iter.next())
      if (yield* equal(ctx, a, s.value)) return op === "in"
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
  }
  if (op === "*" && (typeof a === "string" || typeof b === "string")) {
    const text = typeof a === "string" ? a : stringKey(b)
    const n = Math.max(0, integer(typeof a === "string" ? b : a))
    checkStringLength(text.length * n)
    return text.repeat(n)
  }
  const x = numeric(a)
  const y = numeric(b)
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

export function* display<R>(ctx: Interpreter<R>, args: Value[], repr = false): Eval<string> {
  let out = ""
  const add = (text: string) => {
    checkStringLength(out.length + text.length)
    out += text
  }
  function* visit(v: Value, depth: number): Eval<void> {
    if (ctx.runner.tick()) yield Slice
    if (depth > MAX_VALUE_DEPTH) throw rangeError("Value nested too deeply to print.")
    if (v instanceof Arr || v instanceof PythonSet || dict(v)) {
      const array = v instanceof Arr
      const set = v instanceof PythonSet
      if (set && v.set.size === 0) return add("set()")
      add(v instanceof Tuple ? "(" : array ? "[" : "{")
      let i = 0
      for (const item of values(v)) {
        if (i++) add(", ")
        yield* visit(item, depth + 1)
        if (!array && !set) {
          add(": ")
          yield* visit(getOwn(v, stringKey(item)), depth + 1)
        }
      }
      return add(v instanceof Tuple ? (i === 1 ? ",)" : ")") : array ? "]" : "}")
    }
    if (v == null) return add("None")
    if (typeof v === "boolean") return add(v ? "True" : "False")
    if (typeof v === "string") {
      if (!depth && !repr) return add(v)
      const quote = v.includes("'") && !v.includes('"') ? '"' : "'"
      add(quote)
      // Append runs of printable characters at once, bounding the escaped result as it grows.
      let pos = 0
      for (const m of v.matchAll(/['"\\\p{C}\p{Z}]/gu)) {
        if (ctx.runner.tick()) yield Slice
        const c = m[0]
        if (c === " " || ((c === "'" || c === '"') && c !== quote)) continue
        add(v.slice(pos, m.index))
        pos = m.index + c.length
        const cp = c.codePointAt(0)!
        add(
          c === quote || c === "\\"
            ? "\\" + c
            : c === "\n"
              ? "\\n"
              : c === "\t"
                ? "\\t"
                : c === "\r"
                  ? "\\r"
                  : (cp < 256 ? "\\x" : cp < 65536 ? "\\u" : "\\U") +
                    cp.toString(16).padStart(cp < 256 ? 2 : cp < 65536 ? 4 : 8, "0"),
        )
      }
      add(v.slice(pos))
      return add(quote)
    }
    if (v instanceof PythonType) return add(`<class '${v.pythonName}'>`)
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

import { type Interpreter } from "../interpreter/interpreter.js"
import { checkArrayLength, MAX_VALUE_DEPTH } from "../interpreter/limits.js"
import { typeError, rangeError } from "../interpreter/model.js"
import { fn } from "../interpreter/native.js"
import {
  Arr,
  Callable,
  Coroutine,
  ErrorObj,
  Obj,
  PromiseObj,
  PythonIterator,
  type NativeCall,
  type Value,
} from "../interpreter/objects.js"
import { type Eval, Slice } from "../interpreter/runner.js"
import { ToolReference } from "../tool-runtime.js"
import { keyword, onlyKeywords, PythonType } from "./native.js"
import { textMethods } from "./text.js"
import { dictMethods, listMethods } from "./names.js"
import { PythonSet, makeSet, setMethods } from "./set.js"
import {
  arity,
  binary,
  cursor,
  dict,
  display,
  integer,
  iterator,
  list,
  memberValue,
  numeric,
  stringKey,
  truth,
  Tuple,
  updateDict,
} from "./values.js"
import { sorted } from "./sequence.js"

function typeName(v: Value): string {
  if (v == null) return "NoneType"
  if (typeof v === "string") return "str"
  if (typeof v === "boolean") return "bool"
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float"
  if (v instanceof Tuple) return "tuple"
  if (v instanceof Arr) return "list"
  if (v instanceof PythonSet) return "set"
  if (v instanceof PythonType) return "type"
  if (v instanceof PythonIterator) return v.pythonName
  if (v instanceof Callable || v instanceof ToolReference) return "function"
  if (v instanceof Coroutine) return "coroutine"
  if (v instanceof PromiseObj) return "Future"
  if (v instanceof ErrorObj) return "Exception"
  if (dict(v)) return "dict"
  return "object"
}

export function helpers<R>(ctx: Interpreter<R>) {
  const b = ctx.builtins
  const types = new Map<string, PythonType>()
  function type(name: string, call: NativeCall) {
    const t = new PythonType(b.Function, name, call)
    types.set(name, t)
    return t
  }
  function* collect(v: Value): Eval<Value[]> {
    const items: Value[] = []
    const iter = cursor(v)
    for (let x = yield* iter.next(); !x.done; x = yield* iter.next()) {
      if (ctx.runner.tick()) yield Slice
      checkArrayLength(items.length + 1)
      items.push(x.value)
    }
    return items
  }
  function multi(name: "zip" | "map") {
    return fn(b, name, 0, (_, args) => {
      if (name === "map") arity(name, args, 2, Infinity)
      const iters = (name === "map" ? args.slice(1) : args).map((v) => cursor(v))
      return iterator(ctx, name, function* () {
        if (!iters.length) return { done: true, value: null }
        const row: Value[] = []
        for (const it of iters) {
          if (ctx.runner.tick()) yield Slice
          const s = yield* it.next()
          if (s.done) return s
          row.push(s.value)
        }
        return {
          done: false,
          value: name === "map" ? yield* ctx.call(args[0], undefined, row) : new Tuple(b.Array, row),
        }
      })
    })
  }
  function extreme(name: "min" | "max") {
    return keyword(ctx, name, function* (args, kw) {
      onlyKeywords(kw, "key", "default")
      arity(name, args, 1, Infinity)
      if (args.length > 1 && kw.has("default")) throw typeError("default requires a single iterable.")
      const key = kw.get("key")
      let best: Value,
        rank: Value,
        first = true
      const iter = cursor(args.length === 1 ? args[0] : list(ctx, args))
      for (let s = yield* iter.next(); !s.done; s = yield* iter.next()) {
        const x = s.value
        if (ctx.runner.tick()) yield Slice
        const cmp = key == null ? x : yield* ctx.call(key, undefined, [x])
        if (first || (yield* binary(ctx, name === "min" ? "<" : ">", cmp, rank))) {
          best = x
          rank = cmp
          first = false
        }
      }
      if (!first) return best
      if (kw.has("default")) return kw.get("default")
      throw typeError(`${name}() arg is an empty sequence.`)
    })
  }
  return {
    getattr: lookupAttribute(false),
    hasattr: lookupAttribute(true),
    set: type("set", function* (_, args) {
      arity("set", args, 0, 1)
      return args.length ? yield* makeSet(ctx, args[0]) : new PythonSet(b.Set)
    }),
    type: type("type", (_, args) => {
      arity("type", args, 1)
      const name = typeName(args[0])
      return (
        types.get(name) ??
        type(name, () => {
          throw typeError(`Cannot construct ${name}.`)
        })
      )
    }),
    isinstance: fn(b, "isinstance", 2, function* (_, args): Eval<Value> {
      arity("isinstance", args, 2)
      const name = typeName(args[0])
      const seen = new Set<Tuple>()
      function* matches(t: Value, depth: number): Eval<boolean> {
        if (ctx.runner.tick()) yield Slice
        if (depth > MAX_VALUE_DEPTH) throw rangeError("Type tuple nested too deeply.")
        if (t instanceof Tuple) {
          if (seen.has(t)) return false
          seen.add(t)
          for (const cls of t.items) if (yield* matches(cls, depth + 1)) return true
          return false
        }
        if (!(t instanceof PythonType)) throw typeError("isinstance expects a type or tuple of types.")
        return t.pythonName === name || (t.pythonName === "int" && name === "bool")
      }
      return yield* matches(args[1], 0)
    }),
    str: type("str", (_, args) => {
      arity("str", args, 0, 1)
      return display(ctx, args)
    }),
    bool: type("bool", (_, args) => {
      arity("bool", args, 0, 1)
      return truth(args[0])
    }),
    int: type("int", (_, args) => {
      arity("int", args, 0, 1)
      if (!args.length) return 0
      const v = args[0]
      if (typeof v === "string" && !/^[+-]?\d(?:_?\d)*$/.test(v.trim())) throw typeError("Invalid integer.")
      return integer(Math.trunc(typeof v === "string" ? Number(v.replaceAll("_", "")) : numeric(v)))
    }),
    float: type("float", (_, args) => {
      arity("float", args, 0, 1)
      if (!args.length) return 0
      const v = args[0]
      if (typeof v === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim()))
        throw typeError("Invalid float.")
      const n = typeof v === "string" ? Number(v) : numeric(v)
      if (!Number.isFinite(n)) throw rangeError("Non-finite float.")
      return n
    }),
    list: type("list", function* (_, args) {
      arity("list", args, 0, 1)
      return list(ctx, args.length ? yield* collect(args[0]) : [])
    }),
    tuple: type("tuple", function* (_, args) {
      arity("tuple", args, 0, 1)
      return args[0] instanceof Tuple ? args[0] : new Tuple(b.Array, args.length ? yield* collect(args[0]) : [])
    }),
    dict: type("dict", function* (_, args) {
      arity("dict", args, 0, 1)
      const result = new Obj(null)
      if (args.length) yield* updateDict(ctx, result, args[0])
      return result
    }),
    repr: fn(b, "repr", 1, (_, args) => {
      arity("repr", args, 1)
      return display(ctx, args, true)
    }),
    dir: fn(b, "dir", 1, (_, args) => {
      arity("dir", args, 1)
      const v = args[0]
      const names =
        v instanceof PythonSet
          ? [...setMethods]
          : v instanceof ToolReference
            ? [...ctx.tools.keys(v.path)]
            : typeof v === "string"
              ? [...textMethods]
              : v instanceof PythonType
                ? [
                    "__name__",
                    ...(v.pythonName === "str"
                      ? textMethods
                      : v.pythonName === "list"
                        ? listMethods
                        : v.pythonName === "tuple"
                          ? ["index", "count"]
                          : v.pythonName === "dict"
                            ? ["fromkeys"]
                            : []),
                  ]
                : v instanceof Arr
                  ? v instanceof Tuple
                    ? ["count", "index"]
                    : [...listMethods]
                  : dict(v)
                    ? [
                        ...new Set(
                          [...v.props.keys()].filter((k): k is string => typeof k === "string").concat(dictMethods),
                        ),
                      ]
                    : []
      checkArrayLength(names.length)
      return sorted(ctx, [list(ctx, names)], new Map())
    }),
    callable: fn(b, "callable", 1, (_, args) => {
      arity("callable", args, 1)
      return args[0] instanceof Callable || (args[0] instanceof ToolReference && args[0].path.length > 0)
    }),
    enumerate: keyword(ctx, "enumerate", function* (args, kw) {
      onlyKeywords(kw, "start")
      arity("enumerate", args, 1, 2)
      if (args.length === 2 && kw.size) throw typeError("Multiple values for start.")
      let i = integer(kw.has("start") ? kw.get("start") : args.length === 2 ? args[1] : 0)
      const it = cursor(args[0])
      return iterator(ctx, "enumerate", function* () {
        const s = yield* it.next()
        return s.done ? s : { done: false, value: new Tuple(b.Array, [integer(i++), s.value]) }
      })
    }),
    zip: multi("zip"),
    map: multi("map"),
    filter: fn(b, "filter", 2, (_, args) => {
      arity("filter", args, 2)
      const it = cursor(args[1])
      return iterator(ctx, "filter", function* () {
        while (true) {
          if (ctx.runner.tick()) yield Slice
          const s = yield* it.next()
          if (s.done || truth(args[0] === null ? s.value : yield* ctx.call(args[0], undefined, [s.value]))) return s
        }
      })
    }),
    reversed: fn(b, "reversed", 1, function* (_, args) {
      arity("reversed", args, 1)
      const it = (yield* collect(args[0])).reverse().values()
      return iterator(ctx, "reversed", function* () {
        const s = it.next()
        return { done: !!s.done, value: s.value }
      })
    }),
    sum: fn(b, "sum", 1, function* (_, args): Eval<Value> {
      arity("sum", args, 1, 2)
      let n = args.length === 2 ? numeric(args[1]) : 0
      const iter = cursor(args[0])
      for (let v = yield* iter.next(); !v.done; v = yield* iter.next()) {
        if (ctx.runner.tick()) yield Slice
        n += numeric(v.value)
      }
      if (!Number.isFinite(n)) throw rangeError("Numeric result is out of range.")
      return n
    }),
    any: quantifier(true),
    all: quantifier(false),
    iter: fn(b, "iter", 1, (_, args) => {
      arity("iter", args, 1)
      if (args[0] instanceof PythonIterator) return args[0]
      const it = cursor(args[0])
      return iterator(ctx, "iterator", it.next)
    }),
    next: fn(b, "next", 1, function* (_, args) {
      arity("next", args, 1, 2)
      if (!(args[0] instanceof PythonIterator)) throw typeError("next expects an iterator.")
      const s = yield* args[0].cursor.next()
      if (!s.done) return s.value
      if (args.length === 2) return args[1]
      throw typeError("Iterator exhausted.")
    }),
    min: extreme("min"),
    max: extreme("max"),
    abs: fn(b, "abs", 1, (_, args) => {
      arity("abs", args, 1)
      return Math.abs(numeric(args[0]))
    }),
  }
  function quantifier(any: boolean) {
    const name = any ? "any" : "all"
    return fn(b, name, 1, function* (_, args): Eval<Value> {
      arity(name, args, 1)
      const iter = cursor(args[0])
      for (let v = yield* iter.next(); !v.done; v = yield* iter.next()) {
        if (ctx.runner.tick()) yield Slice
        if (truth(v.value) === any) return any
      }
      return !any
    })
  }
  function lookupAttribute(test: boolean) {
    const name = test ? "hasattr" : "getattr"
    return fn(b, name, 2, (_, args) => {
      arity(name, args, 2, test ? 2 : 3)
      const [target, raw] = args,
        k = stringKey(raw)
      const value =
        target instanceof ToolReference && !ctx.tools.keys(target.path).includes(k)
          ? undefined
          : memberValue(ctx, target, k)
      if (test) return value !== undefined
      if (value !== undefined) return value
      if (args.length === 3) return args[2]
      throw typeError(`No attribute '${k}'.`)
    })
  }
}

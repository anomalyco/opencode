import type { Interpreter } from "../interpreter/interpreter.js"
import { checkArrayLength, checkStringLength } from "../interpreter/limits.js"
import { typeError } from "../interpreter/model.js"
import { type Value } from "../interpreter/objects.js"
import { type Eval, Slice } from "../interpreter/runner.js"
import { arity, cursor, integer, list, size, Tuple } from "./values.js"
import { keyword, onlyKeywords } from "./native.js"

export const textMethods = new Set([
  "split",
  "rsplit",
  "splitlines",
  "join",
  "strip",
  "lstrip",
  "rstrip",
  "lower",
  "upper",
  "startswith",
  "endswith",
  "removeprefix",
  "removesuffix",
  "find",
  "rfind",
  "index",
  "rindex",
  "count",
  "replace",
  "partition",
  "rpartition",
  "isdigit",
  "isdecimal",
  "isalpha",
  "isalnum",
  "isspace",
  "isascii",
  "islower",
  "isupper",
])

const whitespace = /[\p{White_Space}\u001c-\u001f]/u
export function text(v: Value): string {
  if (typeof v !== "string") throw typeError("Expected a string.")
  return v
}

export function textMethod<R>(ctx: Interpreter<R>, s: string, name: string) {
  return keyword(ctx, name, function* (args, kw): Eval<Value> {
    if (name === "split" || name === "rsplit") {
      onlyKeywords(kw, "sep", "maxsplit")
      arity(name, args, 0, 2)
      if ((kw.has("sep") && args.length) || (kw.has("maxsplit") && args.length > 1))
        throw typeError("Multiple values for split argument.")
      const sep = kw.get("sep") ?? args[0]
      const max = integer(kw.has("maxsplit") ? kw.get("maxsplit") : args.length > 1 ? args[1] : -1)
      return yield* split(ctx, s, sep == null ? null : text(sep), max, name === "rsplit")
    }
    if (name === "splitlines") {
      onlyKeywords(kw, "keepends")
      arity(name, args, 0, 1)
      if (args.length && kw.size) throw typeError("Multiple values for keepends.")
      const keep = integer(kw.has("keepends") ? kw.get("keepends") : args.length ? args[0] : false)
      const lines = list(ctx)
      let pos = 0
      for (const m of s.matchAll(/\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/g)) {
        if (ctx.runner.tick()) yield Slice
        checkArrayLength(lines.items.length + 1)
        const end = m.index + m[0].length
        lines.items.push(s.slice(pos, keep ? end : m.index))
        pos = end
      }
      if (pos < s.length) {
        checkArrayLength(lines.items.length + 1)
        lines.items.push(s.slice(pos))
      }
      return lines
    }
    onlyKeywords(kw)
    if (name === "join") {
      arity(name, args, 1)
      let out = "",
        first = true
      const iter = cursor(args[0])
      for (let item = yield* iter.next(); !item.done; item = yield* iter.next()) {
        if (ctx.runner.tick()) yield Slice
        const x = text(item.value)
        checkStringLength(out.length + x.length + (first ? 0 : s.length))
        out += (first ? "" : s) + x
        first = false
      }
      return out
    }
    if (["strip", "lstrip", "rstrip"].includes(name)) {
      arity(name, args, 0, 1)
      const chars = args[0] == null ? undefined : new Set<string>()
      if (chars)
        for (const c of text(args[0])) {
          if (ctx.runner.tick()) yield Slice
          chars.add(c)
        }
      const match = (c: string) => (chars ? chars.has(c) : whitespace.test(c))
      let start = 0,
        end = s.length
      if (name !== "rstrip")
        for (const c of s) {
          if (ctx.runner.tick()) yield Slice
          if (!match(c)) break
          start += c.length
        }
      if (name !== "lstrip")
        while (end > start) {
          if (ctx.runner.tick()) yield Slice
          const begin = end - ((s.codePointAt(end - 2) ?? 0) > 0xffff ? 2 : 1)
          if (!match(s.slice(begin, end))) break
          end = begin
        }
      return s.slice(start, end)
    }
    if (name === "lower" || name === "upper") {
      arity(name, args, 0)
      const result = name === "lower" ? s.toLowerCase() : s.toUpperCase()
      checkStringLength(result.length)
      return result
    }
    if (name.startsWith("is")) {
      arity(name, args, 0)
      switch (name) {
        case "isascii":
          return !/[^\x00-\x7f]/.test(s)
        case "isdecimal":
          return /^\p{Nd}+$/u.test(s)
        case "isdigit":
          // Numeric_Type=Digit in addition to Decimal (the host exposes only the latter as Nd).
          return /^[\p{Nd}\u00b2-\u00b3\u00b9\u1369-\u1371\u19da\u2070\u2074-\u2079\u2080-\u2089\u2460-\u2468\u2474-\u247c\u2488-\u2490\u24ea\u24f5-\u24fd\u24ff\u2776-\u277e\u2780-\u2788\u278a-\u2792\u{10a40}-\u{10a43}\u{10e60}-\u{10e68}\u{11052}-\u{1105a}\u{1f100}-\u{1f10a}]+$/u.test(
            s,
          )
        case "isalpha":
          return /^\p{L}+$/u.test(s)
        case "isalnum":
          return /^[\p{L}\p{N}]+$/u.test(s)
        case "isspace":
          return /^[\p{White_Space}\u001c-\u001f]+$/u.test(s)
        case "islower":
          return /\p{Lowercase}/u.test(s) && !/[\p{Uppercase}\p{Lt}]/u.test(s)
        case "isupper":
          return /\p{Uppercase}/u.test(s) && !/[\p{Lowercase}\p{Lt}]/u.test(s)
      }
    }
    if (name === "replace") {
      arity(name, args, 2, 3)
      const old = text(args[0]),
        replacement = text(args[1]),
        limit = args.length === 3 ? integer(args[2]) : -1
      let pos = 0,
        out = "",
        remaining = limit < 0 ? Infinity : limit
      while (remaining-- > 0 && pos <= s.length) {
        if (ctx.runner.tick()) yield Slice
        const at = old ? s.indexOf(old, pos) : pos
        if (at < 0) break
        const width = old.length || (at === s.length ? 0 : s.codePointAt(at)! > 0xffff ? 2 : 1)
        checkStringLength(out.length + at - pos + replacement.length + (old ? 0 : width))
        out += s.slice(pos, at) + replacement + (old ? "" : s.slice(at, at + width))
        pos = at + width
        if (!width) break
      }
      checkStringLength(out.length + s.length - pos)
      return out + s.slice(pos)
    }
    if (["partition", "rpartition", "removeprefix", "removesuffix"].includes(name)) {
      arity(name, args, 1)
      const sep = text(args[0])
      if (name === "removeprefix") return s.startsWith(sep) ? s.slice(sep.length) : s
      if (name === "removesuffix") return sep && s.endsWith(sep) ? s.slice(0, -sep.length) : s
      if (!sep) throw typeError("Empty separator.")
      const at = name === "partition" ? s.indexOf(sep) : s.lastIndexOf(sep)
      return new Tuple(
        ctx.builtins.Array,
        at < 0 ? (name === "partition" ? [s, "", ""] : ["", "", s]) : [s.slice(0, at), sep, s.slice(at + sep.length)],
      )
    }
    arity(name, args, 1, 3)
    const length = size(s)
    const bound = (v: Value, dflt: number) =>
      v == null ? dflt : integer(v) < 0 ? Math.max(0, length + integer(v)) : integer(v)
    const start = bound(args[1], 0),
      end = Math.min(length, bound(args[2], length))
    let a = 0,
      b = s.length
    if (args.length > 1) {
      let i = 0,
        offset = 0
      for (const c of s) {
        if (ctx.runner.tick()) yield Slice
        if (i === start) a = offset
        if (i === end) {
          b = offset
          break
        }
        offset += c.length
        i++
      }
      if (start >= length) a = s.length
    }
    const part = s.slice(a, b),
      valid = start <= end
    if (name === "startswith" || name === "endswith") {
      const candidates = args[0] instanceof Tuple ? args[0].items : [args[0]]
      for (const item of candidates) {
        if (ctx.runner.tick()) yield Slice
        const sub = text(item)
        if (valid && (name === "startswith" ? part.startsWith(sub) : part.endsWith(sub))) return true
      }
      return false
    }
    const sub = text(args[0])
    if (name === "count") {
      if (!valid) return 0
      if (!sub) return end - start + 1
      let n = 0,
        pos = 0
      while (true) {
        if (ctx.runner.tick()) yield Slice
        const at = part.indexOf(sub, pos)
        if (at < 0) return n
        n++
        pos = at + sub.length
      }
    }
    const found = valid ? (name.startsWith("r") ? part.lastIndexOf(sub) : part.indexOf(sub)) : -1
    if (found < 0 && name.endsWith("index")) throw typeError("Substring not found.")
    return found < 0 ? -1 : start + size(part.slice(0, found))
  })
}

function* split<R>(ctx: Interpreter<R>, s: string, sep: string | null, max: number, reverse: boolean): Eval<Value> {
  if (sep === "") throw typeError("Empty separator.")
  const result = list(ctx),
    limit = max < 0 ? Infinity : max
  const add = (x: string) => {
    checkArrayLength(result.items.length + 1)
    result.items.push(x)
  }
  let pos = reverse ? s.length : 0
  if (sep === null) {
    const inside = () => (reverse ? pos > 0 : pos < s.length)
    const space = () => whitespace.test(s[reverse ? pos - 1 : pos]!)
    const step = reverse ? -1 : 1
    while (inside()) {
      while (inside() && space()) {
        if (ctx.runner.tick()) yield Slice
        pos += step
      }
      if (!inside()) break
      if (result.items.length === limit) {
        add(reverse ? s.slice(0, pos) : s.slice(pos))
        break
      }
      const prev = pos
      while (inside() && !space()) {
        if (ctx.runner.tick()) yield Slice
        pos += step
      }
      add(reverse ? s.slice(pos, prev) : s.slice(prev, pos))
    }
  } else {
    while (result.items.length < limit) {
      if (ctx.runner.tick()) yield Slice
      const at = reverse ? (pos < sep.length ? -1 : s.lastIndexOf(sep, pos - sep.length)) : s.indexOf(sep, pos)
      if (at < 0) break
      add(reverse ? s.slice(at + sep.length, pos) : s.slice(pos, at))
      pos = reverse ? at : at + sep.length
    }
    add(reverse ? s.slice(0, pos) : s.slice(pos))
  }
  if (reverse) result.items.reverse()
  return result
}

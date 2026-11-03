import { RE2JS, type Matcher } from "re2js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { checkArrayLength, checkStringLength } from "../interpreter/limits.js"
import { rangeError, typeError } from "../interpreter/model.js"
import { fn } from "../interpreter/native.js"
import { record, type Value } from "../interpreter/objects.js"
import { type Eval, Slice } from "../interpreter/runner.js"
import { keyword, onlyKeywords } from "./native.js"
import { arity, integer, list, size, Tuple } from "./values.js"
import { reMethods } from "./module-names.js"
import { text } from "./text.js"

export function reModule<R>(ctx: Interpreter<R>) {
  const cache = new Map<string, RE2JS>()
  const compile = (source: Value, flags: Value) => {
    const pattern = text(source),
      bits = integer(flags)
    if (!Number.isSafeInteger(bits) || bits < 0 || bits > 26 || (bits & ~26) !== 0)
      throw typeError("Supported regex flags: IGNORECASE, MULTILINE, DOTALL.")
    if (pattern.length > 512) throw rangeError("Regex patterns are limited to 512 characters.")
    const key = bits + ":" + pattern,
      cached = cache.get(key)
    if (cached) return cached
    // Conservatively cap counted repeats before compilation expands them into instructions.
    let expanded = pattern.length
    for (const repeat of pattern.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
      expanded *= Math.max(1, Number(repeat[2] || repeat[1]))
      if (expanded > 65_536) throw rangeError("Regex repetition budget exceeded.")
    }
    const re = RE2JS.compile(
      pattern,
      (bits & 2 ? RE2JS.CASE_INSENSITIVE : 0) | (bits & 8 ? RE2JS.MULTILINE : 0) | (bits & 16 ? RE2JS.DOTALL : 0),
    )
    if (re.groupCount() > 32 || re.programSize() > 4096) throw rangeError("Regex is too complex.")
    if (cache.size >= 32) cache.delete(cache.keys().next().value!)
    cache.set(key, re)
    return re
  }
  const matchRecord = (m: Matcher, s: string) => {
    const group = (v: Value) => (typeof v === "string" ? v : integer(v))
    const index = (pos: number) => (pos < 0 ? -1 : size(s.slice(0, pos)))
    const field = (args: Value[]) => {
      arity("group index", args, 0, 1)
      return args.length ? group(args[0]) : 0
    }
    return record(ctx.builtins.Object, {
      group: fn(ctx.builtins, "group", 0, (_, args) =>
        args.length > 1
          ? new Tuple(
              ctx.builtins.Array,
              args.map((v) => m.group(group(v))),
            )
          : m.group(field(args)),
      ),
      groups: fn(ctx.builtins, "groups", 0, (_, args) => {
        arity("groups", args, 0, 1)
        return new Tuple(
          ctx.builtins.Array,
          Array.from({ length: m.groupCount() }, (_, i) => m.group(i + 1) ?? args[0] ?? null),
        )
      }),
      start: fn(ctx.builtins, "start", 0, (_, args) => index(m.start(field(args)))),
      end: fn(ctx.builtins, "end", 0, (_, args) => index(m.end(field(args)))),
      span: fn(ctx.builtins, "span", 0, (_, args) => {
        const k = field(args)
        return new Tuple(ctx.builtins.Array, [index(m.start(k)), index(m.end(k))])
      }),
    })
  }
  const method = (name: (typeof reMethods)[number], compiled?: RE2JS) =>
    keyword(ctx, name, function* (args, kw): Eval<Value> {
      // Module form: re.sub(pattern, repl, string, count=0, flags=0); bound form omits pattern and flags.
      const limitName = name === "sub" ? "count" : name === "split" ? "maxsplit" : undefined
      onlyKeywords(kw, ...(limitName ? [limitName] : []), ...(compiled ? [] : ["flags"]))
      const base = (compiled ? 0 : 1) + (name === "sub" ? 2 : 1)
      arity(name, args, base, base + Number(!!limitName) + Number(!compiled))
      const option = (key: string, i: number) => {
        if (i < args.length && kw.has(key)) throw typeError(`Multiple values for '${key}'.`)
        return kw.has(key) ? kw.get(key) : i < args.length ? args[i] : 0
      }
      const re = compiled ?? compile(args[0], option("flags", base + Number(!!limitName)))
      const s = text(args[base - 1]),
        limit = limitName ? integer(option(limitName, base)) : 0
      // Matching is linear, but one matcher step cannot yield. Bound its work as well as the returned data.
      if (s.length * Math.max(1, re.programSize()) > 32_000_000)
        throw rangeError("Regex input is too large for this pattern.")
      const m = re.matcher(s)
      if (name === "search" || name === "match" || name === "fullmatch")
        return (name === "search" ? m.find() : name === "match" ? m.lookingAt() : m.matches())
          ? matchRecord(m, s)
          : null
      let pos = 0,
        n = 0,
        out = ""
      const result = list(ctx)
      const append = (v: Value) => {
        checkArrayLength(result.items.length + 1)
        result.items.push(v)
      }
      const add = (v: string) => {
        checkStringLength(out.length + v.length)
        out += v
      }
      const replacement = name === "sub" ? text(args[base - 2]) : ""
      while ((limit === 0 || n < limit) && m.find()) {
        if (ctx.runner.tick()) yield Slice
        n++
        if (name === "sub") {
          add(s.slice(pos, m.start()))
          let last = 0
          for (const token of replacement.matchAll(/\\(?:g<([^>]+)>|([1-9][0-9]*)|([\s\S]))/g)) {
            if (ctx.runner.tick()) yield Slice
            add(replacement.slice(last, token.index))
            last = token.index + token[0].length
            const ref = token[1] ?? token[2]
            if (ref !== undefined) {
              add(m.group(/^\d+$/.test(ref) ? Number(ref) : ref) ?? "")
              continue
            }
            const esc = token[3]
            if (!["n", "r", "t", "\\"].includes(esc)) throw typeError(`Unsupported replacement escape: ${esc}`)
            add(esc === "n" ? "\n" : esc === "r" ? "\r" : esc === "t" ? "\t" : "\\")
          }
          add(replacement.slice(last))
        } else if (name === "split") {
          append(s.slice(pos, m.start()))
          for (let i = 1; i <= m.groupCount(); i++) append(m.group(i))
        } else if (m.groupCount() < 2) append(m.group(m.groupCount()) ?? "")
        else
          append(
            new Tuple(
              ctx.builtins.Array,
              Array.from({ length: m.groupCount() }, (_, i) => m.group(i + 1) ?? ""),
            ),
          )
        pos = m.end()
      }
      if (name === "sub") {
        add(s.slice(pos))
        return out
      }
      if (name === "split") append(s.slice(pos))
      return result
    })
  return record(ctx.builtins.Object, {
    I: 2,
    IGNORECASE: 2,
    M: 8,
    MULTILINE: 8,
    S: 16,
    DOTALL: 16,
    ...Object.fromEntries(reMethods.map((name) => [name, method(name)])),
    compile: keyword(ctx, "compile", function* (args, kw) {
      onlyKeywords(kw, "flags")
      arity("compile", args, 1, 2)
      if (args.length === 2 && kw.size) throw typeError("Multiple flags.")
      const re = compile(args[0], kw.has("flags") ? kw.get("flags") : args.length === 2 ? args[1] : 0)
      return record(ctx.builtins.Object, Object.fromEntries(reMethods.map((name) => [name, method(name, re)])))
    }),
    escape: fn(ctx.builtins, "escape", 1, (_, args) => {
      arity("escape", args, 1)
      const s = text(args[0]).replace(/[()\[\]{}?*+\-.^$\\|#&~ \t\n\r\v\f]/g, "\\$&")
      checkStringLength(s.length)
      return s
    }),
  })
}

import { fromJson, type Json } from "../data.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { checkStringLength, MAX_VALUE_DEPTH } from "../interpreter/limits.js"
import { rangeError, typeError } from "../interpreter/model.js"
import { fn } from "../interpreter/native.js"
import { Arr, getOwn, record, type Value } from "../interpreter/objects.js"
import { type Eval, Slice } from "../interpreter/runner.js"
import { keyword, onlyKeywords } from "./native.js"
import { sorted } from "./sequence.js"
import { text } from "./text.js"
import { arity, dict, integer, truth, values } from "./values.js"

export function jsonModule<R>(ctx: Interpreter<R>) {
  return record(ctx.builtins.Object, {
    loads: fn(ctx.builtins, "loads", 1, function* (_, args): Eval<Value> {
      arity("json.loads", args, 1)
      const s = text(args[0])
      checkStringLength(s.length)
      // Bound nesting before native parsing and recursive copy-in. Brackets inside strings are data.
      let quoted = false,
        depth = 0
      let nodes = 1
      for (let i = 0; i < s.length; i++) {
        if (ctx.runner.tick()) yield Slice
        if (quoted && s[i] === "\\") {
          i++
          continue
        }
        if (s[i] === '"') quoted = !quoted
        if (quoted) continue
        if ((s[i] === "[" || s[i] === "{" || s[i] === ",") && ++nodes > 1_000_000)
          throw rangeError("JSON structure exceeds the node budget.")
        if (s[i] === "{" || s[i] === "[") {
          if (++depth > MAX_VALUE_DEPTH) throw rangeError("JSON nested too deeply.")
        }
        if (s[i] === "}" || s[i] === "]") depth--
      }
      const parsed: Json = JSON.parse(s, (_key, v: unknown) => {
        if (typeof v === "number" && !Number.isFinite(v)) throw rangeError("JSON number is out of range.")
        return v
      })
      return fromJson(ctx, parsed)
    }),
    dumps: keyword(ctx, "dumps", function* (args, kw) {
      arity("json.dumps", args, 1)
      onlyKeywords(kw, "indent", "ensure_ascii", "sort_keys", "separators")
      const indent = kw.get("indent")
      const pretty = indent != null,
        ascii = !kw.has("ensure_ascii") || truth(kw.get("ensure_ascii"))
      const width = indent == null ? 0 : typeof indent === "string" ? indent.length : Math.max(0, integer(indent))
      const separators = kw.get("separators")
      if (separators != null && (!(separators instanceof Arr) || separators.items.length !== 2))
        throw typeError("Expected two separators.")
      const comma = separators instanceof Arr ? text(separators.items[0]) : pretty ? "," : ", ",
        colon = separators instanceof Arr ? text(separators.items[1]) : ": "
      let out = ""
      const add = (s: string) => {
        checkStringLength(out.length + s.length)
        out += s
      }
      const newline = (depth: number) => {
        if (!pretty) return
        checkStringLength(out.length + 1 + width * depth)
        out += "\n" + (typeof indent === "string" ? indent.repeat(depth) : " ".repeat(width * depth))
      }
      function* quote(s: string): Eval<void> {
        add('"')
        let start = 0
        for (let i = 0; i < s.length; i++) {
          if (ctx.runner.tick()) yield Slice
          const n = s.charCodeAt(i)
          if (n >= 32 && n !== 34 && n !== 92 && (!ascii || n < 127)) continue
          add(s.slice(start, i))
          start = i + 1
          add(
            n === 34
              ? '\\"'
              : n === 92
                ? "\\\\"
                : n === 10
                  ? "\\n"
                  : n === 13
                    ? "\\r"
                    : n === 9
                      ? "\\t"
                      : n === 8
                        ? "\\b"
                        : n === 12
                          ? "\\f"
                          : "\\u" + n.toString(16).padStart(4, "0"),
          )
        }
        add(s.slice(start))
        add('"')
      }
      function* write(v: Value, depth: number): Eval<void> {
        if (ctx.runner.tick()) yield Slice
        if (depth > MAX_VALUE_DEPTH) throw rangeError("JSON nested too deeply.")
        if (v == null) return add("null")
        if (typeof v === "string") return yield* quote(v)
        if (typeof v === "number" || typeof v === "boolean") return add(String(v))
        if (!(v instanceof Arr) && !dict(v)) throw typeError("Value is not JSON serializable.")
        const array = v instanceof Arr
        add(array ? "[" : "{")
        let first = true
        const entries = !array && truth(kw.get("sort_keys")) ? values(yield* sorted(ctx, [v], new Map())) : values(v)
        for (const entry of entries) {
          if (!first) add(comma)
          first = false
          newline(depth + 1)
          if (!array) {
            yield* quote(text(entry))
            add(colon)
          }
          yield* write(array ? entry : getOwn(v, text(entry)), depth + 1)
        }
        if (!first) newline(depth)
        add(array ? "]" : "}")
      }
      yield* write(args[0], 0)
      return out
    }),
  })
}

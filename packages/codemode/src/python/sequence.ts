import type { Interpreter } from "../interpreter/interpreter.js"
import { checkArrayLength, checkStringLength, MAX_ARRAY_LENGTH, MAX_VALUE_DEPTH } from "../interpreter/limits.js"
import { type AstNode, rangeError, typeError } from "../interpreter/model.js"
import { Arr, Callable, Coroutine, PromiseObj, type Value } from "../interpreter/objects.js"
import { type Eval, Slice } from "../interpreter/runner.js"
import { arity, cursor, dict, equal, integer, list, numeric, Tuple } from "./values.js"

function* codePointCount<R>(ctx: Interpreter<R>, text: string): Eval<number> {
  let n = 0
  for (const _ of text) {
    if (ctx.runner.tick()) yield Slice
    n++
  }
  return n
}

export function* slice<R>(ctx: Interpreter<R>, seq: Value, start: Value, stop: Value, stride: Value): Eval<Value> {
  if (!(seq instanceof Arr) && typeof seq !== "string") throw typeError("Only sequences support slicing.")
  const step = stride == null ? 1 : integer(stride)
  if (!step) throw rangeError("Slice step cannot be zero.")
  const n = seq instanceof Arr ? seq.items.length : yield* codePointCount(ctx, seq)
  const bound = (value: Value, fallback: number) => {
    if (value == null) return fallback
    const index = integer(value)
    const low = step > 0 ? 0 : -1
    return Math.max(low, Math.min(n + low, index < 0 ? index + n : index))
  }
  const first = bound(start, step > 0 ? 0 : n - 1)
  const end = bound(stop, step > 0 ? n : -1)
  const count = Math.max(0, Math.ceil((end - first) / step))
  if (seq instanceof Arr) {
    checkArrayLength(count)
    const result = seq instanceof Tuple ? new Tuple(ctx.builtins.Array) : list(ctx)
    for (let i = 0; i < count; i++) {
      if (ctx.runner.tick()) yield Slice
      result.items.push(seq.items[first + i * step])
    }
    return result
  }
  // Walk UTF-16 in the requested direction without materializing an array of every code point.
  if (!count) return ""
  if (step === 1 && first === 0 && end === n) {
    checkStringLength(seq.length)
    return seq
  }
  const chunk: string[] = []
  let result = ""
  let pos = step > 0 ? 0 : seq.length
  let next = first
  for (let i = step > 0 ? 0 : n - 1; step > 0 ? i < end : i > end; i += Math.sign(step)) {
    if (ctx.runner.tick()) yield Slice
    const width = (seq.codePointAt(step > 0 ? pos : pos - 2) ?? 0) > 0xffff ? 2 : 1
    if (step < 0) pos -= width
    if (i === next) {
      chunk.push(seq.slice(pos, pos + width))
      if (chunk.length === 4096) {
        const text = chunk.join("")
        checkStringLength(result.length + text.length)
        result += text
        chunk.length = 0
      }
      next += step
    }
    if (step > 0) pos += width
  }
  const tail = chunk.join("")
  checkStringLength(result.length + tail.length)
  return result + tail
}

export function* sorted<R>(
  ctx: Interpreter<R>,
  args: Value[],
  kw: ReadonlyMap<string, Value>,
  site?: AstNode,
): Eval<Arr> {
  arity("sorted", args, 1)
  for (const k of kw.keys()) if (k !== "key" && k !== "reverse") throw typeError(`Unknown sorted keyword '${k}'.`)
  const key = kw.get("key")
  if (key != null && !(key instanceof Callable)) throw typeError("sorted() key must be a synchronous function or None.")
  const reverse = kw.has("reverse") && integer(kw.get("reverse")) !== 0
  const items: Value[] = []
  // Snapshot the iterable before invoking keys: a key may mutate the original list.
  const source = args[0]
  if (source instanceof Arr) checkArrayLength(source.items.length)
  if (dict(source)) checkArrayLength(source.props.size)
  if (typeof source === "string" && source.length > MAX_ARRAY_LENGTH)
    checkArrayLength(yield* codePointCount(ctx, source))
  const iter = cursor(source)
  for (let s = yield* iter.next(); !s.done; s = yield* iter.next()) {
    if (ctx.runner.tick()) yield Slice
    checkArrayLength(items.length + 1)
    items.push(s.value)
  }
  const keys = key == null ? items : []
  if (key != null) {
    for (const item of items) {
      if (ctx.runner.tick()) yield Slice
      const k = yield* ctx.call(key, undefined, [item], site)
      if (k instanceof Coroutine || k instanceof PromiseObj) throw typeError("sorted() key returned an awaitable.")
      keys.push(k)
    }
  }
  // A native sort cannot yield. Merge indices stably, including in reverse order, reusing both buffers.
  let order = new Uint32Array(items.length)
  let buffer = new Uint32Array(items.length)
  for (let i = 0; i < items.length; i++) {
    if (ctx.runner.tick()) yield Slice
    order[i] = i
  }
  for (let width = 1; width < items.length; width *= 2) {
    for (let base = 0; base < items.length; base += 2 * width) {
      const mid = Math.min(base + width, items.length)
      const end = Math.min(mid + width, items.length)
      let left = base
      let right = mid
      for (let i = base; i < end; i++) {
        if (ctx.runner.tick()) yield Slice
        const a = keys[order[left]!]
        const b = keys[order[right]!]
        const takeRight = right < end && (left === mid || (yield* less(ctx, reverse ? a : b, reverse ? b : a)))
        buffer[i] = order[takeRight ? right++ : left++]!
      }
    }
    ;[order, buffer] = [buffer, order]
  }
  const result = list(ctx)
  for (const i of order) {
    if (ctx.runner.tick()) yield Slice
    result.items.push(items[i])
  }
  return result
}

export function* less<R>(ctx: Interpreter<R>, a: Value, b: Value, depth = 0): Eval<boolean> {
  if (a instanceof Arr && b instanceof Arr && a instanceof Tuple === b instanceof Tuple) {
    if (depth > MAX_VALUE_DEPTH) throw rangeError("Comparison nested too deeply.")
    for (let i = 0; i < Math.min(a.items.length, b.items.length); i++)
      if (!(yield* equal(ctx, a.items[i], b.items[i]))) return yield* less(ctx, a.items[i], b.items[i], depth + 1)
    return a.items.length < b.items.length
  }
  if (typeof a !== "string" || typeof b !== "string") return numeric(a) < numeric(b)
  // Python compares Unicode code points, not UTF-16 code units.
  let i = 0
  while (i < a.length && i < b.length) {
    if (ctx.runner.tick()) yield Slice
    const x = a.codePointAt(i)!
    const y = b.codePointAt(i)!
    if (x !== y) return x < y
    i += x > 0xffff ? 2 : 1
  }
  return a.length < b.length
}

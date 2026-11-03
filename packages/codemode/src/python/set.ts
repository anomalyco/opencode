import type { Interpreter } from "../interpreter/interpreter.js"
import { checkArrayLength } from "../interpreter/limits.js"
import { typeError } from "../interpreter/model.js"
import { fn } from "../interpreter/native.js"
import { SetObj, type Value } from "../interpreter/objects.js"
import { type Eval, Slice } from "../interpreter/runner.js"
import { arity, cursor } from "./values.js"

// JSON scalar keys, with Python's True == 1 and False == 0. Keep the first representative for iteration.
export class PythonSet extends SetObj {
  private key(v: Value) {
    if (v != null && !["string", "boolean", "number"].includes(typeof v))
      throw typeError("Only scalar set elements are supported.")
    if (typeof v === "boolean" && this.set.has(Number(v))) return Number(v)
    if ((v === 0 || v === 1) && this.set.has(!!v)) return !!v
    return v ?? null
  }
  hasItem(v: Value) {
    return this.set.has(this.key(v))
  }
  addItem(v: Value) {
    const k = this.key(v)
    if (!this.set.has(k)) {
      checkArrayLength(this.set.size + 1)
      this.set.add(k)
    }
  }
  *members() {
    const n = this.set.size
    for (const v of this.set) {
      yield v
      if (this.set.size !== n) throw typeError("Set changed size during iteration.")
    }
  }
  deleteItem(v: Value) {
    return this.set.delete(this.key(v))
  }
}
export const setMethods = ["add", "discard", "remove", "clear", "copy", "update", "union", "intersection", "difference"]
export function* makeSet<R>(ctx: Interpreter<R>, source: Value): Eval<PythonSet> {
  const result = new PythonSet(ctx.builtins.Set),
    it = cursor(source)
  for (let s = yield* it.next(); !s.done; s = yield* it.next()) {
    if (ctx.runner.tick()) yield Slice
    result.addItem(s.value)
  }
  return result
}
export function setMethod<R>(ctx: Interpreter<R>, self: PythonSet, name: string) {
  return fn(ctx.builtins, name, 1, function* (_, args): Eval<Value> {
    if (name === "clear" || name === "copy") {
      arity(name, args, 0)
      if (name === "copy") return yield* makeSet(ctx, self)
      self.set.clear()
      return null
    }
    if (["add", "discard", "remove"].includes(name)) {
      arity(name, args, 1)
      if (name === "add") self.addItem(args[0])
      else if (!self.deleteItem(args[0]) && name === "remove") throw typeError("Missing set member.")
      return null
    }
    let out = name === "update" ? self : yield* makeSet(ctx, self)
    for (const arg of args) {
      if (name === "intersection") {
        const common = new PythonSet(ctx.builtins.Set),
          it = cursor(arg)
        for (let s = yield* it.next(); !s.done; s = yield* it.next()) {
          if (ctx.runner.tick()) yield Slice
          if (out.hasItem(s.value)) common.addItem(s.value)
        }
        out = common
      } else {
        const it = cursor(arg)
        for (let s = yield* it.next(); !s.done; s = yield* it.next()) {
          if (ctx.runner.tick()) yield Slice
          if (name === "difference") out.deleteItem(s.value)
          else out.addItem(s.value)
        }
      }
    }
    return name === "update" ? null : out
  })
}

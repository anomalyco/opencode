import luaparse from "luaparse"
import {
  LuaClosure,
  LuaCoroutine,
  LuaError,
  LuaTable,
  NativeFunction,
  arith,
  compare,
  concat,
  getMetatable,
  index,
  len,
  luaToNumber,
  newindex,
  shortSrc,
  truthy,
  typeName,
} from "v8lua/src/runtime.js"
import { Call, runFrames } from "./evaluate.js"

const boundaryError = "attempt to yield across metamethod/C-call boundary"

export class VM {
  ops = {
    table: () => new LuaTable(),
    closure: (...args) => new LuaClosure(...args),
    error: (message) => new LuaError(message),
    stackOverflow: () => new LuaError("stack overflow"),
    number: luaToNumber,
    truthy,
    index: (a, b) => this.atomic(index(a, b)),
    newindex: (a, b, c) => this.atomic(newindex(a, b, c)),
    len: (a) => this.atomic(len(a)),
    arith: (op, a, b) => this.atomic(arith(op, a, b)),
    compare: (op, a, b) => this.atomic(compare(op, a, b)),
    concat: (a, b) => this.atomic(concat(a, b)),
  }
  poll() {
    return false
  }
  charge() {}
  *iterate(fn, args) {
    return this.atomic(this.invoke(fn, args))
  }
  frameLimit = 20000
  isClosure(fn) {
    return fn instanceof LuaClosure
  }
  resolveCall(call) {
    const fn = call.fn
    if (fn instanceof LuaClosure || fn instanceof NativeFunction) return call
    const handler = getMetatable(fn)?.get("__call")
    if (!(handler instanceof LuaClosure || handler instanceof NativeFunction))
      throw new LuaError(`attempt to call a ${typeName(fn)} value`)
    return new Call(handler, [fn, ...call.args])
  }
  *native(fn, args) {
    if (fn !== this.yieldFn) return this.atomic(fn.fn(this, args)) ?? []
    if (this.thread === this.main || this.thread.barriers) throw new LuaError(boundaryError)
    return yield args
  }
  globals = new LuaTable()
  main = { frames: [], barriers: 0 }
  thread = this.main
  hook = null // v8lua native library callbacks do not run debug hooks.

  compile(source, chunkname) {
    let proto
    try {
      proto = luaparse.parse(source, {
        luaVersion: "5.1",
        encodingMode: "pseudo-latin1",
        locations: true,
        comments: false,
        onCreateNode(node) {
          if (node.type === "FunctionDeclaration" && node.parameters.at(-1)?.type === "VarargLiteral") {
            node.legacyArg = !usesVarargs(node.body)
          }
        },
      })
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e
      throw new LuaError(`${shortSrc(chunkname)}:${e.line}: ${e.message}`)
    }
    const chunk = new LuaClosure(proto, null, chunkname, this)
    chunk.env = this.thread.env ?? this.globals
    chunk.chunkname = chunkname
    return chunk
  }

  // A synchronous library or metamethod callback may run Lua but cannot yield
  // to its caller. Resuming a *different* thread starts with its own barriers.
  atomic(code) {
    const thread = this.thread
    thread.barriers++
    try {
      const result = code.next()
      if (!result.done) throw new Error("unexpected suspension across VM boundary")
      return result.value
    } finally {
      thread.barriers--
    }
  }

  *invoke(fn, args) {
    const thread = this.thread
    const frames = thread.frames
    const base = frames.length
    try {
      return yield* runFrames(this, frames, new Call(fn, args))
    } catch (e) {
      const err = e instanceof RangeError ? new LuaError("stack overflow") : e
      if (err instanceof LuaError && !err.positioned && frames.length > base) {
        const frame = frames.at(-1)
        if (typeof err.luaMessage === "string")
          err.message = err.luaMessage = `${shortSrc(frame.closure.chunkname)}:${frame.line}: ${err.luaMessage}`
        err.positioned = true
      }
      throw err
    } finally {
      frames.length = base
    }
  }

  create(fn) {
    if (!(fn instanceof LuaClosure)) throw new LuaError("Lua function expected")
    const thread = new LuaCoroutine(fn)
    thread.frames = []
    thread.barriers = 0
    thread.env = this.thread.env ?? this.globals
    return thread
  }

  resume(thread, args) {
    if (!(thread instanceof LuaCoroutine)) throw new LuaError("thread expected")
    if (thread.status !== "suspended") return [false, `cannot resume ${thread.status} coroutine`]
    const parent = this.thread
    parent.status = "normal"
    thread.status = "running"
    this.thread = thread
    try {
      thread.it ??= this.invoke(thread.fn, args)
      const result = thread.it.next(args)
      thread.status = result.done ? "dead" : "suspended"
      return [true, ...result.value]
    } catch (e) {
      thread.status = "dead"
      if (e instanceof LuaError) return [false, e.luaMessage]
      throw e
    } finally {
      this.thread = parent
      parent.status = "running"
      if (thread.status === "dead") thread.it = thread.fn = null
    }
  }
}

// Lua 5.1 compatibility: a vararg function gets a local arg table only
// when it doesn't use `...` itself. Nested function bodies don't count.
function usesVarargs(node) {
  if (node === null || typeof node !== "object" || node.type === "FunctionDeclaration") return false
  return node.type === "VarargLiteral" || Object.values(node).some(usesVarargs)
}

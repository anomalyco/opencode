import {
  LuaClosure,
  LuaCoroutine,
  LuaError,
  LuaTable,
  NativeFunction,
  getMetatable,
  luaToNumber,
  numberToString,
  shortSrc,
  tostringMM,
  truthy,
  typeName,
} from "v8lua/src/runtime.js"
import installMath from "v8lua/src/lib/math.js"
import installString from "v8lua/src/lib/string.js"
import installTable from "v8lua/src/lib/table.js"
import { checkNum, checkStr, checkTable } from "v8lua/src/lib/helpers.js"

function native(name, fn, required = 0) {
  return new NativeFunction(name, function* (_, args) {
    if (args.length < required) throw new LuaError(`bad argument #${required} to '${name}' (value expected)`)
    return fn(...args)
  })
}

function rethrow(value) {
  const e = new LuaError(value)
  e.positioned = true
  throw e
}

export function install(vm) {
  installMath(vm)
  installString(vm)
  installTable(vm)
  const G = vm.globals
  const table = G.get("table")
  G.set("unpack", table.get("unpack"))
  table.set("unpack", undefined)
  G.get("string").set("dump", undefined) // no v8lua AST dumps or binary chunk loader
  G.set("_VERSION", "Lua 5.1")
  G.set("_G", G)

  function load(source, name) {
    try {
      return [vm.compile(source, name)]
    } catch (e) {
      if (e instanceof LuaError) return [undefined, e.luaMessage]
      throw e
    }
  }
  function protect(fn, args) {
    try {
      return [true, ...vm.atomic(vm.invoke(fn, args))]
    } catch (e) {
      if (e instanceof LuaError) return [false, e.luaMessage]
      throw e
    }
  }
  function envTarget(target) {
    if (target instanceof LuaClosure || target instanceof NativeFunction) return target
    if (target === 0) return vm.thread
    const frame = Number.isInteger(target) && target > 0 && vm.thread.frames.at(-target)
    if (!frame) throw new LuaError("invalid function or stack level")
    return frame.closure
  }
  const next = native("next", (t, key) => checkTable(t, 1, "next").next(key) ?? [undefined])
  const inext = native("ipairs iterator", (t, key) => {
    const i = checkNum(key, 2, "ipairs") + 1
    const v = checkTable(t, 1, "ipairs").get(i)
    return v === undefined ? [] : [i, v]
  })
  G.set("next", next)
  const base = {
    type: (value) => [typeName(value)],
    tostring: (v) => [vm.atomic(tostringMM(v))],
    tonumber: (v, base = 10) => {
      const radix = Math.trunc(checkNum(base, 2, "tonumber"))
      if (radix === 10) return [luaToNumber(v)]
      if (!(radix >= 2 && radix <= 36)) throw new LuaError("base out of range")
      return [luaToNumber(checkStr(v, 1, "tonumber"), radix)]
    },
    print: (...args) => {
      console.log(args.map((v) => checkStr(vm.atomic(vm.invoke(G.get("tostring"), [v]))[0], 1, "print")).join("\t"))
      return []
    },
    error: (value, level = 1) => {
      if (checkNum(level, 2, "error") <= 0) rethrow(value)
      const msg = typeof value === "number" ? numberToString(value) : value
      const frame = level > 0 && vm.thread.frames.at(-level)
      rethrow(frame && typeof msg === "string" ? `${shortSrc(frame.closure.chunkname)}:${frame.line}: ${msg}` : msg)
    },
    assert: (...args) => {
      if (!truthy(args[0])) throw new LuaError(checkStr(args[1] ?? "assertion failed!", 2, "assert"))
      return args
    },
    pcall: (fn, ...args) => protect(fn, args),
    xpcall: (fn, handler) => {
      const result = protect(fn, [])
      if (result[0]) return result
      const handled = protect(handler, [result[1]])
      return [false, handled[0] ? handled[1] : "error in error handling"]
    },
    pairs: (v) => [next, checkTable(v, 1, "pairs"), undefined],
    ipairs: (v) => [inext, checkTable(v, 1, "ipairs"), 0],
    select: (n, ...args) => {
      if (n === "#") return [args.length]
      const i = Math.trunc(checkNum(n, 1, "select"))
      if (i === 0 || i < -args.length) throw new LuaError("index out of range")
      return args.slice(i < 0 ? i : i - 1)
    },
    rawget: (t, k) => [checkTable(t, 1, "rawget").get(k)],
    rawset: (t, k, v) => {
      checkTable(t, 1, "rawset").set(k, v)
      return [t]
    },
    rawequal: (a, b) => [a === b],
    getmetatable: (v) => {
      const mt = getMetatable(v)
      return [mt?.get("__metatable") ?? mt]
    },
    setmetatable: (t, mt) => {
      checkTable(t, 1, "setmetatable")
      if (mt !== undefined) checkTable(mt, 2, "setmetatable")
      if (t.metatable?.get("__metatable") !== undefined) throw new LuaError("cannot change a protected metatable")
      t.metatable = mt
      return [t]
    },
    getfenv: (f = 1) => [envTarget(f).env ?? vm.thread.env ?? G],
    setfenv: (f, t) => {
      const target = envTarget(f)
      if (target instanceof NativeFunction) throw new LuaError("cannot change environment of given object")
      target.env = checkTable(t, 2, "setfenv")
      return f === 0 ? [] : [target]
    },
    loadstring: (source, name) => {
      const s = checkStr(source, 1, "loadstring")
      return load(s, name ?? s)
    },
    load: (reader, name) => {
      if (typeName(reader) !== "function") throw new LuaError("reader function expected")
      const parts = []
      for (;;) {
        const result = protect(reader, [])
        if (!result[0]) return [undefined, result[1]]
        if (result[1] === undefined || result[1] === "") return load(parts.join(""), name ?? "=(load)")
        if (typeof result[1] !== "string") return [undefined, "reader function must return a string"]
        parts.push(result[1])
      }
    },
    collectgarbage: (mode = "collect") => {
      if (mode === "step") return [false]
      if (["count", "collect", "stop", "restart", "setpause", "setstepmul"].includes(mode)) return [0]
      throw new LuaError("invalid collectgarbage option")
    },
  }
  // An explicit nil is a valid value; a missing argument isn't. The typed
  // library arguments already have their own checks (e.g. checkTable).
  const required = {
    type: 1,
    tonumber: 1,
    tostring: 1,
    assert: 1,
    pcall: 1,
    xpcall: 2,
    rawget: 2,
    rawset: 3,
    rawequal: 2,
    getmetatable: 1,
    setmetatable: 2,
  }
  for (const [name, fn] of Object.entries(base)) G.set(name, native(name, fn, required[name]))

  const co = new LuaTable()
  const methods = {
    create: (fn) => [vm.create(fn)],
    resume: (thread, ...args) => vm.resume(thread, args),
    running: () => [vm.thread === vm.main ? undefined : vm.thread],
    status: (thread) => {
      if (!(thread instanceof LuaCoroutine)) throw new LuaError("thread expected")
      return [thread.status]
    },
    wrap: (fn) => {
      const thread = vm.create(fn)
      return [
        native("wrapped", (...args) => {
          const [ok, ...values] = vm.resume(thread, args)
          if (!ok) throw new LuaError(values[0])
          return values
        }),
      ]
    },
    // VM.invoke handles a direct call by identity. Reaching this native body
    // means a library callback (e.g. __index) called yield across a C boundary.
    yield: () => {
      throw new LuaError("attempt to yield across metamethod/C-call boundary")
    },
  }
  for (const [name, fn] of Object.entries(methods)) co.set(name, native(name, fn))
  vm.yieldFn = co.get("yield")
  G.set("coroutine", co)
}

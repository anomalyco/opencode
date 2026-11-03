import { Buffer } from "node:buffer"
import luaparse from "luaparse"
import { Call, checkpoint, runFrames } from "./evaluate.js"

// Limits are per invocation, including host arguments, replies and the final
// result. Work is cumulative (not refunded by deleting a key or tail-calling).
const sourceLimit = 32768
const stringLimit = 256 * 1024
const entriesLimit = 8192
const depthLimit = 48
const jsonNull = Symbol("json.null")
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
const tick = Object.freeze({ type: "tick" })
const truthy = (v) => v !== undefined && v !== false

export class LuaFault extends Error {
  constructor(kind, message, location) {
    super(message)
    this.kind = kind
    this.location = location
  }
}

function failure(message) {
  const e = new LuaFault("ExecutionFailure", message)
  e.catchable = true
  return e
}

function limit(message) {
  return new LuaFault("ExecutionFailure", message)
}

function invalid(message) {
  const e = new LuaFault("InvalidDataValue", message)
  e.catchable = true
  return e
}

// luaparse's lexer stores its state at module scope. Finish parsing before
// yielding; never leave a partially parsed chunk suspended during a host call.
function parse(source) {
  if (typeof source !== "string") throw new LuaFault("ParseError", "Expected Lua source text")
  if (source.length > sourceLimit || Buffer.byteLength(source) > sourceLimit)
    throw new LuaFault("ParseError", "Lua source exceeds the size limit")
  if (!source.isWellFormed()) throw new LuaFault("ParseError", "Lua source must be valid Unicode")
  // Its long-string scanner compares every '=' on every closing bracket.
  if (/\[={33}/.test(source)) throw new LuaFault("ParseError", "Lua long-bracket delimiter exceeds the limit")
  let count = 0
  const depths = new WeakMap()
  try {
    return luaparse.parse(Buffer.from(source).toString("latin1"), {
      luaVersion: "5.1",
      encodingMode: "pseudo-latin1",
      comments: false,
      locations: true,
      onCreateNode(node) {
        if (++count > 8192) throw new LuaFault("ParseError", "Lua syntax tree exceeds the size limit")
        let depth = 1
        for (const child of Object.values(node)) {
          if (Array.isArray(child)) {
            for (const item of child) depth = Math.max(depth, 1 + (depths.get(item) ?? 0))
          } else depth = Math.max(depth, 1 + (depths.get(child) ?? 0))
        }
        if (depth > depthLimit) throw new LuaFault("ParseError", "Lua syntax nesting exceeds the depth limit")
        depths.set(node, depth)
      },
    })
  } catch (e) {
    if (e instanceof LuaFault) throw e
    if (e instanceof RangeError) throw new LuaFault("ParseError", "Lua syntax nesting exceeds the depth limit")
    throw new LuaFault(
      "ParseError",
      e.message.slice(0, 512),
      e.line ? { line: e.line, column: e.column + 1 } : undefined,
    )
  }
}

class Table {
  data = new Map()
  constructor(vm, array = false) {
    vm.charge(8)
    this.vm = vm
    this.array = array
  }
  get(key) {
    this.vm.key(key)
    return this.data.get(key)
  }
  set(key, value) {
    this.vm.key(key)
    if (key === undefined || Number.isNaN(key)) throw failure("Invalid Lua table key")
    if (this.locked) throw failure("Cannot change a read-only Lua table")
    if (value === undefined) return this.data.delete(key)
    if (this.data.size >= entriesLimit && !this.data.has(key)) throw limit("Lua table exceeds the entry limit")
    this.vm.charge(4)
    this.data.set(key, value)
  }
}

class Closure {
  constructor(proto, scope) {
    this.proto = proto
    this.scope = scope
  }
}
class Host {
  constructor(path) {
    this.path = path
  }
}
class Native {
  constructor(run) {
    this.run = run
  }
}

class LuaHostFailure {
  constructor(message) {
    this.message = message
  }
}
export function hostFailure(message) {
  return new LuaHostFailure(message)
}

// Account for JSON escaping as well as UTF-8: a control byte can expand to
// six ASCII bytes. One request shares its budget across all its arguments.
class Boundary {
  bytes = 1024 * 1024
  constructor(vm) {
    this.vm = vm
  }
  charge(n) {
    this.bytes -= n
    if (this.bytes < 0) throw new LuaFault("InvalidDataValue", "Lua JSON exceeds the boundary byte limit")
    // Core progress can retain each admitted call's input. Charge every copy,
    // even when the guest reuses the very same value or callable path.
    this.vm.traffic -= n
    if (this.vm.traffic < 0) throw limit("Lua cumulative host traffic limit exceeded")
  }
  string(value) {
    this.charge(Buffer.byteLength(JSON.stringify(value)))
  }
}

function type(v) {
  if (v === undefined) return "nil"
  if (v === jsonNull) return "userdata"
  if (v instanceof Table) return "table"
  if (v instanceof Closure || v instanceof Native || v instanceof Host) return "function"
  return typeof v
}

function text(v) {
  if (v === jsonNull) return "null"
  if (["number", "string", "boolean"].includes(typeof v)) return String(v)
  return type(v)
}

function string(v) {
  if (typeof v !== "string" && typeof v !== "number") throw failure("Expected a Lua string or number")
  return String(v)
}

function table(v) {
  if (!(v instanceof Table)) throw failure("Expected a Lua table")
  return v
}

class Sandbox {
  fuel = 500_000
  slice = 256
  nativeFuel = Infinity
  bytes = 8 * 1024 * 1024
  traffic = 4 * 1024 * 1024
  frameLimit = 96
  globals = new Table(this)
  protected = new Set()
  frames = []
  barriers = 0
  charge(work) {
    this.fuel -= work
    this.slice -= work
    this.nativeFuel -= work
    if (this.nativeFuel < 0) throw limit("Lua native call work limit exceeded")
    if (this.fuel < 0) throw limit("Lua execution work limit exceeded")
  }
  poll(node) {
    this.node = node ?? this.node
    this.charge(1)
    if (this.slice > 0) return false
    this.slice = 256
    return true
  }
  // Charge before materializing a string, including in JS-native operations.
  size(length) {
    if (!Number.isSafeInteger(length) || length < 0 || length > stringLimit)
      throw limit("Lua string exceeds the size limit")
    this.bytes -= length
    if (this.bytes < 0) throw limit("Lua allocation limit exceeded")
    this.charge(1 + Math.ceil(length / 32))
  }
  key(key) {
    this.charge(typeof key === "string" ? 1 + Math.ceil(key.length / 32) : 1)
  }
  number(v) {
    if (typeof v === "number") return v
    if (typeof v !== "string") return undefined
    this.key(v)
    const trimmed = v.trim()
    if (!/^[+-]?(?:0[xX][\da-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.test(trimmed)) return undefined
    if (/^[+-]0[xX]/.test(trimmed)) return (trimmed[0] === "-" ? -1 : 1) * Number(trimmed.slice(1))
    return Number(trimmed)
  }
  numeric(v) {
    const n = this.number(v)
    if (n === undefined) throw failure("Expected a Lua number")
    return n
  }
  length(v) {
    if (typeof v === "string") return v.length
    const seq = table(v)
    let i = 0
    while (seq.get(i + 1) !== undefined) i++
    return i
  }
  ops = {
    truthy,
    error: failure,
    stackOverflow: () => limit("Lua stack overflow"),
    table: () => new Table(this),
    closure: (proto, scope) => new Closure(proto, scope),
    number: (v) => this.number(v),
    len: (v) => this.length(v),
    index: (v, k) => {
      if (v instanceof Table) return v.get(k)
      if (typeof v === "string") return this.strings.get(k)
      if (v instanceof Host && v.path[0] === "tools" && typeof k === "string") {
        if (v.path.length >= 32 || k.length > 256) throw limit("Lua tool path exceeds the size limit")
        this.charge(v.path.length)
        return new Host([...v.path, this.decode(k)])
      }
      throw failure(`Cannot index Lua ${type(v)}`)
    },
    newindex: (v, k, value) => {
      if (v === this.globals && this.protected.has(k)) throw failure("Cannot overwrite a reserved Lua global")
      table(v).set(k, value)
    },
    compare: (op, a, b) => {
      this.key(a)
      this.key(b)
      if (op === "eq") return a === b
      if (typeof a !== typeof b || (typeof a !== "number" && typeof a !== "string"))
        throw failure("Incompatible Lua comparison")
      return op === "lt" ? a < b : a <= b
    },
    concat: (a, b) => {
      const left = string(a),
        right = string(b)
      this.size(left.length + right.length)
      return left + right
    },
    arith: (op, a, b) => {
      const x = this.numeric(a),
        y = this.numeric(b)
      switch (op) {
        case "unm":
          return -x
        case "add":
          return x + y
        case "sub":
          return x - y
        case "mul":
          return x * y
        case "div":
          return x / y
        case "pow":
          return x ** y
        case "mod":
          return x - Math.floor(x / y) * y
        default:
          throw failure("Unknown arithmetic operator")
      }
    },
  }
  isClosure(fn) {
    return fn instanceof Closure
  }
  resolveCall(call) {
    this.charge(1 + call.args.length)
    if (call.args.length > 1024) throw limit("Lua call argument limit exceeded")
    return call
  }
  *iterate(fn, args) {
    return yield new Call(fn, args)
  }
  *native(fn, args) {
    if (fn === this.pcall) {
      // A second trampoline shares the same frame stack and all budgets.
      // Bound nested protection separately: even pcall(pcall, ...) with no
      // Lua activations uses another JS generator delegation.
      if (this.barriers >= 24) throw limit("Lua protected call depth limit exceeded")
      this.barriers++
      const base = this.frames.length
      try {
        const result = yield* runFrames(this, this.frames, new Call(args[0], args.slice(1)))
        this.charge(result.length + 1)
        return [true, ...result]
      } catch (e) {
        if (!(e instanceof LuaFault) || !e.catchable) throw e
        return [false, Object.hasOwn(e, "value") ? e.value : this.encode(e.message)]
      } finally {
        this.barriers--
        this.frames.length = base
      }
    }
    if (fn instanceof Native) {
      // These synchronous allowlisted functions never call back into Lua.
      // Individually bounded inputs can still multiply (e.g. 1,024 large
      // numeric strings supplied to math.max) inside a single scheduler step.
      this.nativeFuel = 32768
      try {
        return fn.run(args)
      } finally {
        this.nativeFuel = Infinity
      }
    }
    if (!(fn instanceof Host)) throw failure(`Cannot call Lua ${type(fn)}`)
    // Even empty calls cause host admission and progress bookkeeping.
    this.charge(256)
    const data = []
    const budget = new Boundary(this)
    budget.charge(2 + Math.max(0, args.length - 1) + 2 + Math.max(0, fn.path.length - 1))
    for (const name of fn.path) budget.string(name)
    for (const arg of args) data.push(yield* this.export(arg, new Set(), 0, budget))
    const reply = yield { type: "call", path: fn.path.slice(), args: data, protected: this.barriers > 0 }
    const inbound = new Boundary(this)
    if (reply instanceof LuaHostFailure) {
      inbound.string(reply.message)
      throw failure(reply.message)
    }
    return [yield* this.import(reply, 0, inbound)]
  }
  encode(s) {
    if (s.length > stringLimit) throw limit("Lua string exceeds the size limit")
    if (!s.isWellFormed()) throw invalid("Lua input must be valid Unicode")
    this.size(Buffer.byteLength(s))
    return Buffer.from(s).toString("latin1")
  }
  decode(s) {
    this.size(s.length)
    try {
      return utf8.decode(Buffer.from(s, "latin1"))
    } catch {
      throw invalid("Lua byte string is not valid UTF-8")
    }
  }
  *import(v, depth, budget) {
    if (this.poll()) yield checkpoint
    if (depth > depthLimit) throw new LuaFault("InvalidDataValue", "Lua input exceeds the depth limit")
    if (v === undefined || v === null || typeof v === "boolean" || Number.isFinite(v)) {
      budget.charge(v === undefined ? 4 : String(v).length)
      return v === null ? jsonNull : v
    }
    if (typeof v === "string") {
      const value = this.encode(v)
      budget.string(v)
      return value
    }
    if (typeof v !== "object") throw invalid("Expected JSON data")
    const array = Array.isArray(v)
    const result = new Table(this, array)
    // The driver owns validating/canonicalizing host objects before it resumes
    // us. Never put the host container or function itself into the Lua heap.
    if (array) {
      if (v.length > entriesLimit) throw new LuaFault("InvalidDataValue", "Lua input exceeds the entry limit")
      budget.charge(2 + Math.max(0, v.length - 1))
      for (let i = 0; i < v.length; i++) result.set(i + 1, yield* this.import(v[i], depth + 1, budget))
    } else {
      budget.charge(2)
      for (const key in v) {
        if (!Object.hasOwn(v, key)) continue
        const name = this.encode(key)
        budget.string(key)
        budget.charge(result.data.size ? 2 : 1)
        result.set(name, yield* this.import(v[key], depth + 1, budget))
      }
    }
    return result
  }
  *export(v, seen, depth, budget) {
    if (this.poll()) yield checkpoint
    if (depth > 32) throw new LuaFault("InvalidDataValue", "Lua result exceeds the depth limit")
    if (v === undefined || v === jsonNull || typeof v === "boolean" || Number.isFinite(v)) {
      budget.charge(v === undefined || v === jsonNull ? 4 : String(v).length)
      return v === jsonNull ? null : v
    }
    if (typeof v === "string") {
      const value = this.decode(v)
      budget.string(value)
      return value
    }
    if (!(v instanceof Table)) throw invalid(`Cannot pass Lua ${type(v)} as JSON`)
    if (seen.has(v)) throw invalid("Circular Lua table cannot cross the JSON boundary")
    seen.add(v)
    const first = v.data.keys().next()
    const array = first.done ? v.array : typeof first.value === "number"
    const out = array ? [] : Object.create(null)
    budget.charge(2 + Math.max(0, v.data.size - 1))
    for (const [k, item] of v.data) {
      // Charge each expanded edge, not just unique VM tables. Never size a
      // JS array from a Lua index: sparse integer keys can be enormous.
      this.charge(16)
      if (array) {
        if (!Number.isSafeInteger(k) || k < 1 || k > v.data.size)
          throw invalid("Expected contiguous Lua array keys from 1")
        out[k - 1] = yield* this.export(item, seen, depth + 1, budget)
      } else {
        if (typeof k !== "string" || k === "__proto__") throw invalid("Invalid Lua JSON object key")
        const key = this.decode(k)
        budget.charge(1)
        budget.string(key)
        out[key] = yield* this.export(item, seen, depth + 1, budget)
      }
    }
    seen.delete(v)
    return out
  }
}

export const luaBuiltins = Object.freeze([
  "assert",
  "error",
  "type",
  "tostring",
  "tonumber",
  "pairs",
  "ipairs",
  "string",
  "table",
  "math",
  "json",
  "pcall",
])

function install(vm) {
  // Case conversion is ASCII-only on byte strings. Avoid a regex callback
  // and temporary match allocation for each individual byte.
  function changeCase(v, start, delta) {
    const s = string(v)
    vm.size(s.length)
    const bytes = Buffer.from(s, "latin1")
    for (let i = 0; i < bytes.length; i++) if (bytes[i] >= start && bytes[i] < start + 26) bytes[i] += delta
    return bytes.toString("latin1")
  }
  function raised(value) {
    // Rendering for diagnostics must not truncate a UTF-8 character into a
    // second error. Protected handlers get the original value, even nil.
    const e = failure(Buffer.from(text(value).slice(0, 512), "latin1").toString("utf8"))
    e.value = value
    return e
  }
  function library(methods) {
    const lib = new Table(vm)
    for (const [k, v] of Object.entries(methods)) lib.set(k, typeof v === "function" ? new Native(v) : v)
    lib.locked = true
    return lib
  }
  const base = {
    type: ([v]) => [type(v)],
    tostring: ([v]) => [text(v)],
    tonumber: ([v, radix]) => {
      if (radix !== undefined && radix !== 10) throw failure("Only base 10 tonumber is supported")
      return [vm.number(v)]
    },
    assert: (args) => {
      if (!truthy(args[0])) throw raised(args[1] ?? "assertion failed!")
      return args
    },
    error: ([value]) => {
      throw raised(value)
    },
    pairs: ([v]) => {
      const seq = table(v)
      vm.charge(seq.data.size)
      // Iterating a live JS Map across arbitrary guest mutations can retain
      // its deleted slots. Snapshot at most entriesLimit keys and skip deletes.
      const keys = [...seq.data.keys()]
      let i = 0
      return [
        new Native(() => {
          while (i < keys.length) {
            const key = keys[i++]
            const value = seq.get(key)
            if (value !== undefined) return [key, value]
          }
          return []
        }),
        v,
      ]
    },
    ipairs: ([v]) => {
      const seq = table(v)
      return [
        new Native(([, i]) => {
          const key = vm.numeric(i) + 1
          const value = seq.get(key)
          return value === undefined ? [] : [key, value]
        }),
        seq,
        0,
      ]
    },
  }
  for (const [name, fn] of Object.entries(base)) vm.globals.set(name, new Native(fn))
  vm.pcall = new Native()
  vm.globals.set("pcall", vm.pcall)
  vm.strings = library({
    len: ([v]) => [string(v).length],
    sub: ([v, start, end = -1]) => {
      const s = string(v)
      const pos = (v) => {
        const n = Math.trunc(vm.numeric(v))
        return n < 0 ? s.length + n + 1 : n
      }
      const i = Math.max(1, pos(start)),
        j = Math.min(s.length, pos(end))
      vm.size(Math.max(0, j - i + 1))
      return [s.slice(i - 1, Math.max(0, j))]
    },
    rep: ([v, count]) => {
      const s = string(v),
        n = Math.max(0, Math.trunc(vm.numeric(count)))
      vm.size(s.length * n)
      return [s.length ? s.repeat(n) : ""]
    },
    lower: ([v]) => [changeCase(v, 65, 32)],
    upper: ([v]) => [changeCase(v, 97, -32)],
    // Deliberately no Lua patterns, regex translation or printf formatting.
  })
  vm.globals.set("string", vm.strings)
  vm.globals.set(
    "table",
    library({
      insert: ([v, ...args]) => {
        if (args.length !== 1) throw failure("Only table.insert(table, value) is supported")
        table(v).set(vm.length(v) + 1, args[0])
        return []
      },
      concat: ([v, sep = "", first = 1, last]) => {
        const seq = table(v),
          delimiter = string(sep)
        const i = vm.numeric(first),
          j = last === undefined ? vm.length(v) : vm.numeric(last)
        if (!Number.isSafeInteger(i) || !Number.isSafeInteger(j) || j - i >= entriesLimit)
          throw limit("Invalid table.concat range")
        const parts = []
        let length = 0
        for (let k = i; k <= j; k++) {
          const part = string(seq.get(k))
          length += part.length + (parts.length ? delimiter.length : 0)
          if (length > stringLimit) throw limit("Lua string exceeds the size limit")
          parts.push(part)
        }
        vm.size(length)
        return [parts.join(delimiter)]
      },
    }),
  )
  vm.globals.set(
    "json",
    library({
      array: (args) => {
        if (args.length) throw failure("json.array() takes no arguments")
        return [new Table(vm, true)]
      },
      null: jsonNull,
    }),
  )
  vm.globals.set(
    "math",
    library({
      ...Object.fromEntries(["abs", "ceil", "floor", "sqrt"].map((k) => [k, ([v]) => [Math[k](vm.numeric(v))]])),
      min: (args) => [Math.min(...args.map((v) => vm.numeric(v)))],
      max: (args) => [Math.max(...args.map((v) => vm.numeric(v)))],
      pi: Math.PI,
      huge: Infinity,
    }),
  )
  for (const k of luaBuiltins) vm.protected.add(k)
}

export function* evaluateLua(source, options) {
  const proto = parse(source)
  const vm = new Sandbox()
  install(vm)
  function global(name, value) {
    if (vm.protected.has(name)) throw failure("Duplicate or reserved Lua global")
    vm.globals.set(name, value)
    vm.protected.add(name)
  }
  // Only 'tools' is an extensible namespace. Every other host function must
  // be explicitly admitted, and indexing it cannot manufacture capabilities.
  for (const path of options.paths) {
    if (path.length !== 1) throw failure("Expected a top-level Lua capability name")
    global(vm.encode(path[0]), new Host([path[0]]))
  }
  const program = new Closure(proto, null)
  program.env = vm.globals
  const run = (function* () {
    const budget = new Boundary(vm)
    for (const name of Object.keys(options.bindings ?? {})) {
      const key = vm.encode(name)
      budget.string(name)
      global(key, yield* vm.import(options.bindings[name], 0, budget))
    }
    const values = yield* runFrames(vm, vm.frames, new Call(program, []))
    return yield* vm.export(values[0], new Set(), 0, new Boundary(vm))
  })()
  try {
    let step = run.next()
    while (!step.done) step = run.next(yield step.value === checkpoint ? tick : step.value)
    return step.value
  } catch (e) {
    if (e instanceof LuaFault && !e.location && vm.node) {
      const loc = vm.node.loc.start
      e.location = { line: loc.line, column: loc.column + 1 }
    }
    throw e
  } finally {
    run.return()
  }
}

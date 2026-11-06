import { typeName, withRuntime } from "v8lua/src/runtime.js"
import { install } from "./library.js"
import { VM } from "./vm.js"

// v8lua's operators call this when a metamethod is a Lua closure. Such calls
// are synchronous (non-yieldable) in 5.1, just like native library callbacks.
function* callback(fn, args) {
  return fn.interp.atomic(fn.interp.invoke(fn, args))
}

/** Run a fresh Lua chunk. Lua strings are byte strings; nil maps to null. */
export function runLua(source) {
  if (typeof source !== "string") throw new TypeError("Lua source must be a string")
  const vm = new VM()
  return withRuntime(vm, callback, () => {
    install(vm)
    const values = vm.atomic(vm.invoke(vm.compile(source, "=(lua)"), []))
    return values.map((value) => {
      if (value === undefined) return null
      if (["boolean", "string", "number"].includes(typeof value)) return value
      throw new TypeError(`cannot return Lua ${typeName(value)} to JavaScript`)
    })
  })
}

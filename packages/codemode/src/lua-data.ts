import { Buffer } from "node:buffer"
import { isProxy } from "node:util/types"
import type { Json } from "./data.js"

// Bound the expanded tree, not just distinct JS objects. A tiny DAG can otherwise
// become gigabytes during schema decoding, Lua table construction, or stringify.
const maxNodes = 32_768
const maxBytes = 1_048_576
const maxDepth = 32

export class LuaDataError extends Error {}
export class LuaDataLimit extends LuaDataError {}

export function isLuaDataLimit(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    !isProxy(error) &&
    Object.getPrototypeOf(error) === LuaDataLimit.prototype
  )
}

export function copyLuaData(input: unknown): Json | undefined {
  if (input === undefined) return undefined // a void host call, not a nested JSON value
  const active = new Set<object>()
  let nodes = 0
  let bytes = 0

  function charge(size: number) {
    bytes += size
    if (bytes > maxBytes) throw new LuaDataLimit("Lua data exceeds the byte limit.")
  }

  function string(text: string) {
    // Reject huge host strings before encoding. JSON escaping (including lone
    // surrogates) counts against the same limit as literal UTF-8 bytes.
    if (text.length + bytes + 2 > maxBytes) throw new LuaDataLimit("Lua data exceeds the byte limit.")
    // The VM uses UTF-8 byte strings. Replacing a lone surrogate could silently
    // merge two distinct JSON keys into the same Lua table entry.
    if (!text.isWellFormed()) throw new LuaDataError("Lua JSON strings must contain valid Unicode.")
    charge(Buffer.byteLength(JSON.stringify(text)))
  }

  function copy(value: unknown, depth: number): Json {
    if (++nodes > maxNodes) throw new LuaDataLimit("Lua data exceeds the node limit.")
    if (depth > maxDepth) throw new LuaDataLimit("Lua data exceeds the nesting limit.")
    if (typeof value === "string") {
      string(value)
      return value
    }
    if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      charge(String(value).length)
      return value === 0 ? 0 : value
    }
    if (typeof value !== "object" || isProxy(value)) throw new LuaDataError("Expected plain JSON data.")
    if (active.has(value)) throw new LuaDataError("Cyclic Lua data.")
    active.add(value)
    const array = Array.isArray(value)
    const proto = Object.getPrototypeOf(value)
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      throw new LuaDataError("Expected a plain JSON array or record.")
    if (array && value.length > maxNodes - nodes) throw new LuaDataLimit("Lua data exceeds the node limit.")
    // oxlint-disable-next-line no-restricted-globals -- reject symbol/nonenumerable keys without invoking getters.
    const keys = Reflect.ownKeys(value)
    const count = keys.length - Number(array)
    if (count > maxNodes - nodes) throw new LuaDataLimit("Lua data exceeds the node limit.")
    if (array && count !== value.length) throw new LuaDataError("Expected a dense JSON array.")
    charge(2 + Math.max(0, count - 1))
    const items: Array<Json> = []
    const record: Record<string, Json> = Object.create(null)
    for (const key of keys) {
      if (array && key === "length") continue
      if (typeof key !== "string" || (array && key !== String(items.length)))
        throw new LuaDataError("Expected JSON data keys.")
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value"))
        throw new LuaDataError("Expected enumerable JSON data properties, not accessors.")
      if (!array) {
        string(key)
        charge(1)
      }
      const child = copy(descriptor.value, depth + 1)
      if (array) items.push(child)
      else record[key] = child
    }
    active.delete(value)
    return array ? items : record
  }

  return copy(input, 0)
}

/** Never format the host's arbitrary thrown object (toString, getters or proxy traps). */
export function luaErrorMessage(error: unknown, fallback = "Host call failed."): string {
  if (typeof error === "string") return error.slice(0, 2048)
  if (error === null || typeof error !== "object" || isProxy(error)) return fallback
  const message: unknown = Object.getOwnPropertyDescriptor(error, "message")?.value
  return typeof message === "string" ? message.slice(0, 2048) : fallback
}

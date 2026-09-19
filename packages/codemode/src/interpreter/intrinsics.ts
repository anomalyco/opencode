import { Effect } from "effect"
import { define, hidden, Native, Arr, ErrorObj, Obj } from "./objects.js"

export const errorTypes = [
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
] as const

export type ErrorType = (typeof errorTypes)[number]

export const isErrorType = (name: string): name is ErrorType => (errorTypes as ReadonlyArray<string>).includes(name)

const builtins = [
  "Object",
  "Function",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Date",
  "RegExp",
  "Map",
  "Set",
  "URL",
  "URLSearchParams",
  "Headers",
  "Uint8Array",
  "TextEncoder",
  "TextDecoder",
  "Promise",
  "Iterator",
  "AsyncIterator",
  "Generator",
  "AsyncGenerator",
] as const

/**
 * The built-in prototype objects of one runtime, allocated empty in dependency order. The globals populate them
 * and attach their constructors when the runtime is built.
 */
export type Builtins = Readonly<Record<(typeof builtins)[number] | ErrorType, Obj>>

export const createErrorValue = (prototype: Obj, message: string | undefined): ErrorObj => {
  const value = new ErrorObj(prototype)
  if (message !== undefined) define(value, "message", message, hidden)
  return value
}

export const createBuiltins = (): Builtins => {
  const object = new Obj(null)
  // Function.prototype is itself callable and returns undefined.
  const fn = new Native(object, { name: "", call: () => Effect.undefined })
  const plain = () => new Obj(object)
  const error = plain()
  define(error, "name", "Error", hidden)
  define(error, "message", "", hidden)
  const derived = (type: ErrorType) => {
    const proto = new Obj(error)
    define(proto, "name", type, hidden)
    define(proto, "message", "", hidden)
    return proto
  }
  const iterator = plain()
  const asyncIterator = plain()
  return {
    Object: object,
    Function: fn,
    Array: new Arr(object),
    String: plain(),
    Number: plain(),
    Boolean: plain(),
    Date: plain(),
    RegExp: plain(),
    Map: plain(),
    Set: plain(),
    URL: plain(),
    URLSearchParams: plain(),
    Headers: plain(),
    Uint8Array: plain(),
    TextEncoder: plain(),
    TextDecoder: plain(),
    Promise: plain(),
    Iterator: iterator,
    AsyncIterator: asyncIterator,
    Generator: new Obj(iterator),
    AsyncGenerator: new Obj(asyncIterator),
    Error: error,
    TypeError: derived("TypeError"),
    RangeError: derived("RangeError"),
    SyntaxError: derived("SyntaxError"),
    ReferenceError: derived("ReferenceError"),
    EvalError: derived("EvalError"),
    URIError: derived("URIError"),
    AggregateError: derived("AggregateError"),
  }
}

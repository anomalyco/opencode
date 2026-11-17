import { define, hidden, Native, Arr, ErrorObj, Obj, readonly, type Value } from "./objects.js"

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
  "WeakMap",
  "WeakSet",
  "URL",
  "URLSearchParams",
  "Headers",
  "Uint8Array",
  "Buffer",
  "TextEncoder",
  "TextDecoder",
  "Promise",
  "PromiseLike",
  "Iterator",
  "IteratorHelper",
  "AsyncIterator",
  "Generator",
  "AsyncGenerator",
  "AsyncFromSyncIterator",
  "GeneratorFunction",
  "AsyncGeneratorFunction",
  "AsyncFunction",
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

/** The prototype a primitive reads its methods from without being boxed; none for null, undefined, and symbols. */
export const primitivePrototype = (builtins: Builtins, value: Value): Obj | undefined => {
  if (typeof value === "string") return builtins.String
  if (typeof value === "number") return builtins.Number
  if (typeof value === "boolean") return builtins.Boolean
  return undefined
}

export const createBuiltins = (): Builtins => {
  const object = new Obj(null)
  // Function.prototype is itself callable and returns undefined.
  const fn = new Native(object, { name: "", call: () => undefined })
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
  const uint8Array = plain()
  const generator = new Obj(iterator)
  const asyncGenerator = new Obj(asyncIterator)
  // What generator and async functions inherit: plain objects, not callable, linked to the prototype of what they make.
  const functionKind = (made?: Obj) => {
    const proto = new Obj(fn)
    if (made === undefined) return proto
    define(proto, "prototype", made, readonly)
    define(made, "constructor", proto, readonly)
    return proto
  }
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
    WeakMap: plain(),
    WeakSet: plain(),
    URL: plain(),
    URLSearchParams: plain(),
    Headers: plain(),
    Uint8Array: uint8Array,
    /** Node's Buffer: a Uint8Array whose text conversions default to UTF-8. */
    Buffer: new Obj(uint8Array),
    TextEncoder: plain(),
    TextDecoder: plain(),
    Promise: plain(),
    /** What a synchronous result that can also be awaited inherits: then/catch/finally over a plain copy. */
    PromiseLike: plain(),
    Iterator: iterator,
    IteratorHelper: new Obj(iterator),
    AsyncIterator: asyncIterator,
    Generator: generator,
    AsyncGenerator: asyncGenerator,
    /** CreateAsyncFromSyncIterator's objects; programs never see them. */
    AsyncFromSyncIterator: new Obj(asyncIterator),
    GeneratorFunction: functionKind(generator),
    AsyncGeneratorFunction: functionKind(asyncGenerator),
    AsyncFunction: functionKind(),
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

import { Effect } from "effect"
import {
  type AstNode,
  CodeModeFunction,
  CoercionFunction,
  ErrorConstructorReference,
  GlobalMethodReference,
  GlobalNamespace,
  IntrinsicReference,
  InterpreterRuntimeError,
  PromiseCapabilityFunction,
  PromiseNamespace,
  UriFunction,
} from "./model.js"
import { rejectCircularInsertion, typeofValue } from "./references.js"
import { isBlockedMember, type SafeObject } from "../tool-runtime.js"
import {
  CodeModeDate,
  CodeModeMap,
  CodeModePromise,
  CodeModeRegExp,
  CodeModeSet,
  CodeModeURL,
  CodeModeURLSearchParams,
} from "../values.js"
import { invokeDateMethod, invokeDateStatic } from "../stdlib/date.js"
import { invokeJsonMethod } from "../stdlib/json.js"
import { invokeMathMethod } from "../stdlib/math.js"
import { invokeNumberMethod, invokeNumberStatic } from "../stdlib/number.js"
import { invokeObjectMethod } from "../stdlib/object.js"
import { invokeRegExpMethod, matchToValue, toHostRegex } from "../stdlib/regexp.js"
import { invokeStringStatic } from "../stdlib/string.js"
import { invokeURLMethod, invokeURLStatic, uriArgument } from "../stdlib/url.js"
import { boundedData, coerceToNumber, coerceToString, errorBrandName } from "../stdlib/value.js"

export type CallbackRunner<R> = {
  readonly invokeFunction: (fn: CodeModeFunction, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>
  readonly invokeCallable: (
    callable: unknown,
    args: Array<unknown>,
    node: AstNode,
  ) => Effect.Effect<unknown, unknown, R>
  readonly settlePromise: (promise: CodeModePromise) => Effect.Effect<unknown, unknown, never>
}

// The single acceptance list for callbacks: collections, sort, string replacers,
// Array.from mappers, and promise reactions all admit exactly these callables.
// Admission means dispatchable, not necessarily invocable: new-requiring
// constructors pass the gate and throw a TypeError on call, like JS.
export type SupportedCallback =
  | CodeModeFunction
  | CoercionFunction
  | UriFunction
  | PromiseCapabilityFunction
  | GlobalMethodReference
  | IntrinsicReference
  | ErrorConstructorReference
  | GlobalNamespace
  | PromiseNamespace

export const isSupportedCallback = (value: unknown): value is SupportedCallback =>
  value instanceof CodeModeFunction ||
  value instanceof CoercionFunction ||
  value instanceof UriFunction ||
  value instanceof PromiseCapabilityFunction ||
  value instanceof GlobalMethodReference ||
  value instanceof IntrinsicReference ||
  value instanceof ErrorConstructorReference ||
  // Callable namespaces dispatch like JS: Array/Object/Date/RegExp construct,
  // new-requiring constructors throw a TypeError. Math/JSON/console stay non-callable.
  (value instanceof GlobalNamespace && typeofValue(value) === "function") ||
  value instanceof PromiseNamespace

export const invokeIntrinsic = <R>(
  runner: CallbackRunner<R>,
  ref: IntrinsicReference,
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<unknown, unknown, R> => {
  if (typeof ref.receiver === "string") {
    if (ref.name === "replace" || ref.name === "replaceAll") {
      if (isSupportedCallback(args[1])) return invokeStringReplacer(runner, ref.receiver, ref.name, args, node)
      if (typeofValue(args[1]) === "function") {
        throw new InterpreterRuntimeError(
          `String.${ref.name} cannot use this callable as a replacer; wrap it in an arrow function, e.g. (match) => tools.ns.tool(match).`,
          node,
        )
      }
    }
    return Effect.succeed(invokeStringMethod(ref.receiver, ref.name, args, node))
  }
  if (typeof ref.receiver === "number") {
    return Effect.succeed(invokeNumberMethod(ref.receiver, ref.name, args, node))
  }
  if (Array.isArray(ref.receiver)) {
    return invokeArrayMethod(runner, ref.receiver, ref.name, args, node)
  }
  if (ref.receiver instanceof CodeModeDate) {
    return Effect.succeed(invokeDateMethod(ref.receiver, ref.name, node))
  }
  if (ref.receiver instanceof CodeModeRegExp) {
    return Effect.succeed(invokeRegExpMethod(ref.receiver, ref.name, args, node))
  }
  if (ref.receiver instanceof CodeModeMap) {
    return invokeMapMethod(runner, ref.receiver, ref.name, args, node)
  }
  if (ref.receiver instanceof CodeModeSet) {
    return invokeSetMethod(runner, ref.receiver, ref.name, args, node)
  }
  if (ref.receiver instanceof CodeModeURL) {
    return Effect.succeed(invokeURLMethod(ref.receiver, ref.name, node))
  }
  if (ref.receiver instanceof CodeModeURLSearchParams) {
    return invokeURLSearchParamsMethod(runner, ref.receiver, ref.name, args, node)
  }
  throw new InterpreterRuntimeError(`Method '${ref.name}' is not available in CodeMode.`, node)
}

export const invokeGlobalMethod = (ref: GlobalMethodReference, args: Array<unknown>, node: AstNode): unknown => {
  if (ref.namespace === "console")
    throw new InterpreterRuntimeError(`console.${ref.name} is not available in CodeMode.`, node)
  if (ref.namespace === "Object") return invokeObjectMethod(ref.name, args, node)
  if (ref.namespace === "Math") return invokeMathMethod(ref.name, args, node)
  if (ref.namespace === "Array") return invokeArrayStatic(ref.name, args, node)
  if (ref.namespace === "Number") return invokeNumberStatic(ref.name, args, node)
  if (ref.namespace === "String") return invokeStringStatic(ref.name, args, node)
  if (ref.namespace === "URL") return invokeURLStatic(ref.name, args, node)
  if (ref.namespace === "Date") return invokeDateStatic(ref.name, args, node)
  if (
    ref.namespace === "RegExp" ||
    ref.namespace === "Map" ||
    ref.namespace === "Set" ||
    ref.namespace === "URLSearchParams"
  ) {
    throw new InterpreterRuntimeError(`${ref.namespace}.${ref.name} is not available in CodeMode.`, node)
  }
  return invokeJsonMethod(ref.name, args, node)
}

const invokeStringMethod = (value: string, name: string, args: Array<unknown>, node: AstNode): unknown => {
  const str = (index: number): string => {
    const arg = args[index]
    if (typeof arg !== "string")
      throw new InterpreterRuntimeError(`String.${name} expects argument ${index + 1} to be a string.`, node)
    return arg
  }
  const num = (index: number): number => {
    const arg = args[index]
    if (typeof arg !== "number")
      throw new InterpreterRuntimeError(`String.${name} expects argument ${index + 1} to be a number.`, node)
    return arg
  }
  const optNum = (index: number): number | undefined => (args[index] === undefined ? undefined : num(index))
  const optStr = (index: number): string | undefined => (args[index] === undefined ? undefined : str(index))

  let result: unknown
  switch (name) {
    case "toLowerCase":
      result = value.toLowerCase()
      break
    case "toUpperCase":
      result = value.toUpperCase()
      break
    case "trim":
      result = value.trim()
      break
    case "trimStart":
      result = value.trimStart()
      break
    case "trimEnd":
      result = value.trimEnd()
      break
    // Locale/options are deliberately unsupported; comparison uses the host default locale.
    case "localeCompare":
      result = value.localeCompare(str(0))
      break
    case "normalize": {
      const form = optStr(0)
      try {
        result = value.normalize(form)
      } catch {
        throw new InterpreterRuntimeError(
          `String.normalize expects the form "NFC", "NFD", "NFKC", or "NFKD" (got ${JSON.stringify(form)}).`,
          node,
        ).as("RangeError")
      }
      break
    }
    case "split": {
      if (args.length === 0) {
        result = [value]
        break
      }
      if (args[0] instanceof CodeModeRegExp) {
        result = value.split(args[0].regex, optNum(1))
        break
      }
      const requestedLimit = optNum(1)
      result = value.split(str(0), requestedLimit === undefined ? undefined : requestedLimit >>> 0)
      break
    }
    case "slice":
      result = value.slice(optNum(0), optNum(1))
      break
    case "includes":
      result = value.includes(str(0), optNum(1))
      break
    case "startsWith":
      result = value.startsWith(str(0), optNum(1))
      break
    case "endsWith":
      result = value.endsWith(str(0), optNum(1))
      break
    case "indexOf":
      result = value.indexOf(str(0), optNum(1))
      break
    case "lastIndexOf":
      result = value.lastIndexOf(str(0), optNum(1))
      break
    case "replace":
    case "replaceAll": {
      if (args[0] instanceof CodeModeRegExp) {
        const pattern = args[0].regex
        const replacement = str(1)
        if (name === "replaceAll" && !pattern.global) {
          throw new InterpreterRuntimeError(
            `String.replaceAll requires a regular expression with the global (g) flag: write /${pattern.source}/${pattern.flags}g, or use String.replace to replace only the first match.`,
            node,
          )
        }
        result = name === "replace" ? value.replace(pattern, replacement) : value.replaceAll(pattern, replacement)
        break
      }
      if (name === "replace") {
        result = value.replace(str(0), str(1))
        break
      }
      result = value.replaceAll(str(0), str(1))
      break
    }
    case "match": {
      const pattern = toHostRegex(args[0], name, node)
      const matched = value.match(pattern)
      if (matched === null) return null
      // Preserve the own `index` and `groups` properties on non-global matches.
      if (pattern.global) return boundedData(matched, "String.match result")
      return matchToValue(matched)
    }
    case "matchAll": {
      const pattern = toHostRegex(args[0], name, node, "g")
      if (!pattern.global) {
        throw new InterpreterRuntimeError(
          `String.matchAll requires a regular expression with the global (g) flag: write /${pattern.source}/${pattern.flags}g, or use String.match for a single match.`,
          node,
        )
      }
      return Array.from(value.matchAll(pattern), matchToValue)
    }
    case "search": {
      result = value.search(toHostRegex(args[0], name, node))
      break
    }
    case "repeat": {
      const count = num(0)
      if (!Number.isFinite(count) || count < 0)
        throw new InterpreterRuntimeError("String.repeat expects a finite non-negative count.", node)
      result = value.repeat(count)
      break
    }
    case "padStart":
      result = value.padStart(num(0), optStr(1))
      break
    case "padEnd":
      result = value.padEnd(num(0), optStr(1))
      break
    case "charAt":
      result = value.charAt(optNum(0) ?? 0)
      break
    case "at":
      result = value.at(optNum(0) ?? 0)
      break
    case "substring":
      result = value.substring(optNum(0) ?? 0, optNum(1))
      break
    case "charCodeAt":
      result = value.charCodeAt(optNum(0) ?? 0)
      break
    case "codePointAt":
      result = value.codePointAt(optNum(0) ?? 0)
      break
    case "toString":
      result = value
      break
    case "concat": {
      result = value.concat(...args.map((_, index) => str(index)))
      break
    }
    default:
      throw new InterpreterRuntimeError(`String method '${name}' is not available in CodeMode.`, node)
  }
  return boundedData(result, `String.${name} result`)
}

const invokeArrayStatic = (name: string, args: Array<unknown>, node: AstNode): unknown => {
  switch (name) {
    case "isArray":
      return Array.isArray(args[0])
    case "of":
      return [...args]
    case "from":
      return arrayFromItems(args[0], node)
    default:
      throw new InterpreterRuntimeError(`Array.${name} is not available in CodeMode.`, node)
  }
}

const arrayFromItems = (source: unknown, node: AstNode): Array<unknown> => {
  if (source instanceof CodeModeMap) return Array.from(source.map.entries(), ([key, item]) => [key, item])
  if (source instanceof CodeModeSet) return Array.from(source.set.values())
  if (source instanceof CodeModeURLSearchParams) {
    return Array.from(source.params.entries(), ([key, value]) => [key, value])
  }
  if (source instanceof CodeModePromise) {
    throw new InterpreterRuntimeError(
      "Array.from received an un-awaited Promise; await it before creating the array.",
      node,
      "InvalidDataValue",
    )
  }
  if (typeof source === "string") return Array.from(source)
  if (Array.isArray(source)) return [...source]
  if (
    source !== null &&
    typeof source === "object" &&
    (Object.getPrototypeOf(source) === Object.prototype || Object.getPrototypeOf(source) === null) &&
    typeof (source as { length?: unknown }).length === "number"
  ) {
    return Array.from(source as ArrayLike<unknown>)
  }
  throw new InterpreterRuntimeError(
    "Array.from expects an array, string, Map, Set, or array-like value.",
    node,
    "InvalidDataValue",
  )
}

export const invokeArrayFrom = <R>(
  runner: CallbackRunner<R>,
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<unknown, unknown, R> => {
  const items = arrayFromItems(args[0], node)
  if (args.length < 2 || args[1] === undefined) return Effect.succeed(items)
  const apply = applyCollectionCallback(runner, args[1], "Array.from", node)
  return Effect.gen(function* () {
    const values: Array<unknown> = []
    for (let index = 0; index < items.length; index += 1) {
      values.push(yield* apply([items[index], index]))
    }
    return values
  })
}

const invokeStringReplacer = <R>(
  runner: CallbackRunner<R>,
  value: string,
  name: "replace" | "replaceAll",
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<unknown, unknown, R> => {
  const apply = applyCollectionCallback(runner, args[1], `String.${name}`, node)
  const matches: Array<{ readonly match: string; readonly offset: number; readonly args: Array<unknown> }> = []
  const collect = (...callbackArgs: Array<unknown>): string => {
    const match = callbackArgs[0]
    const groups = callbackArgs[callbackArgs.length - 1]
    const hasGroups = groups !== null && typeof groups === "object"
    const offset = callbackArgs[callbackArgs.length - (hasGroups ? 3 : 2)]
    if (typeof match !== "string" || typeof offset !== "number") {
      throw new InterpreterRuntimeError(`String.${name} produced an invalid replacement match.`, node)
    }
    if (hasGroups) {
      const safeGroups: SafeObject = Object.create(null) as SafeObject
      for (const [key, group] of Object.entries(groups)) {
        if (!isBlockedMember(key)) safeGroups[key] = group
      }
      callbackArgs[callbackArgs.length - 1] = safeGroups
    }
    matches.push({ match, offset, args: callbackArgs })
    return match
  }

  const pattern = args[0]
  if (pattern instanceof CodeModeRegExp) {
    if (name === "replaceAll" && !pattern.regex.global) {
      throw new InterpreterRuntimeError(
        `String.replaceAll requires a regular expression with the global (g) flag: write /${pattern.regex.source}/${pattern.regex.flags}g, or use String.replace to replace only the first match.`,
        node,
      )
    }
    if (name === "replace") value.replace(pattern.regex, collect)
    else value.replaceAll(pattern.regex, collect)
  } else {
    if (typeof pattern !== "string") {
      throw new InterpreterRuntimeError(`String.${name} expects argument 1 to be a string.`, node)
    }
    if (name === "replace") value.replace(pattern, collect)
    else value.replaceAll(pattern, collect)
  }

  return Effect.gen(function* () {
    const output: Array<string> = []
    let end = 0
    for (const match of matches) {
      const replacement = yield* apply(match.args)
      const resolved =
        args[1] instanceof CodeModeFunction && args[1].async && replacement instanceof CodeModePromise
          ? yield* runner.settlePromise(replacement)
          : replacement
      // Error values are branded plain objects; boundedData would strip the brand before coercion.
      output.push(
        value.slice(end, match.offset),
        errorBrandName(resolved)
          ? coerceToString(resolved)
          : coerceToString(boundedData(resolved, `String.${name} replacer result`)),
      )
      end = match.offset + match.match.length
    }
    output.push(value.slice(end))
    return boundedData(output.join(""), `String.${name} result`)
  })
}

export const applyCollectionCallback = <R>(
  runner: CallbackRunner<R>,
  callback: unknown,
  name: string,
  node: AstNode,
): ((args: Array<unknown>) => Effect.Effect<unknown, unknown, R>) => {
  if (!isSupportedCallback(callback)) {
    if (typeofValue(callback) === "function") {
      throw new InterpreterRuntimeError(
        `${name} cannot use this callable as a callback; wrap it in an arrow function, e.g. (value) => tools.ns.tool(value).`,
        node,
      )
    }
    throw new InterpreterRuntimeError(`${name} expects a function callback.`, node)
  }
  return (callbackArgs) => runner.invokeCallable(callback, callbackArgs, node)
}

const invokeMapMethod = <R>(
  runner: CallbackRunner<R>,
  target: CodeModeMap,
  name: string,
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<unknown, unknown, R> => {
  switch (name) {
    case "get":
      return Effect.succeed(target.map.get(args[0]))
    case "has":
      return Effect.succeed(target.map.has(args[0]))
    case "set":
      return Effect.sync(() => {
        target.map.set(args[0], args[1])
        return target
      })
    case "delete":
      return Effect.sync(() => target.map.delete(args[0]))
    case "clear":
      return Effect.sync(() => {
        target.map.clear()
        return undefined
      })
    case "keys":
      return Effect.sync(() => Array.from(target.map.keys()))
    case "values":
      return Effect.sync(() => Array.from(target.map.values()))
    case "entries":
      return Effect.sync(() => Array.from(target.map.entries(), ([key, item]): Array<unknown> => [key, item]))
    case "forEach": {
      const apply = applyCollectionCallback(runner, args[0], "Map.forEach", node)
      return Effect.gen(function* () {
        for (const [key, item] of Array.from(target.map.entries())) yield* apply([item, key, target])
        return undefined
      })
    }
    default:
      throw new InterpreterRuntimeError(`Map method '${name}' is not available in CodeMode.`, node)
  }
}

const invokeSetMethod = <R>(
  runner: CallbackRunner<R>,
  target: CodeModeSet,
  name: string,
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<unknown, unknown, R> => {
  switch (name) {
    case "has":
      return Effect.succeed(target.set.has(args[0]))
    case "add":
      return Effect.sync(() => {
        target.set.add(args[0])
        return target
      })
    case "delete":
      return Effect.sync(() => target.set.delete(args[0]))
    case "clear":
      return Effect.sync(() => {
        target.set.clear()
        return undefined
      })
    case "keys":
    case "values":
      return Effect.sync(() => Array.from(target.set.values()))
    case "entries":
      return Effect.sync(() => Array.from(target.set.values(), (item): Array<unknown> => [item, item]))
    case "forEach": {
      const apply = applyCollectionCallback(runner, args[0], "Set.forEach", node)
      return Effect.gen(function* () {
        for (const item of Array.from(target.set.values())) yield* apply([item, item, target])
        return undefined
      })
    }
    default:
      throw new InterpreterRuntimeError(`Set method '${name}' is not available in CodeMode.`, node)
  }
}

const invokeURLSearchParamsMethod = <R>(
  runner: CallbackRunner<R>,
  target: CodeModeURLSearchParams,
  name: string,
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<unknown, unknown, R> => {
  const arg = (index: number): string => uriArgument(args[index], `URLSearchParams.${name} argument ${index + 1}`)
  const requireArgs = (count: number): void => {
    if (args.length < count) {
      throw new InterpreterRuntimeError(
        `URLSearchParams.${name} requires ${count} argument${count === 1 ? "" : "s"}.`,
        node,
      ).as("TypeError")
    }
  }
  switch (name) {
    case "append": {
      requireArgs(2)
      return Effect.sync(() => {
        target.params.append(arg(0), arg(1))
        return undefined
      })
    }
    case "delete": {
      requireArgs(1)
      return Effect.sync(() => {
        if (args[1] !== undefined) target.params.delete(arg(0), arg(1))
        else target.params.delete(arg(0))
        return undefined
      })
    }
    case "get":
      requireArgs(1)
      return Effect.sync(() => target.params.get(arg(0)))
    case "getAll":
      requireArgs(1)
      return Effect.sync(() => target.params.getAll(arg(0)))
    case "has":
      requireArgs(1)
      return Effect.sync(() => (args[1] !== undefined ? target.params.has(arg(0), arg(1)) : target.params.has(arg(0))))
    case "set": {
      requireArgs(2)
      return Effect.sync(() => {
        target.params.set(arg(0), arg(1))
        return undefined
      })
    }
    case "sort":
      return Effect.sync(() => {
        target.params.sort()
        return undefined
      })
    case "keys":
      return Effect.sync(() => Array.from(target.params.keys()))
    case "values":
      return Effect.sync(() => Array.from(target.params.values()))
    case "entries":
      return Effect.sync(() => Array.from(target.params.entries(), ([key, value]): Array<unknown> => [key, value]))
    case "toString":
      return Effect.sync(() => target.params.toString())
    case "forEach": {
      requireArgs(1)
      const apply = applyCollectionCallback(runner, args[0], "URLSearchParams.forEach", node)
      return Effect.gen(function* () {
        for (const [key, value] of Array.from(target.params.entries())) yield* apply([value, key, target])
        return undefined
      })
    }
    default:
      throw new InterpreterRuntimeError(`URLSearchParams method '${name}' is not available in CodeMode.`, node)
  }
}

const invokeArrayMethod = <R>(
  runner: CallbackRunner<R>,
  target: Array<unknown>,
  name: string,
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<unknown, unknown, R> => {
  const optNumber = (value: unknown, label: string): number | undefined => {
    if (value === undefined) return undefined
    if (typeof value !== "number")
      throw new InterpreterRuntimeError(`Array.${name} expects ${label} to be a number.`, node)
    return value
  }
  switch (name) {
    case "join": {
      if (args.length > 1 || (args.length === 1 && typeof args[0] !== "string")) {
        throw new InterpreterRuntimeError("Array.join expects zero arguments or one string separator.", node)
      }
      const input = boundedData(target, "Array.join input") as Array<unknown>
      return Effect.succeed(
        input.map((item) => coerceToString(item ?? "")).join(args.length === 0 ? "," : (args[0] as string)),
      )
    }
    case "includes":
      if (args.length === 0 || args.length > 2)
        throw new InterpreterRuntimeError("Array.includes expects a value and optional start index.", node)
      return Effect.succeed(target.includes(args[0], optNumber(args[1], "start index")))
    case "indexOf":
      return Effect.succeed(target.indexOf(args[0], optNumber(args[1], "start index")))
    case "lastIndexOf":
      return Effect.succeed(
        args[1] === undefined
          ? target.lastIndexOf(args[0])
          : target.lastIndexOf(args[0], optNumber(args[1], "start index")),
      )
    case "at":
      return Effect.succeed(target.at(optNumber(args[0], "index") ?? 0))
    case "slice":
      return Effect.succeed(target.slice(optNumber(args[0], "start"), optNumber(args[1], "end")))
    case "concat":
      return Effect.succeed(target.concat(...args))
    case "flat":
      return Effect.succeed(target.flat(optNumber(args[0], "depth") ?? 1))
    case "reverse":
      return Effect.succeed(target.reverse())
    case "sort":
      return Effect.map(sortArray(runner, target, args[0], "Array.sort", node), (sorted) => {
        target.splice(0, target.length, ...sorted)
        return target
      })
    case "toSorted":
      return sortArray(runner, target, args[0], "Array.toSorted", node)
    case "toReversed":
      return Effect.succeed([...target].reverse())
    case "with": {
      const index = optNumber(args[0], "index") ?? 0
      const resolved = index < 0 ? target.length + index : index
      if (resolved < 0 || resolved >= target.length) {
        throw new InterpreterRuntimeError("Array.with index is out of range.", node)
      }
      const copied = [...target]
      copied[resolved] = args[1]
      return Effect.succeed(copied)
    }
    case "push": {
      // Validate all insertions before mutating to avoid partial cyclic updates.
      for (const item of args) rejectCircularInsertion(target, item, "Array.push result", node)
      target.push(...args)
      return Effect.succeed(target.length)
    }
    case "unshift": {
      for (const item of args) rejectCircularInsertion(target, item, "Array.unshift result", node)
      target.unshift(...args)
      return Effect.succeed(target.length)
    }
    case "pop":
      return Effect.succeed(target.pop())
    case "shift":
      return Effect.succeed(target.shift())
    case "splice": {
      if (args.length === 0) return Effect.succeed(target.splice(0, 0))
      const start = optNumber(args[0], "start") ?? 0
      if (args.length === 1) return Effect.succeed(target.splice(start))
      const deleteCount = optNumber(args[1], "delete count") ?? 0
      const inserted = args.slice(2)
      for (const item of inserted) rejectCircularInsertion(target, item, "Array.splice result", node)
      return Effect.succeed(target.splice(start, deleteCount, ...inserted))
    }
    case "fill": {
      rejectCircularInsertion(target, args[0], "Array.fill result", node)
      return Effect.succeed(target.fill(args[0], optNumber(args[1], "start"), optNumber(args[2], "end")))
    }
    case "copyWithin":
      return Effect.succeed(
        target.copyWithin(
          optNumber(args[0], "target index") ?? 0,
          optNumber(args[1], "start") ?? 0,
          optNumber(args[2], "end"),
        ),
      )
    case "keys":
      return Effect.succeed(Array.from(target.keys()))
    case "values":
      return Effect.succeed([...target])
    case "entries":
      return Effect.succeed(Array.from(target.entries(), ([index, item]): Array<unknown> => [index, item]))
  }

  const apply = applyCollectionCallback(runner, args[0], `Array.${name}`, node)
  return Effect.gen(function* () {
    // Fix iteration length while reading existing elements live.
    const length = target.length
    switch (name) {
      case "map": {
        const values: Array<unknown> = []
        values.length = length
        for (let index = 0; index < length; index += 1) {
          if (!(index in target)) continue
          values[index] = yield* apply([target[index], index, target])
        }
        return values
      }
      case "flatMap": {
        const values: Array<unknown> = []
        for (let index = 0; index < length; index += 1) {
          if (!(index in target)) continue
          const mapped = yield* apply([target[index], index, target])
          if (Array.isArray(mapped)) values.push(...mapped)
          else values.push(mapped)
        }
        return values
      }
      case "filter": {
        const values: Array<unknown> = []
        for (let index = 0; index < length; index += 1) {
          if (!(index in target)) continue
          const item = target[index]
          if (yield* apply([item, index, target])) values.push(item)
        }
        return values
      }
      case "find":
        for (let index = 0; index < length; index += 1) {
          const item = target[index]
          if (yield* apply([item, index, target])) return item
        }
        return undefined
      case "findIndex":
        for (let index = 0; index < length; index += 1) {
          if (yield* apply([target[index], index, target])) return index
        }
        return -1
      case "some":
        for (let index = 0; index < length; index += 1) {
          if (!(index in target)) continue
          if (yield* apply([target[index], index, target])) return true
        }
        return false
      case "every":
        for (let index = 0; index < length; index += 1) {
          if (!(index in target)) continue
          if (!(yield* apply([target[index], index, target]))) return false
        }
        return true
      case "forEach":
        for (let index = 0; index < length; index += 1) {
          if (index in target) yield* apply([target[index], index, target])
        }
        return undefined
      case "reduce": {
        let start = 0
        let accumulator = args[1]
        if (args.length < 2) {
          while (start < length && !(start in target)) start += 1
          if (start === length)
            throw new InterpreterRuntimeError("Array.reduce of an empty array with no initial value.", node).as(
              "TypeError",
            )
          accumulator = target[start]
          start += 1
        }
        for (let index = start; index < length; index += 1) {
          if (!(index in target)) continue
          accumulator = yield* apply([accumulator, target[index], index, target])
        }
        return accumulator
      }
      case "reduceRight": {
        let start = length - 1
        let accumulator = args[1]
        if (args.length < 2) {
          while (start >= 0 && !(start in target)) start -= 1
          if (start < 0)
            throw new InterpreterRuntimeError("Array.reduceRight of an empty array with no initial value.", node).as(
              "TypeError",
            )
          accumulator = target[start]
          start -= 1
        }
        for (let index = start; index >= 0; index -= 1) {
          if (!(index in target)) continue
          accumulator = yield* apply([accumulator, target[index], index, target])
        }
        return accumulator
      }
      case "findLast":
        for (let index = length - 1; index >= 0; index -= 1) {
          const item = target[index]
          if (yield* apply([item, index, target])) return item
        }
        return undefined
      case "findLastIndex":
        for (let index = length - 1; index >= 0; index -= 1) {
          if (yield* apply([target[index], index, target])) return index
        }
        return -1
    }
    throw new InterpreterRuntimeError(`Array method '${name}' is not available in CodeMode.`, node)
  })
}

const sortArray = <R>(
  runner: CallbackRunner<R>,
  target: Array<unknown>,
  comparator: unknown,
  name: string,
  node: AstNode,
): Effect.Effect<Array<unknown>, unknown, R> => {
  if (comparator === undefined) {
    return Effect.sync(() =>
      [...target].sort((a, b) => {
        const left = coerceToString(a)
        const right = coerceToString(b)
        return left < right ? -1 : left > right ? 1 : 0
      }),
    )
  }
  const apply = applyCollectionCallback(runner, comparator, name, node)
  const mergeSort = (items: Array<unknown>): Effect.Effect<Array<unknown>, unknown, R> => {
    if (items.length <= 1) return Effect.succeed(items)
    const midpoint = Math.floor(items.length / 2)
    return Effect.gen(function* () {
      const left = yield* mergeSort(items.slice(0, midpoint))
      const right = yield* mergeSort(items.slice(midpoint))
      const merged: Array<unknown> = []
      let leftIndex = 0
      let rightIndex = 0
      while (leftIndex < left.length && rightIndex < right.length) {
        // Treat a NaN comparator result as equal to preserve stable ordering.
        const order = coerceToNumber(yield* apply([left[leftIndex], right[rightIndex]]))
        if (Number.isNaN(order) || order <= 0) merged.push(left[leftIndex++])
        else merged.push(right[rightIndex++])
      }
      return [...merged, ...left.slice(leftIndex), ...right.slice(rightIndex)]
    })
  }
  const defined = target.filter((item) => item !== undefined)
  const undefinedCount = target.length - defined.length
  return Effect.map(mergeSort(defined), (items) => [...items, ...Array(undefinedCount).fill(undefined)])
}

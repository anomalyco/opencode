import { Effect } from "effect"
import { isBlockedMember, type SafeObject, toProgram } from "../data.js"
import { dateSetterArgumentCount, invokeDateMethod } from "../stdlib/date.js"
import { invokeNumberMethod } from "../stdlib/number.js"
import { invokeRegExpMethod, matchToValue, toHostRegex } from "../stdlib/regexp.js"
import { invokeURLMethod, uriArgument } from "../stdlib/url.js"
import { coerceToNumber, coerceToString, errorBrandName } from "../stdlib/value.js"
import { compareText } from "../tool-runtime.js"
import { Values } from "../values.js"
import { type AstNode, IntrinsicReference, InterpreterRuntimeError } from "./model.js"
import { containsOpaqueReference, rejectCircularInsertion, typeofValue } from "./references.js"
import { applyCollectionCallback, type CallbackRunner, isSupportedCallback, toPrimitive } from "./runner.js"

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
  if (ref.receiver instanceof Values.Date) {
    const target = ref.receiver
    const argumentCount = dateSetterArgumentCount(ref.name)
    if (argumentCount === undefined) return Effect.succeed(invokeDateMethod(target, ref.name, [], node))
    // Native setters read the current time before argument coercion, whose callbacks may mutate the Date.
    const initialTime = target.time
    return Effect.map(
      Effect.forEach(args.slice(0, argumentCount), (arg) => coerceNumericArgument(runner, arg, node), {
        concurrency: 1,
      }),
      (values) => invokeDateMethod(target, ref.name, values, node, initialTime),
    )
  }
  if (ref.receiver instanceof Values.RegExp) {
    return Effect.succeed(invokeRegExpMethod(ref.receiver, ref.name, args, node))
  }
  if (ref.receiver instanceof Values.Map) {
    return invokeMapMethod(runner, ref.receiver, ref.name, args, node)
  }
  if (ref.receiver instanceof Values.Set) {
    return invokeSetMethod(runner, ref.receiver, ref.name, args, node)
  }
  if (ref.receiver instanceof Values.URL) {
    return Effect.succeed(invokeURLMethod(ref.receiver, ref.name, node))
  }
  if (ref.receiver instanceof Values.URLSearchParams) {
    return invokeURLSearchParamsMethod(runner, ref.receiver, ref.name, args, node)
  }
  throw new InterpreterRuntimeError(`Method '${ref.name}' is not available.`, node)
}

/**
 * ToPrimitive: tries an object's own `valueOf`/`toString` in hint order and returns the first
 * primitive result. Runtime values behave like their JS counterparts (Date yields its time under a
 * number hint; the rest yield their string form). An inherited `toString` yields the default
 * string form, so plain objects become "[object Object]" and arrays join.
 */

const coerceNumericArgument = <R>(
  runner: CallbackRunner<R>,
  value: unknown,
  node: AstNode,
): Effect.Effect<number, unknown, R> => Effect.map(toPrimitive(runner, value, "number", node), coerceToNumber)

// console is intercepted by the interpreter before reaching here.
const requireDataArgument = (name: string, index: number, arg: unknown, node: AstNode): unknown => {
  if (containsOpaqueReference(arg)) {
    throw new InterpreterRuntimeError(
      `String.${name} expects argument ${index + 1} to be a data value.`,
      node,
      "InvalidDataValue",
    )
  }
  return arg
}

const invokeStringMethod = (value: string, name: string, args: Array<unknown>, node: AstNode): unknown => {
  // Coerce arguments like native JS; opaque runtime references still reject.
  const str = (index: number): string => coerceToString(requireDataArgument(name, index, args[index], node))
  const num = (index: number): number => coerceToNumber(requireDataArgument(name, index, args[index], node))
  const optNum = (index: number): number | undefined => (args[index] === undefined ? undefined : num(index))
  const optStr = (index: number): string | undefined => (args[index] === undefined ? undefined : str(index))
  const rejectRegex = (): void => {
    if (args[0] instanceof Values.RegExp) {
      throw new InterpreterRuntimeError(
        `String.${name} cannot take a regular expression; use regex.test(string) or String.search instead.`,
        node,
      ).as("TypeError")
    }
  }

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
      // Native: an undefined separator returns the whole string, not a split on "undefined",
      // unless the limit truncates to zero.
      if (args[0] === undefined) {
        const requestedLimit = optNum(1)
        result = requestedLimit !== undefined && requestedLimit >>> 0 === 0 ? [] : [value]
        break
      }
      if (args[0] instanceof Values.RegExp) {
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
      rejectRegex()
      result = value.includes(str(0), optNum(1))
      break
    case "startsWith":
      rejectRegex()
      result = value.startsWith(str(0), optNum(1))
      break
    case "endsWith":
      rejectRegex()
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
      if (args[0] instanceof Values.RegExp) {
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
      if (pattern.global) return toProgram(matched, "String.match result")
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
        throw new InterpreterRuntimeError("String.repeat expects a finite non-negative count.", node).as("RangeError")
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
      throw new InterpreterRuntimeError(`String method '${name}' is not available.`, node)
  }
  return toProgram(result, `String.${name} result`)
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
  if (pattern instanceof Values.RegExp) {
    if (name === "replaceAll" && !pattern.regex.global) {
      throw new InterpreterRuntimeError(
        `String.replaceAll requires a regular expression with the global (g) flag: write /${pattern.regex.source}/${pattern.regex.flags}g, or use String.replace to replace only the first match.`,
        node,
      )
    }
    if (name === "replace") value.replace(pattern.regex, collect)
    else value.replaceAll(pattern.regex, collect)
  } else {
    const search = coerceToString(requireDataArgument(name, 0, pattern, node))
    if (name === "replace") value.replace(search, collect)
    else value.replaceAll(search, collect)
  }

  return Effect.gen(function* () {
    const output: Array<string> = []
    let end = 0
    for (const match of matches) {
      const replacement = yield* apply(match.args)
      // Error values are branded plain objects; toProgram would strip the brand before coercion.
      output.push(
        value.slice(end, match.offset),
        replacement instanceof Values.Promise
          ? "[object Promise]"
          : errorBrandName(replacement)
            ? coerceToString(replacement)
            : coerceToString(toProgram(replacement, `String.${name} replacer result`)),
      )
      end = match.offset + match.match.length
    }
    output.push(value.slice(end))
    return toProgram(output.join(""), `String.${name} result`)
  })
}

const invokeMapMethod = <R>(
  runner: CallbackRunner<R>,
  target: Values.Map,
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
      throw new InterpreterRuntimeError(`Map method '${name}' is not available.`, node)
  }
}

const invokeSetMethod = <R>(
  runner: CallbackRunner<R>,
  target: Values.Set,
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
    case "union":
    case "intersection":
    case "difference":
    case "symmetricDifference":
    case "isSubsetOf":
    case "isSupersetOf":
    case "isDisjointFrom":
      return invokeSetOperation(runner, target, name, args[0], node)
    default:
      throw new InterpreterRuntimeError(`Set method '${name}' is not available.`, node)
  }
}

const invokeSetOperation = <R>(
  runner: CallbackRunner<R>,
  target: Values.Set,
  name: string,
  source: unknown,
  node: AstNode,
): Effect.Effect<unknown, unknown, R> =>
  Effect.gen(function* () {
    const other = yield* loadSetRecord(runner, source, name, node)
    if (name === "union") {
      const result = copySet(target)
      for (const item of yield* other.keys()) result.set.add(item)
      return result
    }
    if (name === "intersection") {
      const result = new Values.Set()
      if (target.set.size <= other.size) {
        for (const item of target.set.values()) {
          if (yield* other.has(item)) result.set.add(item)
        }
        return result
      }
      for (const item of yield* other.keys()) {
        if (target.set.has(item)) result.set.add(item)
      }
      return result
    }
    if (name === "difference") {
      const result = copySet(target)
      if (target.set.size <= other.size) {
        for (const item of result.set.values()) {
          if (yield* other.has(item)) result.set.delete(item)
        }
        return result
      }
      for (const item of yield* other.keys()) result.set.delete(item)
      return result
    }
    if (name === "symmetricDifference") {
      const result = copySet(target)
      for (const item of yield* other.keys()) {
        if (target.set.has(item)) result.set.delete(item)
        else result.set.add(item)
      }
      return result
    }
    if (name === "isSubsetOf") {
      if (target.set.size > other.size) return false
      for (const item of target.set.values()) {
        if (!(yield* other.has(item))) return false
      }
      return true
    }
    if (name === "isSupersetOf") {
      if (target.set.size < other.size) return false
      for (const item of yield* other.keys()) {
        if (!target.set.has(item)) return false
      }
      return true
    }
    if (target.set.size <= other.size) {
      for (const item of target.set.values()) {
        if (yield* other.has(item)) return false
      }
      return true
    }
    for (const item of yield* other.keys()) {
      if (target.set.has(item)) return false
    }
    return true
  })

const copySet = (source: Values.Set): Values.Set => {
  const result = new Values.Set()
  for (const item of source.set.values()) result.set.add(item)
  return result
}

const loadSetRecord = <R>(runner: CallbackRunner<R>, source: unknown, name: string, node: AstNode) => {
  if (source instanceof Values.Set) {
    return Effect.succeed({
      size: source.set.size,
      has: (item: unknown) => Effect.succeed(source.set.has(item)),
      keys: () => Effect.succeed(source.set.values()),
    })
  }
  if (source instanceof Values.Map) {
    return Effect.succeed({
      size: source.map.size,
      has: (item: unknown) => Effect.succeed(source.map.has(item)),
      keys: () => Effect.succeed(source.map.keys()),
    })
  }
  if (source === null || typeof source !== "object" || Values.isValue(source)) {
    throw new InterpreterRuntimeError(`Set.${name} expects a Set-like object.`, node).as("TypeError")
  }
  const object = source as Record<string, unknown>
  return Effect.gen(function* () {
    const size = yield* coerceNumericArgument(runner, object.size, node)
    if (Number.isNaN(size)) {
      throw new InterpreterRuntimeError(`Set.${name} received a Set-like object with an invalid size.`, node).as(
        "TypeError",
      )
    }
    if (!isSupportedCallback(object.has) || !isSupportedCallback(object.keys)) {
      throw new InterpreterRuntimeError(`Set.${name} expects callable 'has' and 'keys' methods.`, node).as("TypeError")
    }
    const has = object.has
    const keys = object.keys
    return {
      size: Math.max(Math.trunc(size), 0),
      has: (item: unknown) => Effect.map(runner.invokeCallable(has, [item], node), Boolean),
      keys: () =>
        Effect.flatMap(runner.invokeCallable(keys, [], node), (result) => {
          if (Array.isArray(result)) return Effect.succeed(result)
          throw new InterpreterRuntimeError(`Set.${name} expected 'keys' to return an iterator.`, node).as("TypeError")
        }),
    }
  })
}

const invokeURLSearchParamsMethod = <R>(
  runner: CallbackRunner<R>,
  target: Values.URLSearchParams,
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
      throw new InterpreterRuntimeError(`URLSearchParams method '${name}' is not available.`, node)
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
      const input = toProgram(target, "Array.join input") as Array<unknown>
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
    case "sort": {
      const length = target.length
      const holeCount = Array.from({ length }, (_, index) => Object.hasOwn(target, index)).filter((own) => !own).length
      const itemCount = length - holeCount
      return Effect.map(sortArray(runner, target, args[0], "Array.sort", node), (sorted) => {
        sorted.slice(0, itemCount).forEach((item, index) => {
          target[index] = item
        })
        Array.from({ length: holeCount }, (_, index) => itemCount + index).forEach((index) => {
          Reflect.deleteProperty(target, index)
        })
        return target
      })
    }
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
    case "toSpliced": {
      if (args.length === 0) return Effect.succeed([...target])
      const start = optNumber(args[0], "start") ?? 0
      if (args.length === 1) {
        const copied = [...target]
        copied.splice(start)
        return Effect.succeed(copied)
      }
      const deleteCount = optNumber(args[1], "delete count") ?? 0
      const copied = [...target]
      copied.splice(start, deleteCount, ...args.slice(2))
      return Effect.succeed(copied)
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
    throw new InterpreterRuntimeError(`Array method '${name}' is not available.`, node)
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
    return Effect.sync(() => [...target].sort((a, b) => compareText(coerceToString(a), coerceToString(b))))
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

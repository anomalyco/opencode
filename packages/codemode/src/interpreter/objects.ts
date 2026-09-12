import type { BlockStatement, Expression, Pattern } from "acorn"
import { AsyncIteratorSymbol, type Binding, IteratorSymbol } from "./model.js"

/** An object owned by the program: own properties plus a prototype link. */
export class ProgramObject {
  readonly props = new Map<PropertyKey, unknown>()
  constructor(public proto: ProgramObject | null = null) {}
}

export class ProgramArray extends ProgramObject {
  constructor(readonly items: Array<unknown> = []) {
    super()
  }
}

/** An object with the [[ErrorData]] slot: what `Error.prototype.toString` and the host boundary recognize as an error. */
export class ProgramError extends ProgramObject {}

export class ProgramFunction extends ProgramObject {
  readonly length: number
  constructor(
    readonly name: string,
    readonly parameters: ReadonlyArray<Pattern>,
    readonly body: BlockStatement | Expression,
    readonly capturedScopes: ReadonlyArray<Map<string, Binding>>,
    readonly async: boolean,
    readonly generator: boolean,
  ) {
    super()
    const optional = parameters.findIndex((p) => p.type === "AssignmentPattern" || p.type === "RestElement")
    this.length = optional === -1 ? parameters.length : optional
  }
}

const MAX_ARRAY_LENGTH = 4_294_967_295

export const parseArrayIndex = (key: string | number): number | undefined => {
  const property = String(key)
  if (!/^(0|[1-9]\d*)$/.test(property)) return undefined
  const index = Number(property)
  return index < MAX_ARRAY_LENGTH ? index : undefined
}

const canonical = (key: PropertyKey): string | symbol => (typeof key === "symbol" ? key : String(key))

const index = (target: ProgramObject, key: string | symbol): number | undefined =>
  target instanceof ProgramArray && typeof key === "string" ? parseArrayIndex(key) : undefined

// Non-enumerable built-in properties: array length, function name and length.
const builtin = (target: ProgramObject, name: string | symbol): boolean =>
  (name === "length" && target instanceof ProgramArray) ||
  ((name === "name" || name === "length") && target instanceof ProgramFunction)

export const hasOwn = (target: ProgramObject, key: PropertyKey): boolean => {
  const name = canonical(key)
  const at = index(target, name)
  if (at !== undefined) return at in (target as ProgramArray).items
  return builtin(target, name) || target.props.has(name)
}

export const getOwn = (target: ProgramObject, key: PropertyKey): unknown => {
  const name = canonical(key)
  const at = index(target, name)
  if (at !== undefined) return (target as ProgramArray).items[at]
  if (target instanceof ProgramArray && name === "length") return target.items.length
  if (target instanceof ProgramFunction && name === "name") return target.name
  if (target instanceof ProgramFunction && name === "length") return target.length
  return target.props.get(name)
}

export const get = (target: ProgramObject, key: PropertyKey): unknown => {
  for (let current: ProgramObject | null = target; current !== null; current = current.proto) {
    if (hasOwn(current, key)) return getOwn(current, key)
  }
  return undefined
}

export const hasPrototype = (value: unknown, proto: ProgramObject): boolean => {
  for (let current = value instanceof ProgramObject ? value.proto : null; current !== null; current = current.proto) {
    if (current === proto) return true
  }
  return false
}

export const has = (target: ProgramObject, key: PropertyKey): boolean => {
  for (let current: ProgramObject | null = target; current !== null; current = current.proto) {
    if (hasOwn(current, key)) return true
  }
  return false
}

export const set = (target: ProgramObject, key: PropertyKey, value: unknown): boolean => {
  const name = canonical(key)
  const at = index(target, name)
  if (at !== undefined) {
    ;(target as ProgramArray).items[at] = value
    return true
  }
  if (name === "length" && target instanceof ProgramArray) {
    const length = typeof value === "number" ? value : Number(value)
    if (!Number.isInteger(length) || length < 0 || length > 4_294_967_295) return false
    target.items.length = length
    return true
  }
  if (builtin(target, name)) return false
  target.props.set(name, value)
  return true
}

export const remove = (target: ProgramObject, key: PropertyKey): boolean => {
  const name = canonical(key)
  const at = index(target, name)
  if (at !== undefined) return delete (target as ProgramArray).items[at]
  if (name === "length" && target instanceof ProgramArray) return false
  if (builtin(target, name)) return true
  target.props.delete(name)
  return true
}

// JS order: array indexes, integer-like keys ascending, other strings, then symbols.
export const ownKeys = (target: ProgramObject): Array<string | symbol> => {
  const strings = [...target.props.keys()].filter((key): key is string => typeof key === "string")
  const symbols = [...target.props.keys()].filter((key): key is symbol => typeof key === "symbol")
  return [
    ...(target instanceof ProgramArray ? Object.keys(target.items) : []),
    ...strings.filter((key) => parseArrayIndex(key) !== undefined).sort((a, b) => Number(a) - Number(b)),
    ...strings.filter((key) => parseArrayIndex(key) === undefined),
    ...symbols,
  ]
}

export const ownEntries = (target: ProgramObject): Array<[string, unknown]> =>
  ownKeys(target)
    .filter((key): key is string => typeof key === "string")
    .map((key) => [key, getOwn(target, key)])

export const record = (entries: Record<string, unknown>): ProgramObject => {
  const target = new ProgramObject()
  for (const [key, value] of Object.entries(entries)) set(target, key, value)
  return target
}

export const assign = (target: ProgramObject, source: ProgramObject, skip?: ReadonlySet<PropertyKey>): void => {
  for (const key of ownKeys(source)) {
    if (skip?.has(key)) continue
    if (typeof key === "symbol" && key !== IteratorSymbol && key !== AsyncIteratorSymbol) continue
    set(target, key, getOwn(source, key))
  }
}

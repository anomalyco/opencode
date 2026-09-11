import { AsyncIteratorSymbol, IteratorSymbol } from "./model.js"

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

export class ProgramError extends ProgramObject {
  constructor(readonly errorName: string) {
    super()
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

export const hasOwn = (target: ProgramObject, key: PropertyKey): boolean => {
  const name = canonical(key)
  const at = index(target, name)
  if (at !== undefined) return at in (target as ProgramArray).items
  if (name === "length" && target instanceof ProgramArray) return true
  return target.props.has(name)
}

export const getOwn = (target: ProgramObject, key: PropertyKey): unknown => {
  const name = canonical(key)
  const at = index(target, name)
  if (at !== undefined) return (target as ProgramArray).items[at]
  if (name === "length" && target instanceof ProgramArray) return target.items.length
  return target.props.get(name)
}

export const get = (target: ProgramObject, key: PropertyKey): unknown => {
  for (let current: ProgramObject | null = target; current !== null; current = current.proto) {
    if (hasOwn(current, key)) return getOwn(current, key)
  }
  return undefined
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
  target.props.set(name, value)
  return true
}

export const remove = (target: ProgramObject, key: PropertyKey): boolean => {
  const name = canonical(key)
  const at = index(target, name)
  if (at !== undefined) return delete (target as ProgramArray).items[at]
  if (name === "length" && target instanceof ProgramArray) return false
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

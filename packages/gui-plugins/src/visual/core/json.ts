/* oxlint-disable anti-slop/no-runtime-typeof -- this file is the I/O boundary that turns an untrusted JSON block into the domain values the renderers read. */
/** A JSON value, the only shape a visual spec may carry. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** A JSON object. */
export type JsonObject = { [key: string]: Json }

export function isObject(value: Json | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function object(value: Json | undefined): JsonObject | undefined {
  return isObject(value) ? value : undefined
}

export function array(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : []
}

export function objects(value: Json | undefined): JsonObject[] {
  return array(value).filter(isObject)
}

export function optionalNum(value: Json | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function str(value: Json | undefined, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

export function pair(value: Json | undefined): [number, number] | undefined {
  const items = array(value)

  if (items.length < 2) return undefined
  const x = optionalNum(items[0])
  const y = optionalNum(items[1])

  return x === undefined || y === undefined ? undefined : [x, y]
}

export function pairs(value: Json | undefined, limit = 4000): Array<[number, number]> {
  return array(value)
    .slice(0, limit)
    .map(pair)
    .filter((item): item is [number, number] => item !== undefined)
}

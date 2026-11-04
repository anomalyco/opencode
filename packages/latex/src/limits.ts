import { LatexParseError } from "./types"

export const DEFAULT_MAX_SOURCE_LENGTH = 100_000
export const DEFAULT_MAX_NESTING_DEPTH = 256

export function resolvePositiveInteger(value: number | undefined, fallback: number, optionName: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${optionName} must be a positive safe integer`)
  }
  return value
}

export function assertSourceLength(source: string, maximum: number, label = "LaTeX source"): void {
  if (source.length > maximum) {
    throw new LatexParseError(`${label} exceeds the ${maximum}-character limit`, maximum)
  }
}

export function assertNestingDepth(source: string, maximum: number): void {
  let depth = 0
  let slashRun = 0
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === "\\") {
      slashRun++
      continue
    }
    const escaped = slashRun % 2 === 1
    slashRun = 0
    if (char === "{" && !escaped) {
      depth++
      if (depth > maximum) {
        throw new LatexParseError(`LaTeX nesting exceeds the ${maximum}-level limit`, index)
      }
    } else if (char === "}" && !escaped) {
      depth = Math.max(0, depth - 1)
    }
  }
}

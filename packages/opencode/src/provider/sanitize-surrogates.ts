const HIGH_SURROGATE_MIN = 0xd800
const HIGH_SURROGATE_MAX = 0xdbff
const LOW_SURROGATE_MIN = 0xdc00
const LOW_SURROGATE_MAX = 0xdfff

function isHighSurrogate(value: number) {
  return value >= HIGH_SURROGATE_MIN && value <= HIGH_SURROGATE_MAX
}

function isLowSurrogate(value: number) {
  return value >= LOW_SURROGATE_MIN && value <= LOW_SURROGATE_MAX
}

function fixLoneSurrogateCodeUnits(input: string) {
  let output = ""

  for (let index = 0; index < input.length; index++) {
    const current = input.charCodeAt(index)

    if (isHighSurrogate(current)) {
      const next = input.charCodeAt(index + 1)
      if (Number.isFinite(next) && isLowSurrogate(next)) {
        output += input[index] + input[index + 1]
        index++
        continue
      }

      output += "\uFFFD"
      continue
    }

    if (isLowSurrogate(current)) {
      output += "\uFFFD"
      continue
    }

    output += input[index]
  }

  return output
}

export function fixJsonSurrogateEscapes(input: string) {
  const matches = Array.from(input.matchAll(/\\u([\da-fA-F]{4})/g))
  let output = ""
  let cursor = 0
  let replaced = false

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]
    if (match.index === undefined) continue
    const code = Number.parseInt(match[1], 16)

    if (isHighSurrogate(code)) {
      const next = matches[index + 1]
      if (next && next.index !== undefined) {
        const nextCode = Number.parseInt(next[1], 16)
        const adjacent = next.index === match.index + match[0].length
        if (adjacent && isLowSurrogate(nextCode)) {
          output += input.slice(cursor, next.index + next[0].length)
          cursor = next.index + next[0].length
          index++
          continue
        }
      }

      output += input.slice(cursor, match.index) + "\\uFFFD"
      cursor = match.index + match[0].length
      replaced = true
      continue
    }

    if (isLowSurrogate(code)) {
      output += input.slice(cursor, match.index) + "\\uFFFD"
      cursor = match.index + match[0].length
      replaced = true
    }
  }

  if (!replaced) return input
  return output + input.slice(cursor)
}

export function sanitizeSurrogates(input: string) {
  const withStringMethods = input as string & {
    isWellFormed?: () => boolean
    toWellFormed?: () => string
  }

  let normalized = input

  if (typeof withStringMethods.isWellFormed === "function" && withStringMethods.isWellFormed()) {
    normalized = input
  } else if (typeof withStringMethods.toWellFormed === "function") {
    normalized = withStringMethods.toWellFormed()
  } else {
    normalized = fixLoneSurrogateCodeUnits(input)
  }

  return fixJsonSurrogateEscapes(normalized)
}

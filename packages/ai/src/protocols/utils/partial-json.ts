/*
 * Adapted from partial-json by the Promplate Dev Team:
 * https://github.com/promplate/partial-json-parser-js
 *
 * MIT License
 *
 * Copyright (c) 2023 Promplate Dev Team
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { Schema } from "effect"
import { Allow } from "./partial-json-options.js"
export * from "./partial-json-options.js"

export class PartialJSON extends Error {}
export class MalformedJSON extends Error {}

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))

/** Parse complete or incomplete JSON, restricted by the supplied partial-value flags. */
export function parseJSON(jsonString: string, allowPartial = Allow.ALL): unknown {
  if (typeof jsonString !== "string") throw new TypeError(`expecting str, got ${typeof jsonString}`)
  const input = jsonString.trim()
  if (!input) throw new Error(`${jsonString} is empty`)
  try {
    return decodeJson(input)
  } catch {}
  return _parseJSON(input, allowPartial)
}

const _parseJSON = (jsonString: string, allow: number) => {
  const length = jsonString.length
  let index = 0

  const markPartialJSON = (message: string): never => {
    throw new PartialJSON(`${message} at position ${index}`)
  }

  const throwMalformedError = (message: string): never => {
    throw new MalformedJSON(`${message} at position ${index}`)
  }

  const parseAny = (): unknown => {
    skipBlank()
    if (index >= length) markPartialJSON("Unexpected end of input")
    if (jsonString[index] === '"') return parseStr()
    if (jsonString[index] === "{") return parseObj()
    if (jsonString[index] === "[") return parseArr()
    if (
      jsonString.substring(index, index + 4) === "null" ||
      (Allow.NULL & allow && length - index < 4 && "null".startsWith(jsonString.substring(index)))
    ) {
      index += 4
      return null
    }
    if (
      jsonString.substring(index, index + 4) === "true" ||
      (Allow.BOOL & allow && length - index < 4 && "true".startsWith(jsonString.substring(index)))
    ) {
      index += 4
      return true
    }
    if (
      jsonString.substring(index, index + 5) === "false" ||
      (Allow.BOOL & allow && length - index < 5 && "false".startsWith(jsonString.substring(index)))
    ) {
      index += 5
      return false
    }
    if (
      jsonString.substring(index, index + 8) === "Infinity" ||
      (Allow.INFINITY & allow && length - index < 8 && "Infinity".startsWith(jsonString.substring(index)))
    ) {
      index += 8
      return Infinity
    }
    if (
      jsonString.substring(index, index + 9) === "-Infinity" ||
      (Allow._INFINITY & allow &&
        1 < length - index &&
        length - index < 9 &&
        "-Infinity".startsWith(jsonString.substring(index)))
    ) {
      index += 9
      return -Infinity
    }
    if (
      jsonString.substring(index, index + 3) === "NaN" ||
      (Allow.NAN & allow && length - index < 3 && "NaN".startsWith(jsonString.substring(index)))
    ) {
      index += 3
      return NaN
    }
    return parseNum()
  }

  const parseStr = (): string => {
    const start = index
    let escape = false
    index++
    while (index < length && (jsonString[index] !== '"' || (escape && jsonString[index - 1] === "\\"))) {
      escape = jsonString[index] === "\\" ? !escape : false
      index++
    }
    if (jsonString.charAt(index) === '"') {
      try {
        return decodeJson(jsonString.substring(start, ++index - Number(escape))) as string
      } catch (error) {
        throwMalformedError(String(error))
      }
    }
    if (Allow.STR & allow) {
      try {
        return decodeJson(`${jsonString.substring(start, index - Number(escape))}"`) as string
      } catch {
        return decodeJson(`${jsonString.substring(start, jsonString.lastIndexOf("\\"))}"`) as string
      }
    }
    return markPartialJSON("Unterminated string literal")
  }

  const parseObj = (): Record<string, unknown> => {
    index++
    skipBlank()
    const object: Record<string, unknown> = {}
    try {
      while (jsonString[index] !== "}") {
        skipBlank()
        if (index >= length && Allow.OBJ & allow) return object
        const key = parseStr()
        skipBlank()
        index++
        try {
          object[key] = parseAny()
        } catch (error) {
          if (Allow.OBJ & allow) return object
          throw error
        }
        skipBlank()
        if (jsonString[index] === ",") index++
      }
    } catch {
      if (Allow.OBJ & allow) return object
      return markPartialJSON("Expected '}' at end of object")
    }
    index++
    return object
  }

  const parseArr = (): unknown[] => {
    index++
    const array: unknown[] = []
    try {
      while (jsonString[index] !== "]") {
        array.push(parseAny())
        skipBlank()
        if (jsonString[index] === ",") index++
      }
    } catch {
      if (Allow.ARR & allow) return array
      return markPartialJSON("Expected ']' at end of array")
    }
    index++
    return array
  }

  const parseNum = (): unknown => {
    if (index === 0) {
      if (jsonString === "-") throwMalformedError("Not sure what '-' is")
      try {
        return decodeJson(jsonString)
      } catch (error) {
        if (Allow.NUM & allow) {
          try {
            return decodeJson(jsonString.substring(0, jsonString.lastIndexOf("e")))
          } catch {}
        }
        throwMalformedError(String(error))
      }
    }

    const start = index
    if (jsonString[index] === "-") index++
    while (jsonString[index] && !",]}".includes(jsonString[index])) index++
    if (index === length && !(Allow.NUM & allow)) markPartialJSON("Unterminated number literal")

    try {
      return decodeJson(jsonString.substring(start, index))
    } catch (error) {
      if (jsonString.substring(start, index) === "-") markPartialJSON("Not sure what '-' is")
      try {
        return decodeJson(jsonString.substring(start, jsonString.lastIndexOf("e")))
      } catch {
        throwMalformedError(String(error))
      }
    }
  }

  const skipBlank = () => {
    while (index < length && " \n\r\t".includes(jsonString[index])) index++
  }

  return parseAny()
}

export const parse = parseJSON

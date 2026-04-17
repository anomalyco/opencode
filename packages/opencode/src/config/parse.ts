export * as ConfigParse from "./parse"

import { type ParseError as JsoncParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import z from "zod"
import { ConfigVariable } from "./variable"
import { InvalidError, JsonError } from "./error"

type Schema<T> = z.ZodType<T>
type VariableMode = "error" | "empty"

export type LoadOptions =
  | {
      type: "path"
      path: string
      missing?: VariableMode
      normalize?: (data: unknown, source: string) => unknown
    }
  | {
      type: "virtual"
      dir: string
      source: string
      missing?: VariableMode
      normalize?: (data: unknown, source: string) => unknown
    }

function issues(text: string, errors: JsoncParseError[]) {
  const lines = text.split("\n")
  return errors
    .map((e) => {
      const beforeOffset = text.substring(0, e.offset).split("\n")
      const line = beforeOffset.length
      const column = beforeOffset[beforeOffset.length - 1].length + 1
      const problemLine = lines[line - 1]

      const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
      if (!problemLine) return error

      return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
    })
    .join("\n")
}

export function parse<T>(schema: Schema<T>, text: string, filepath: string): T {
  const errors: JsoncParseError[] = []
  const data = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length) {
    throw new JsonError({
      path: filepath,
      message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${issues(text, errors)}\n--- End ---`,
    })
  }

  const parsed = schema.safeParse(data)
  if (parsed.success) return parsed.data

  throw new InvalidError({
    path: filepath,
    issues: parsed.error.issues,
  })
}

export async function load<T>(schema: Schema<T>, text: string, options: LoadOptions): Promise<T> {
  const source = options.type === "path" ? options.path : options.source
  const expanded = await ConfigVariable.substitute(
    text,
    options.type === "path" ? { type: "path", path: options.path } : options,
    options.missing,
  )
  const data = parse(z.unknown(), expanded, source)
  const normalized = options.normalize ? options.normalize(data, source) : data
  const parsed = schema.safeParse(normalized)
  if (!parsed.success) {
    throw new InvalidError({
      path: source,
      issues: parsed.error.issues,
    })
  }

  return parsed.data
}

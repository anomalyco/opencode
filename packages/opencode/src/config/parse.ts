export * as ConfigParse from "./parse"

import { type ParseError as JsoncParseError, parse as parseJsoncImpl, printParseErrorCode } from "jsonc-parser"
import { Cause, Exit, Schema as EffectSchema, SchemaIssue } from "effect"
import type { DeepMutable } from "@opencode-ai/core/schema"
import { InvalidError, JsonError } from "@opencode-ai/core/v1/config/error"

export function jsonc(text: string, filepath: string, original?: string): unknown {
  const errors: JsoncParseError[] = []
  const data = parseJsoncImpl(text, errors, { allowTrailingComma: true })
  if (errors.length) {
    // Report against the config as written. When `text` is the result of {env:}/{file:} substitution,
    // quoting it would print the resolved values and cite positions the user cannot find in their file.
    const input = original ?? text
    const inputErrors: JsoncParseError[] = []
    if (input !== text) parseJsoncImpl(input, inputErrors, { allowTrailingComma: true })
    const lines = input.split("\n")
    const issues = (input === text ? errors : inputErrors)
      .map((e) => {
        const beforeOffset = input.substring(0, e.offset).split("\n")
        const line = beforeOffset.length
        const column = beforeOffset[beforeOffset.length - 1].length + 1
        const problemLine = lines[line - 1]

        const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
        if (!problemLine) return error

        return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
      })
      .join("\n")
    throw new JsonError({
      path: filepath,
      // No issues means the file itself is fine and a substituted value broke the JSON; naming the
      // offending value would print it.
      message: `\n--- JSONC Input ---\n${input}\n--- Errors ---\n${issues || "A substituted {env:...} or {file:...} value is not valid JSON"}\n--- End ---`,
    })
  }

  return data
}

export function schema<S extends EffectSchema.Decoder<unknown, never>>(
  schema: S,
  data: unknown,
  source: string,
): DeepMutable<S["Type"]> {
  const decoded = EffectSchema.decodeUnknownExit(schema)(data, {
    errors: "all",
    onExcessProperty: "ignore",
    propertyOrder: "original",
  })
  if (Exit.isSuccess(decoded)) return decoded.value as DeepMutable<S["Type"]>
  const error = Cause.squash(decoded.cause)

  throw new InvalidError(
    {
      path: source,
      issues: EffectSchema.isSchemaError(error)
        ? SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map((issue) => ({
            ...issue,
            message: issue.message,
            path: issue.path?.map(String) ?? [],
          }))
        : [{ message: String(error), path: [] }],
    },
    { cause: error },
  )
}

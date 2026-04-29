export * as ConfigParse from "./parse"

import { type ParseError as JsoncParseError, parse as parseJsoncImpl, printParseErrorCode } from "jsonc-parser"
import { Cause, Exit, Schema as EffectSchema, SchemaIssue } from "effect"
import z from "zod"
import type { DeepMutable } from "@/util/schema"
import { InvalidError, JsonError } from "./error"

type ZodSchema<T> = z.ZodType<T>

export function jsonc(text: string, filepath: string): unknown {
  const errors: JsoncParseError[] = []
  const data = parseJsoncImpl(text, errors, { allowTrailingComma: true })
  if (errors.length) {
    const lines = text.split("\n")
    const issues = errors
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
    throw new JsonError({
      path: filepath,
      message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${issues}\n--- End ---`,
    })
  }

  return data
}

export function schema<T>(schema: ZodSchema<T>, data: unknown, source: string): T {
  const parsed = schema.safeParse(data)
  if (parsed.success) return parsed.data

  throw new InvalidError({
    path: source,
    issues: parsed.error.issues,
  })
}

export function effectSchema<S extends EffectSchema.Decoder<unknown, never>>(
  schema: S,
  data: unknown,
  source: string,
): DeepMutable<S["Type"]> {
  const extra = topLevelExtraKeys(schema, data)
  if (extra.length) {
    throw new InvalidError({
      path: source,
      issues: [
        {
          code: "unrecognized_keys",
          keys: extra,
          path: [],
          message: `Unrecognized key${extra.length === 1 ? "" : "s"}: ${extra.join(", ")}`,
        } as z.core.$ZodIssue,
      ],
    })
  }

  const decoded = EffectSchema.decodeUnknownExit(schema)(data, { errors: "all", propertyOrder: "original" })
  if (Exit.isSuccess(decoded)) return decoded.value as DeepMutable<S["Type"]>
  const error = Cause.squash(decoded.cause)

  throw new InvalidError(
    {
      path: source,
      issues: EffectSchema.isSchemaError(error)
        ? (SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues as z.core.$ZodIssue[])
        : ([{ code: "custom", message: String(error), path: [] }] as z.core.$ZodIssue[]),
    },
    { cause: error },
  )
}

function topLevelExtraKeys(schema: EffectSchema.Top, data: unknown) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return []
  if (schema.ast._tag !== "Objects" || schema.ast.indexSignatures.length > 0) return []
  const known = new Set(schema.ast.propertySignatures.map((item) => String(item.name)))
  return Object.keys(data).filter((key) => !known.has(key))
}

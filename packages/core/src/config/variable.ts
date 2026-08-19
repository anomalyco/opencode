export * as ConfigVariable from "./variable"

import path from "path"
import os from "os"
import { Effect, Schema } from "effect"
import { FSUtil } from "../fs-util"

export class InvalidFileReferenceError extends Schema.TaggedErrorClass<InvalidFileReferenceError>()(
  "ConfigVariable.InvalidFileReferenceError",
  {
    token: Schema.String,
    resolvedPath: Schema.String,
    filepath: Schema.String,
  },
) {}

/** Apply {env:VAR} and {file:path} substitutions to config text before parsing. */
export const substitute = Effect.fnUntraced(function* (input: {
  text: string
  filepath: string
  missing?: "error" | "empty"
}) {
  const missing = input.missing ?? "error"
  const text = input.text.replace(/\{env:([^}]+)\}/g, (_, varName) => process.env[varName] ?? "")

  const fileMatches = Array.from(text.matchAll(/\{file:[^}]+\}/g))
  if (!fileMatches.length) return text

  const configDir = path.dirname(input.filepath)
  const fs = yield* FSUtil.Service
  let out = ""
  let cursor = 0

  for (const match of fileMatches) {
    const token = match[0]
    const index = match.index!
    out += text.slice(cursor, index)

    const lineStart = text.lastIndexOf("\n", index - 1) + 1
    const prefix = text.slice(lineStart, index).trimStart()
    if (prefix.startsWith("//")) {
      out += token
      cursor = index + token.length
      continue
    }

    let filePath = token.slice(6, -1)
    if (filePath.startsWith("~/")) filePath = path.join(os.homedir(), filePath.slice(2))

    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath)
    const content = yield* fs
      .readFileStringSafe(resolvedPath)
      .pipe(
        Effect.flatMap((content) =>
          content !== undefined
            ? Effect.succeed(content.trim())
            : missing === "empty"
              ? Effect.succeed("")
              : Effect.fail(new InvalidFileReferenceError({ token, resolvedPath, filepath: input.filepath })),
        ),
      )

    out += JSON.stringify(content).slice(1, -1)
    cursor = index + token.length
  }

  out += text.slice(cursor)
  return out
})

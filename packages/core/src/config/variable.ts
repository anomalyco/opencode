export * as ConfigVariable from "./variable"

import os from "os"
import path from "path"
import { Effect } from "effect"
import { FSUtil } from "../fs-util"
import { InvalidError } from "../v1/config/error"

type ParseSource =
  | {
      type: "path"
      path: string
    }
  | {
      type: "virtual"
      source: string
      dir: string
    }

type SubstituteInput = ParseSource & {
  text: string
  missing?: "error" | "empty"
  env?: Record<string, string>
}

/** Apply {env:VAR} and {file:path} substitutions to config text. */
export const substitute = Effect.fn("ConfigVariable.substitute")(function* (input: SubstituteInput) {
  const text = input.text.replace(
    /\{env:([^}]+)\}/g,
    (_, varName: string) => (input.env?.[varName] ?? process.env[varName]) || "",
  )
  if (!text.includes("{file:")) return text
  return yield* substituteFiles(input, text)
})

const substituteFiles = Effect.fnUntraced(function* (input: SubstituteInput, text: string) {
  const fs = yield* FSUtil.Service
  const configDir = input.type === "path" ? path.dirname(input.path) : input.dir
  const configSource = input.type === "path" ? input.path : input.source
  const matches = Array.from(text.matchAll(/\{file:[^}]+\}/g))
  let out = ""
  let cursor = 0

  for (const match of matches) {
    const token = match[0]
    const index = match.index
    out += text.slice(cursor, index)

    const lineStart = text.lastIndexOf("\n", index - 1) + 1
    const prefix = text.slice(lineStart, index).trimStart()
    if (prefix.startsWith("//")) {
      out += token
      cursor = index + token.length
      continue
    }

    const filePath = token.replace(/^\{file:/, "").replace(/\}$/, "")
    const expandedPath = filePath.startsWith("~/") ? path.join(os.homedir(), filePath.slice(2)) : filePath
    const resolvedPath = path.isAbsolute(expandedPath) ? expandedPath : path.resolve(configDir, expandedPath)
    const fileContent = yield* fs.readFileString(resolvedPath).pipe(
      Effect.catch((error) => {
        if (input.missing === "empty") return Effect.succeed("")

        const message = `bad file reference: "${token}"`
        return Effect.fail(
          new InvalidError(
            {
              path: configSource,
              message:
                error._tag === "PlatformError" && error.reason._tag === "NotFound"
                  ? `${message} ${resolvedPath} does not exist`
                  : message,
            },
            { cause: error },
          ),
        )
      }),
    )

    out += JSON.stringify(fileContent.trim()).slice(1, -1)
    cursor = index + token.length
  }

  return out + text.slice(cursor)
})

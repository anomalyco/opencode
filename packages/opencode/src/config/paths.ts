import path from "path"
import os from "os"
import z from "zod"
import { type ParseError as JsoncParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import * as TOML from "toml"
import { NamedError } from "@opencode-ai/util/error"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"

export namespace ConfigPaths {
  export async function projectFiles(name: string, directory: string, worktree: string) {
    const files: string[] = []
    for (const file of [`${name}.jsonc`, `${name}.json`]) {
      const found = await Filesystem.findUp(file, directory, worktree)
      for (const resolved of found.toReversed()) {
        files.push(resolved)
      }
    }
    return files
  }

  export async function directories(directory: string, worktree: string) {
    return [
      Global.Path.config,
      ...(!Flag.OPENCODE_DISABLE_PROJECT_CONFIG
        ? await Array.fromAsync(
            Filesystem.up({
              targets: [".opencode"],
              start: directory,
              stop: worktree,
            }),
          )
        : []),
      ...(await Array.fromAsync(
        Filesystem.up({
          targets: [".opencode"],
          start: Global.Path.home,
          stop: Global.Path.home,
        }),
      )),
      ...(Flag.OPENCODE_CONFIG_DIR ? [Flag.OPENCODE_CONFIG_DIR] : []),
    ]
  }

  export function fileInDirectory(dir: string, name: string) {
    return [path.join(dir, `${name}.jsonc`), path.join(dir, `${name}.json`)]
  }

  export const JsonError = NamedError.create(
    "ConfigJsonError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
    }),
  )

  export const InvalidError = NamedError.create(
    "ConfigInvalidError",
    z.object({
      path: z.string(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
      message: z.string().optional(),
    }),
  )

  /** Read a config file, returning undefined for missing files and throwing JsonError for other failures. */
  export async function readFile(filepath: string) {
    return Filesystem.readText(filepath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return
      throw new JsonError({ path: filepath }, { cause: err })
    })
  }

  type ParseSource = string | { source: string; dir: string }

  function source(input: ParseSource) {
    return typeof input === "string" ? input : input.source
  }

  function dir(input: ParseSource) {
    return typeof input === "string" ? path.dirname(input) : input.dir
  }

  function isCommentedLine(text: string, index: number) {
    const lineStart = text.lastIndexOf("\n", index - 1) + 1
    const prefix = text.slice(lineStart, index).trimStart()
    return prefix.startsWith("//")
  }

  function expandHome(filePath: string) {
    if (filePath.startsWith("~/")) {
      return path.join(os.homedir(), filePath.slice(2))
    }
    return filePath
  }

  function resolveReferencedPath(filePath: string, input: ParseSource) {
    const configDir = dir(input)
    const expanded = expandHome(filePath)
    return path.isAbsolute(expanded) ? expanded : path.resolve(configDir, expanded)
  }

  function escapeJsonString(value: string) {
    return JSON.stringify(value).slice(1, -1)
  }

  async function replaceTokens(
    text: string,
    pattern: RegExp,
    replace: (token: string) => Promise<string>,
  ) {
    const matches = Array.from(text.matchAll(pattern))
    if (!matches.length) return text

    let out = ""
    let cursor = 0

    for (const match of matches) {
      const token = match[0]
      const index = match.index!
      out += text.slice(cursor, index)

      if (isCommentedLine(text, index)) {
        out += token
        cursor = index + token.length
        continue
      }

      out += await replace(token)
      cursor = index + token.length
    }

    out += text.slice(cursor)
    return out
  }

  async function readReferencedFile(
    token: string,
    input: ParseSource,
    filePath: string,
    missing: "error" | "empty",
    kind: "file" | "json" | "toml",
  ) {
    const configSource = source(input)
    const resolvedPath = resolveReferencedPath(filePath, input)
    return {
      resolvedPath,
      content: await Filesystem.readText(resolvedPath).catch((error: NodeJS.ErrnoException) => {
        if (missing === "empty") return ""

        const errMsg = `bad ${kind} reference: "${token}"`
        if (error.code === "ENOENT") {
          throw new InvalidError(
            {
              path: configSource,
              message: errMsg + ` ${resolvedPath} does not exist`,
            },
            { cause: error },
          )
        }
        throw new InvalidError({ path: configSource, message: errMsg }, { cause: error })
      }),
    }
  }

  function resolvePointer(
    value: unknown,
    pointer: string,
    token: string,
    configSource: string,
    resolvedPath: string,
    kind: "json" | "toml",
  ) {
    if (pointer === "") return value
    if (!pointer.startsWith("/")) {
      throw new InvalidError({
        path: configSource,
        message: `bad ${kind} reference: "${token}" expected JSON pointer after "#"`,
      })
    }

    let current = value
    for (const rawPart of pointer.slice(1).split("/")) {
      const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~")
      if (!current || typeof current !== "object" || !(part in current)) {
        throw new InvalidError({
          path: configSource,
          message: `bad ${kind} reference: "${token}" pointer "${pointer}" not found in ${resolvedPath}`,
        })
      }
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  function parseJsonReference(token: string, configSource: string, resolvedPath: string, content: string) {
    const errors: JsoncParseError[] = []
    const data = parseJsonc(content, errors, { allowTrailingComma: true })
    if (errors.length) {
      const message = errors.map((error) => printParseErrorCode(error.error)).join(", ")
      throw new InvalidError({
        path: configSource,
        message: `bad json reference: "${token}" invalid JSON in ${resolvedPath}: ${message}`,
      })
    }
    return data
  }

  function parseTomlReference(token: string, configSource: string, resolvedPath: string, content: string) {
    try {
      return TOML.parse(content)
    } catch (error: any) {
      throw new InvalidError({
        path: configSource,
        message: `bad toml reference: "${token}" invalid TOML in ${resolvedPath}: ${error?.message ?? error}`,
      })
    }
  }

  async function replaceStructuredTokens(
    text: string,
    input: ParseSource,
    missing: "error" | "empty",
    kind: "json" | "toml",
    parse: (token: string, configSource: string, resolvedPath: string, content: string) => unknown,
  ) {
    return replaceTokens(text, new RegExp(`\\{${kind}:[^}]+\\}`, "g"), async (token) => {
      const spec = token.replace(new RegExp(`^\\{${kind}:`), "").replace(/\}$/, "")
      const separator = spec.indexOf("#")
      const configSource = source(input)
      if (separator === -1) {
        throw new InvalidError({
          path: configSource,
          message: `bad ${kind} reference: "${token}" expected "{${kind}:path#/pointer}"`,
        })
      }

      const filePath = spec.slice(0, separator)
      const pointer = spec.slice(separator + 1)
      const { resolvedPath, content } = await readReferencedFile(token, input, filePath, missing, kind)
      if (missing === "empty" && content === "") return ""

      const data = parse(token, configSource, resolvedPath, content)
      const resolved = resolvePointer(data, pointer, token, configSource, resolvedPath, kind)
      if (typeof resolved !== "string") {
        throw new InvalidError({
          path: configSource,
          message: `bad ${kind} reference: "${token}" must resolve to a string`,
        })
      }

      return escapeJsonString(resolved)
    })
  }

  /** Apply {env:VAR}, {file:path}, {json:path#/pointer}, and {toml:path#/pointer} substitutions to config text. */
  async function substitute(text: string, input: ParseSource, missing: "error" | "empty" = "error") {
    text = text.replace(/\{env:([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || ""
    })

    text = await replaceTokens(text, /\{file:[^}]+\}/g, async (token) => {
      const filePath = token.replace(/^\{file:/, "").replace(/\}$/, "")
      const fileContent = (await readReferencedFile(token, input, filePath, missing, "file")).content.trim()
      return escapeJsonString(fileContent)
    })

    text = await replaceStructuredTokens(text, input, missing, "json", parseJsonReference)
    text = await replaceStructuredTokens(text, input, missing, "toml", parseTomlReference)

    return text
  }

  /** Substitute and parse JSONC text, throwing JsonError on syntax errors. */
  export async function parseText(text: string, input: ParseSource, missing: "error" | "empty" = "error") {
    const configSource = source(input)
    text = await substitute(text, input, missing)

    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) {
      const lines = text.split("\n")
      const errorDetails = errors
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
        path: configSource,
        message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
      })
    }

    return data
  }
}

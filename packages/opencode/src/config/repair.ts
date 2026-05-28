export * as ConfigRepair from "./repair"

import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser"
import { Cause, Effect, Exit, Option, Schema } from "effect"
import { Config } from "./config"
import { ConfigError } from "./error"
import { ConfigParse } from "./parse"

type Issue = {
  readonly message: string
  readonly path: readonly string[]
  readonly [key: string]: unknown
}

const UnrecognizedKeysIssue = Schema.Struct({
  code: Schema.Literal("unrecognized_keys"),
  keys: Schema.Array(Schema.String),
  path: Schema.Array(Schema.String),
})

export type Inspection = {
  valid: boolean
  error?: "json" | "invalid"
  message?: string
  issues: ReadonlyArray<Issue>
  fixPaths: string[][]
  candidatePaths: string[][]
}

export const inspect = Effect.fn("ConfigRepair.inspect")(function* (text: string, source: string) {
  if (!text.trim()) return { valid: true, issues: [], fixPaths: [], candidatePaths: [] }

  const result = yield* Effect.try({
    try: () => ConfigParse.schema(Config.Info, ConfigParse.jsonc(text, source), source),
    catch: (error) => error,
  }).pipe(Effect.exit)

  if (Exit.isSuccess(result)) {
    return { valid: true, issues: [], fixPaths: [], candidatePaths: [] }
  }

  const error = Cause.squash(result.cause)

  if (ConfigError.JsonError.isInstance(error)) {
    return {
      valid: false,
      error: "json" as const,
      message: error.data.message,
      issues: [],
      fixPaths: [],
      candidatePaths: [],
    }
  }

  if (ConfigError.InvalidError.isInstance(error)) {
    const issues = error.data.issues ?? []
    const candidatePaths = removablePaths(text, issues)
    const fixed = applyPaths(text, candidatePaths)
    const checked = candidatePaths.length
      ? yield* Effect.try({
          try: () => ConfigParse.schema(Config.Info, ConfigParse.jsonc(fixed, source), source),
          catch: (error) => error,
        }).pipe(Effect.exit)
      : undefined
    return {
      valid: false,
      error: "invalid" as const,
      message: error.data.message,
      issues,
      fixPaths: checked && Exit.isSuccess(checked) ? candidatePaths : [],
      candidatePaths,
    }
  }

  return {
    valid: false,
    error: "invalid" as const,
    message: String(error),
    issues: [],
    fixPaths: [],
    candidatePaths: [],
  }
})

export function applyFixes(text: string, inspection: Inspection) {
  return applyPaths(text, inspection.fixPaths)
}

function applyPaths(text: string, paths: string[][]) {
  return paths.reduce(
    (result, path) =>
      applyEdits(
        result,
        modify(result, path, undefined, {
          formattingOptions: {
            insertSpaces: true,
            tabSize: 2,
          },
        }),
      ),
    text,
  )
}

function removablePaths(text: string, issues: ReadonlyArray<Issue>) {
  const tree = parseTree(text, [], { allowTrailingComma: true })
  if (!tree) return []
  return Array.from(
    new Map(
      issues
        .flatMap((issue) => issuePaths(issue))
        .filter((path) => findNodeAtLocation(tree, path) !== undefined)
        .map((path) => [path.join("."), path]),
    ).values(),
  )
}

function issuePaths(issue: Issue) {
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(UnrecognizedKeysIssue)(issue))
  if (decoded) return decoded.keys.map((key) => [...decoded.path, key])
  if (!issue.path.length) return []
  return [Array.from(issue.path)]
}

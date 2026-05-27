export * as ConfigReference from "./reference"

import { Schema } from "effect"

const Git = Schema.Struct({
  repository: Schema.String.annotate({
    description: "Git repository URL, host/path reference, or GitHub owner/repo shorthand",
  }),
  branch: Schema.optional(Schema.String).annotate({
    description: "Branch or ref Scout should clone and inspect",
  }),
})

const Local = Schema.Struct({
  path: Schema.String.annotate({
    description: "Absolute path, ~/ path, or workspace-relative path to a local reference directory",
  }),
})

export const Entry = Schema.Union([Schema.String, Git, Local]).annotate({ identifier: "ReferenceConfigEntry" })
export type Entry = Schema.Schema.Type<typeof Entry>

export const Info = Schema.Record(Schema.String, Entry).annotate({ identifier: "ReferenceConfig" })
export type Info = Schema.Schema.Type<typeof Info>

export type NormalizedEntry =
  | {
      kind: "local"
      path: string
    }
  | {
      kind: "git"
      repository: string
      branch?: string
    }
  | {
      kind: "invalid"
      message: string
    }

export type NormalizedInfo = Record<string, NormalizedEntry>

export function validateAlias(name: string) {
  if (name.length === 0) return "Reference alias must not be empty"
  if (/[\/\s`,]/.test(name)) {
    return "Reference alias must not contain /, whitespace, comma, or backtick"
  }
}

export function normalizeEntry(entry: Entry): NormalizedEntry {
  if (typeof entry === "string") {
    if (entry.startsWith(".") || entry.startsWith("/") || entry.startsWith("~")) {
      return { kind: "local", path: entry }
    }
    return { kind: "git", repository: entry }
  }

  if ("path" in entry) return { kind: "local", path: entry.path }
  return { kind: "git", repository: entry.repository, branch: entry.branch }
}

export function normalize(info: Info): NormalizedInfo {
  return Object.fromEntries(
    Object.entries(info).map(([name, entry]) => {
      const aliasError = validateAlias(name)
      return [name, aliasError ? { kind: "invalid" as const, message: aliasError } : normalizeEntry(entry)] as const
    }),
  )
}

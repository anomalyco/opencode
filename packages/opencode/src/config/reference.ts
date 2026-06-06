export * as ConfigReference from "./reference"

import { ConfigReferenceV1 } from "@opencode-ai/core/v1/config/reference"

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

export function normalizeEntry(entry: ConfigReferenceV1.Entry): NormalizedEntry {
  if (typeof entry === "string") {
    if (entry.startsWith(".") || entry.startsWith("/") || entry.startsWith("~")) {
      return { kind: "local", path: entry }
    }
    return { kind: "git", repository: entry }
  }

  if ("path" in entry) return { kind: "local", path: entry.path }
  return { kind: "git", repository: entry.repository, branch: entry.branch }
}

export function normalize(info: ConfigReferenceV1.Info): NormalizedInfo {
  return Object.fromEntries(
    Object.entries(info).map(([name, entry]) => {
      const aliasError = validateAlias(name)
      return [name, aliasError ? { kind: "invalid" as const, message: aliasError } : normalizeEntry(entry)] as const
    }),
  )
}

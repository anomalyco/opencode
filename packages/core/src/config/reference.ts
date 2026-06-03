export * as ConfigReference from "./reference"

import { Schema } from "effect"

export class Git extends Schema.Class<Git>("ConfigV2.Reference.Git")({
  repository: Schema.String,
  branch: Schema.String.pipe(Schema.optional),
}) {}

export class Local extends Schema.Class<Local>("ConfigV2.Reference.Local")({
  path: Schema.String,
}) {}

export const Entry = Schema.Union([Schema.String, Git, Local])
export type Entry = typeof Entry.Type

export const Info = Schema.Record(Schema.String, Entry)
export type Info = typeof Info.Type

export type NormalizedEntry =
  | { readonly kind: "local"; readonly path: string }
  | { readonly kind: "git"; readonly repository: string; readonly branch?: string }
  | { readonly kind: "invalid"; readonly message: string }

export type NormalizedInfo = Record<string, NormalizedEntry>

export function validateAlias(name: string) {
  if (name.length === 0) return "Reference alias must not be empty"
  if (/[\/\s`,]/.test(name)) return "Reference alias must not contain /, whitespace, comma, or backtick"
}

export function normalizeEntry(entry: Entry): NormalizedEntry {
  if (typeof entry === "string") {
    if (entry.startsWith(".") || entry.startsWith("/") || entry.startsWith("~")) return { kind: "local", path: entry }
    return { kind: "git", repository: entry }
  }
  if ("path" in entry) return { kind: "local", path: entry.path }
  return { kind: "git", repository: entry.repository, branch: entry.branch }
}

export function normalize(info: Info): NormalizedInfo {
  return Object.fromEntries(
    Object.entries(info).map(([name, entry]) => {
      const message = validateAlias(name)
      return [name, message ? { kind: "invalid" as const, message } : normalizeEntry(entry)]
    }),
  )
}
